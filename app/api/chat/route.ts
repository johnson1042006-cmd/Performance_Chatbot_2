import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { messages, sessions, knowledgeBase } from "@/lib/db/schema";
import { and, eq, gt, sql } from "drizzle-orm";
import { getPusher } from "@/lib/pusher/server";
import { sessionChannel, DASHBOARD_CHANNEL } from "@/lib/pusher/channels";
import { getProductBySKU, getProductByName } from "@/lib/bigcommerce/client";
import { extractSKUFromText } from "@/lib/search/productSearch";
import { anyAgentsOnline } from "@/lib/presence";
import {
  recordCustomerActivity,
  claimByAi,
} from "@/lib/sessions/state";
import {
  getAiPauseState,
  clearAiPause,
  persistHoldingAckIfNeeded,
} from "@/lib/sessions/aiPause";
import {
  runAiTurn,
  persistFallbackAiMessage,
  isHumanTakeoverError,
} from "@/lib/ai/runAi";
import { redactPII } from "@/lib/utils/redactPII";
import { enforce, getClientIp } from "@/lib/rateLimit";
import { verifySessionAccess } from "@/lib/sessions/verifySessionToken";
import { log, serializeError } from "@/lib/log";
import { createSseStream, SSE_RESPONSE_HEADERS, wantsSse } from "@/lib/ai/sse";

// Tool loops can run several Claude iterations plus BigCommerce calls; the
// platform default can kill the stream mid-reply. Match ai-fallback's budget.
export const maxDuration = 60;

const DEFAULT_FALLBACK_SECONDS = 60;

async function getBotSettings(): Promise<{
  aiEnabled: boolean;
  fallbackTimerSeconds: number;
}> {
  try {
    const [entry] = await db
      .select()
      .from(knowledgeBase)
      .where(eq(knowledgeBase.topic, "bot_settings"))
      .limit(1);
    if (!entry) return { aiEnabled: true, fallbackTimerSeconds: DEFAULT_FALLBACK_SECONDS };
    const parsed = JSON.parse(entry.content);
    return {
      aiEnabled: parsed.aiEnabled ?? true,
      fallbackTimerSeconds: Math.min(300, Math.max(10, Number(parsed.fallbackTimerSeconds) || DEFAULT_FALLBACK_SECONDS)),
    };
  } catch {
    return { aiEnabled: true, fallbackTimerSeconds: DEFAULT_FALLBACK_SECONDS };
  }
}

interface AiInlineContext {
  sessionId: string;
  storedContent: string;
  latestMessageRaw: string;
  enrichedContext: Record<string, unknown> | null | undefined;
  requestId: string;
  alsoFireSessionClaimed: boolean;
}

