import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { messages, sessions, knowledgeBase } from "@/lib/db/schema";
import { and, eq, gt, sql } from "drizzle-orm";
import { getPusher } from "@/lib/pusher/server";
import { getProductBySKU, getProductByName } from "@/lib/bigcommerce/client";
import { extractSKUFromText } from "@/lib/search/productSearch";
import { anyAgentsOnline } from "@/lib/presence";
import {
  recordCustomerActivity,
  claimByAi,
} from "@/lib/sessions/state";
import { buildPrompt } from "@/lib/ai/buildPrompt";
import { callClaude } from "@/lib/ai/callClaude";
import { redactPII } from "@/lib/utils/redactPII";
import { enforce, getClientIp } from "@/lib/rateLimit";
import { log, serializeError } from "@/lib/log";

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

export async function POST(req: NextRequest) {
  const requestId = crypto.randomUUID();
  try {
    const body = await req.json();
    const { message, sessionId, pageContext, role = "customer", agentName } = body;

    if (!message || !sessionId) {
      return NextResponse.json(
        { error: "message and sessionId are required" },
        { status: 400 }
      );
    }

    if (role === "agent") {
      const authSession = await getServerSession(authOptions);
      if (!authSession?.user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
    } else {
      // IP rate limit on customer-originating chat traffic. 20 messages /
      // 60s per IP. Agents skip this — their per-message cost is bounded by
      // session staffing, not abuse.
      const ip = getClientIp(req);
      const rl = await enforce(`chat:${ip}`, 20, 60);
      if (!rl.ok) {
        return NextResponse.json(
          { error: "rate_limited" },
          {
            status: 429,
            headers: { "Retry-After": String(rl.retryAfter ?? 60) },
          }
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
      await pusher.trigger(`session-${sessionId}`, "new-message", {
        id: savedMessage.id,
        role: savedMessage.role,
        content: savedMessage.content,
        sentAt: savedMessage.sentAt,
        pageContext: savedMessage.pageContext,
        agentName,
        productMention,
      });

      await pusher.trigger("dashboard", "session-update", {
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

    // If already claimed by AI — respond inline to every follow-up
    if (session.claimedByKind === "ai") {
      try {
        const { system, conversationMessages } = await buildPrompt(
          sessionId,
          storedContent,
          enrichedContext,
          latestMessageRaw
        );
        const aiResponse = await callClaude(system, conversationMessages);
        const [aiMsg] = await db
          .insert(messages)
          .values({ sessionId, role: "ai", content: aiResponse })
          .returning();
        const pusher = getPusher();
        await pusher.trigger(`session-${sessionId}`, "new-message", {
          id: aiMsg.id,
          role: "ai",
          content: aiMsg.content,
          sentAt: aiMsg.sentAt,
        });
        await pusher.trigger("dashboard", "session-update", {
          sessionId,
          lastMessage: aiMsg.content,
          role: "ai",
        });
        return NextResponse.json({
          message: savedMessage,
          aiMessage: aiMsg,
          sessionStatus: "active_ai",
          productMention,
        });
      } catch (err) {
        log.error("chat.inline_ai_followup_failed", {
          requestId,
          sessionId,
          error: serializeError(err),
        });
      }
      return NextResponse.json({
        message: savedMessage,
        sessionStatus: "active_ai",
        productMention,
      });
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
        // Fire AI response inline
        try {
          const { system, conversationMessages } = await buildPrompt(
            sessionId,
            storedContent,
            enrichedContext,
            latestMessageRaw
          );
          const aiResponse = await callClaude(system, conversationMessages);
          const [aiMsg] = await db
            .insert(messages)
            .values({ sessionId, role: "ai", content: aiResponse })
            .returning();

          const pusher = getPusher();
          await pusher.trigger(`session-${sessionId}`, "new-message", {
            id: aiMsg.id,
            role: "ai",
            content: aiMsg.content,
            sentAt: aiMsg.sentAt,
          });
          await pusher.trigger("dashboard", "session-update", {
            sessionId,
            lastMessage: aiMsg.content,
            role: "ai",
          });
          await pusher.trigger(`session-${sessionId}`, "session-claimed", {
            kind: "ai",
          });
          await pusher.trigger("dashboard", "session-claimed", {
            sessionId,
            kind: "ai",
          });

          return NextResponse.json({
            message: savedMessage,
            aiMessage: aiMsg,
            sessionStatus: "active_ai",
            productMention,
          });
        } catch (err) {
          log.error("chat.inline_ai_response_failed", {
            requestId,
            sessionId,
            error: serializeError(err),
          });
        }
      }
      return NextResponse.json({
        message: savedMessage,
        sessionStatus: "active_ai",
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