export async function POST(req: NextRequest) {
  const requestId = crypto.randomUUID();
  try {
    const body = await req.json();
    const { message, sessionId, pageContext, role = "customer", agentName } = body;
    const useSse = wantsSse(req) && role === "customer";

    if (!message || !sessionId) {
      return NextResponse.json(
        { error: "message and sessionId are required" },
        { status: 400 }
      );
    }

    // Bound the message: it is persisted to messages.content AND fed verbatim
    // into the Claude prompt. Without a cap a single request can carry a
    // multi-megabyte string — an oversized DB row and an unmetered, oversized
    // (paid) model call that the per-IP rate limit does not constrain. 4000
    // chars is well beyond any genuine support question.
    const MAX_MESSAGE_CHARS = 4000;
    if (typeof message !== "string") {
      return NextResponse.json(
        { error: "message must be a string" },
        { status: 400 }
      );
    }
    if (message.length > MAX_MESSAGE_CHARS) {
      return NextResponse.json(
        { error: "message_too_long", maxChars: MAX_MESSAGE_CHARS },
        { status: 413 }
      );
    }

    let agentUser: { id: string; role: string } | null = null;
    if (role === "agent") {
      const authSession = await getServerSession(authOptions);
      if (!authSession?.user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      agentUser = { id: authSession.user.id, role: authSession.user.role };
    } else {
      // IP rate limit on customer-originating chat traffic. 20 messages /
      // 60s per IP. Agents skip this — their per-message cost is bounded by
      // session staffing, not abuse.
      const ip = getClientIp(req);
      const rl = await enforce(`chat:${ip}`, 20, 60, { failClosed: true });
      if (!rl.ok) {
        return NextResponse.json(
          { error: "rate_limited" },
          {
            status: 429,
            headers: { "Retry-After": String(rl.retryAfter ?? 60) },
          }
        );
      }

      // Hard session-token enforcement: the caller must present the matching
      // session token (cookie / header / ?st=) or be staff. Without this,
      // anyone who learns a session UUID can post into — and trigger AI turns
      // on — someone else's conversation. verifySessionAccess grants legacy
      // grace only to pre-token sessions (null token hash).
      if (!(await verifySessionAccess(req, sessionId))) {
        log.warn("chat.session_token_rejected", { requestId, sessionId });
        return NextResponse.json(
          { error: "Unauthorized" },
          { status: 401 }
        );
      }
    }

    // Redact PII from CUSTOMER messages only. The persisted DB row, the
    // pusher broadcast, and any subsequent-turn read pulls the redacted
    // version; we keep the raw text in `latestMessageRaw` and pass it to
    // buildPrompt + downstream tools just for THIS turn so the model can
    // answer about a card the customer just typed without ever storing it.
    let storedContent: string = message;
    let redactionHits: string[] = [];
    let latestMessageRaw: string = message;
    if (role === "customer") {
      const r = redactPII(message);
      storedContent = r.redacted;
      redactionHits = r.hits;
      latestMessageRaw = message;
      if (redactionHits.length > 0) {
        log.info("chat.pii_redacted", {
          requestId,
          sessionId,
          hits: redactionHits,
        });
      }
    }

    const [session] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .limit(1);

    if (!session) {
      return NextResponse.json(
        { error: "Session not found" },
        { status: 404 }
      );
    }

    // ── Ownership check on agent messages ────────────────────────────
    // Only the claiming agent (or a manager) may speak into a session.
    // Without this, any logged-in agent could post into any conversation.
    if (
      agentUser &&
      agentUser.role !== "store_manager" &&
      session.claimedByUserId !== agentUser.id
    ) {
      return NextResponse.json(
        { error: "You have not claimed this session" },
        { status: 403 }
      );
    }

    // ── Reject customer messages on closed sessions ──────────────────
    // The embed is supposed to react to the `session-closed` Pusher event
    // and disable its input, but if that signal was missed (network drop,
    // tab in background, etc.) this guard prevents the message from being
    // silently dropped into a closed conversation.
    if (role === "customer" && session.status === "closed") {
      return NextResponse.json(
        {
          error:
            "This conversation has ended. Please start a new chat.",
          code: "session_closed",
        },
        { status: 410 }
      );
    }

    // ── Per-session rate limit (catches abuse, caps API spend) ─────────
    if (role === "customer") {
      const oneMinuteAgo = new Date(Date.now() - 60_000);
      const recentRows = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(messages)
        .where(
          and(
            eq(messages.sessionId, sessionId),
            eq(messages.role, "customer"),
            gt(messages.sentAt, oneMinuteAgo)
          )
        );
      const recentCount = Number(recentRows[0]?.count ?? 0);
      const PER_SESSION_PER_MINUTE = 30;
      if (recentCount >= PER_SESSION_PER_MINUTE) {
        return NextResponse.json(
          {
            error:
              "You're sending messages a bit too fast — give it a few seconds and try again.",
          },
          { status: 429 }
        );
      }
    }

    // Enrich page context with live BC data when available
    let enrichedContext = pageContext;
    if (role === "customer" && pageContext) {
      enrichedContext = { ...pageContext };

      if (pageContext.productSku) {
        const bcProduct = await getProductBySKU(pageContext.productSku);
        if (bcProduct) {
          enrichedContext.bcProductId = bcProduct.id;
          enrichedContext.bcProductName = bcProduct.name;
          enrichedContext.bcPrice = bcProduct.calculated_price || bcProduct.price;
          enrichedContext.bcStock = bcProduct.inventory_level;
        }
      } else if (pageContext.productName) {
        const bcProducts = await getProductByName(pageContext.productName);
        if (bcProducts.length > 0) {
          const match = bcProducts[0];
          enrichedContext.bcProductId = match.id;
          enrichedContext.bcProductName = match.name;
          enrichedContext.bcPrice = match.calculated_price || match.price;
          enrichedContext.bcStock = match.inventory_level;
        }
      }

      await db
        .update(sessions)
        .set({ pageContext: enrichedContext })
        .where(eq(sessions.id, sessionId));
    }

    // Bump customer activity timestamp
    if (role === "customer") {
      await recordCustomerActivity(sessionId);
    }

    // Check if message text contains a SKU pattern. Use the RAW text so a
    // SKU embedded next to a card number still resolves correctly this turn.
    let productMention = null;
    if (role === "customer") {
      const detectedSKU = extractSKUFromText(latestMessageRaw);
      if (detectedSKU) {
        const skuProduct = await getProductBySKU(detectedSKU);
        if (skuProduct) {
          productMention = {
            sku: skuProduct.sku,
            name: skuProduct.name,
            price: skuProduct.calculated_price || skuProduct.price,
            inStock: skuProduct.inventory_level > 0,
          };
        }
      }
    }

    const [savedMessage] = await db
      .insert(messages)
      .values({
        sessionId,
        role,
        content: storedContent,
        pageContext: role === "customer" ? enrichedContext : undefined,
        redactionHits: role === "customer" ? redactionHits : [],
      })
      .returning();

    try {
      const pusher = getPusher();
      await pusher.trigger(sessionChannel(sessionId), "new-message", {
        id: savedMessage.id,
        role: savedMessage.role,
        content: savedMessage.content,
        sentAt: savedMessage.sentAt,
        pageContext: savedMessage.pageContext,
        agentName,
        productMention,
      });

      await pusher.trigger(DASHBOARD_CHANNEL, "session-update", {
        sessionId,
        lastMessage: savedMessage.content,
        role: savedMessage.role,
        pageContext: enrichedContext,
        productMention,
      });
    } catch (pusherError) {
      log.warn("chat.pusher_failed", {
        requestId,
        sessionId,
        error: serializeError(pusherError),
      });
    }

    // ── Queue / claim decision for customer messages ──────────────────────
    if (role !== "customer") {
      return NextResponse.json({
        message: savedMessage,
        sessionStatus: session.status,
        productMention,
      });
    }

    // If already claimed by a human, nothing more to do
    if (session.claimedByKind === "human") {
      return NextResponse.json({
        message: savedMessage,
        sessionStatus: "active_human",
        productMention,
      });
    }

    const aiCtx: AiInlineContext = {
      sessionId,
      storedContent,
      latestMessageRaw,
      enrichedContext,
      requestId,
      alsoFireSessionClaimed: false,
    };

    // If already claimed by AI — respond inline to every follow-up
    if (session.claimedByKind === "ai") {
      // Phase 2a: a paused session never gets a Claude turn — a human owes
      // this customer an answer. Acknowledge the follow-up once (then stay
      // quiet); an expired pause (45 min, nobody claimed) clears lazily and
      // the turn proceeds normally.
      const pauseState = getAiPauseState(session);
      if (pauseState === "expired") {
        await clearAiPause(sessionId, "timeout");
      } else if (pauseState === "active") {
        const holding = await persistHoldingAckIfNeeded(sessionId);
        if (useSse) {
          const stream = createSseStream(async ({ send }) => {
            send({
              event: "customer_message",
              data: {
                id: savedMessage.id,
                sentAt: savedMessage.sentAt,
                productMention,
              },
            });
            if (holding) {
              send({ event: "token", data: { text: holding.content } });
              send({
                event: "message",
                data: { id: holding.id, sentAt: holding.sentAt },
              });
            }
            send({ event: "done", data: {} });
          });
          return new Response(stream, { headers: SSE_RESPONSE_HEADERS });
        }
        return NextResponse.json({
          message: savedMessage,
          aiMessage: holding ?? undefined,
          sessionStatus: "active_ai",
          aiPaused: true,
          productMention,
        });
      }

      if (useSse) {
        return sseAiResponse(aiCtx, savedMessage, productMention);
      }
      try {
        const result = await runAiTurn({
          sessionId,
          latestMessage: storedContent,
          latestMessageRaw,
          pageContext: enrichedContext,
          requestId,
        });
        return NextResponse.json({
          message: savedMessage,
          aiMessage: result.message,
          sessionStatus: "active_ai",
          productMention,
        });
      } catch (err) {
        if (isHumanTakeoverError(err)) {
          return NextResponse.json({
            message: savedMessage,
            sessionStatus: "active_human",
            productMention,
          });
        }
        log.error("chat.inline_ai_followup_failed", {
          requestId,
          sessionId,
          error: serializeError(err),
        });
        // Never leave the customer with dead air: persist a visible fallback
        // reply and return it so the widget renders it immediately.
        const fallback = await persistFallbackAiMessage(sessionId, requestId);
        return NextResponse.json({
          message: savedMessage,
          aiMessage: fallback ?? undefined,
          aiError: true,
          sessionStatus: "active_ai",
          productMention,
        });
      }
    }

    // Session is unclaimed — decide what to do
    const botSettings = await getBotSettings();

    if (!botSettings.aiEnabled) {
      // AI is off: just queue, never auto-respond
      return NextResponse.json({
        message: savedMessage,
        sessionStatus: "waiting",
        queued: true,
        productMention,
      });
    }

    // AI is on: check agent presence
    const agentsOnline = await anyAgentsOnline();

    if (!agentsOnline) {
      // No agents — AI claims immediately
      const won = await claimByAi(sessionId);
      if (won) {
        aiCtx.alsoFireSessionClaimed = true;
        if (useSse) {
          return sseAiResponse(aiCtx, savedMessage, productMention);
        }
        try {
          const result = await runAiTurn({
            sessionId,
            latestMessage: storedContent,
            latestMessageRaw,
            pageContext: enrichedContext,
            requestId,
          });
          await fireSessionClaimedEvents(sessionId, requestId);
          return NextResponse.json({
            message: savedMessage,
            aiMessage: result.message,
            sessionStatus: "active_ai",
            productMention,
          });
        } catch (err) {
          if (isHumanTakeoverError(err)) {
            return NextResponse.json({
              message: savedMessage,
              sessionStatus: "active_human",
              productMention,
            });
          }
          log.error("chat.inline_ai_response_failed", {
            requestId,
            sessionId,
            error: serializeError(err),
          });
          const fallback = await persistFallbackAiMessage(sessionId, requestId);
          return NextResponse.json({
            message: savedMessage,
            aiMessage: fallback ?? undefined,
            aiError: true,
            sessionStatus: "active_ai",
            productMention,
          });
        }
      }
      // Lost the claim race — someone (almost certainly a human) got there
      // first. Report the session's actual state instead of assuming AI.
      const [current] = await db
        .select({ claimedByKind: sessions.claimedByKind })
        .from(sessions)
        .where(eq(sessions.id, sessionId))
        .limit(1);
      return NextResponse.json({
        message: savedMessage,
        sessionStatus:
          current?.claimedByKind === "human" ? "active_human" : "active_ai",
        productMention,
      });
    }

    // Agents are online: set AI claim due time and let humans have first crack
    const dueAt = new Date(Date.now() + botSettings.fallbackTimerSeconds * 1000);
    await db
      .update(sessions)
      .set({ aiClaimDueAt: dueAt })
      .where(eq(sessions.id, sessionId));

    return NextResponse.json({
      message: savedMessage,
      sessionStatus: "waiting",
      queued: true,
      aiClaimDueAtMs: dueAt.getTime(),
      productMention,
    });
  } catch (error) {
    log.error("chat.unhandled_error", { requestId, error: serializeError(error) });
    return NextResponse.json(
      { error: "Failed to process message" },
      { status: 500 }
    );
  }
}

async function fireSessionClaimedEvents(sessionId: string, requestId: string): Promise<void> {
  try {
    const pusher = getPusher();
    await pusher.trigger(sessionChannel(sessionId), "session-claimed", {
      kind: "ai",
    });
    await pusher.trigger(DASHBOARD_CHANNEL, "session-claimed", {
      sessionId,
      kind: "ai",
    });
  } catch (err) {
    log.warn("chat.session_claimed_pusher_failed", {
      requestId,
      sessionId,
      error: serializeError(err),
    });
  }
}

/**
 * SSE branch: streams tokens to the client while runAiTurn streams from
 * Anthropic, persists the final message, fires Pusher fan-out, and emits
 * `done`. Falls back to a JSON 500 if the stream fails to initialize.
 */
function sseAiResponse(
  ctx: AiInlineContext,
  savedCustomerMessage: typeof messages.$inferSelect,
  productMention: unknown
): Response {
  const stream = createSseStream(async ({ send }) => {
    send({
      event: "customer_message",
      data: {
        id: savedCustomerMessage.id,
        sentAt: savedCustomerMessage.sentAt,
        productMention,
      },
    });
    try {
      const result = await runAiTurn({
        sessionId: ctx.sessionId,
        latestMessage: ctx.storedContent,
        latestMessageRaw: ctx.latestMessageRaw,
        pageContext: ctx.enrichedContext,
        requestId: ctx.requestId,
        stream: {
          onToken: (text) => send({ event: "token", data: { text } }),
          onToolUse: (e) => send({ event: "tool_use", data: e }),
        },
      });
      if (ctx.alsoFireSessionClaimed) {
        await fireSessionClaimedEvents(ctx.sessionId, ctx.requestId);
      }
      send({
        event: "message",
        data: {
          id: result.message.id,
          sentAt: result.message.sentAt,
          confidence: result.confidence.confidence,
          sentiment: result.sentiment.score,
          autoEscalated: result.autoEscalated,
        },
      });
      send({ event: "done", data: {} });
    } catch (err) {
      if (isHumanTakeoverError(err)) {
        // A human claimed mid-turn — the agent will reply. End the stream
        // cleanly; the widget's session-claimed handler flips the banner.
        send({ event: "done", data: {} });
        return;
      }
      log.error("chat.sse_ai_failed", {
        requestId: ctx.requestId,
        sessionId: ctx.sessionId,
        error: serializeError(err),
      });
      // Persist a visible fallback reply and stream it so the customer sees
      // one consistent message (and the transcript matches the screen).
      const fallback = await persistFallbackAiMessage(
        ctx.sessionId,
        ctx.requestId
      );
      if (fallback) {
        send({ event: "token", data: { text: fallback.content } });
        send({
          event: "message",
          data: { id: fallback.id, sentAt: fallback.sentAt },
        });
        send({ event: "done", data: {} });
      } else {
        send({
          event: "error",
          data: { message: "AI response failed" },
        });
      }
    }
  });
  return new Response(stream, { headers: SSE_RESPONSE_HEADERS });
}
