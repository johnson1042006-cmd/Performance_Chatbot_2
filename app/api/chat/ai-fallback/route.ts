import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sessions, messages } from "@/lib/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { runAiTurn, isHumanTakeoverError } from "@/lib/ai/runAi";
import { verifySessionAccess } from "@/lib/sessions/verifySessionToken";
import { CALL_CLAUDE_ERROR_MESSAGE } from "@/lib/ai/callClaude";
import { claimByAi } from "@/lib/sessions/state";
import { enforce, getClientIp } from "@/lib/rateLimit";
import { log, serializeError } from "@/lib/log";
import { createSseStream, SSE_RESPONSE_HEADERS, wantsSse } from "@/lib/ai/sse";

const FALLBACK_FRESHNESS_MS = 5 * 60 * 1000;

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const requestId = crypto.randomUUID();
  try {
    // Same class of IP limit as /api/chat — this route triggers a paid Claude
    // turn, so it must not be an unmetered spend vector.
    const ip = getClientIp(req);
    const rl = await enforce(`ai-fallback:${ip}`, 10, 60, { failClosed: true });
    if (!rl.ok) {
      return NextResponse.json(
        { error: "rate_limited" },
        {
          status: 429,
          headers: { "Retry-After": String(rl.retryAfter ?? 60) },
        }
      );
    }

    const body = await req.json();
    const { sessionId, latestMessage, pageContext } = body;
    const useSse = wantsSse(req);

    if (!sessionId) {
      return NextResponse.json(
        { error: "sessionId is required" },
        { status: 400 }
      );
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

    // This route triggers a paid Claude turn on an arbitrary session — the
    // caller must own the session (token) or be staff.
    if (!(await verifySessionAccess(req, sessionId))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (session.claimedByKind === "human") {
      return NextResponse.json({
        skipped: true,
        reason: "Session is handled by a human agent",
      });
    }

    // Redundancy/freshness guard: don't burn a Claude turn when the fallback
    // already answered the latest customer message, or when the conversation
    // has gone cold. The legit widget/cron caller fires right after a fresh
    // customer message, so it is unaffected.
    const [newest] = await db
      .select({ role: messages.role, sentAt: messages.sentAt })
      .from(messages)
      .where(eq(messages.sessionId, sessionId))
      .orderBy(desc(messages.sentAt))
      .limit(1);
    if (newest?.role === "ai") {
      return NextResponse.json({
        skipped: true,
        reason: "stale_or_already_answered",
      });
    }
    const [latestCustomer] = await db
      .select({ sentAt: messages.sentAt })
      .from(messages)
      .where(and(eq(messages.sessionId, sessionId), eq(messages.role, "customer")))
      .orderBy(desc(messages.sentAt))
      .limit(1);
    if (
      !latestCustomer ||
      Date.now() - new Date(latestCustomer.sentAt).getTime() > FALLBACK_FRESHNESS_MS
    ) {
      return NextResponse.json({
        skipped: true,
        reason: "stale_or_already_answered",
      });
    }

    // Race-safe AI claim — a human clicking Claim at the last millisecond wins
    if (!session.claimedByKind) {
      const won = await claimByAi(sessionId);
      if (!won) {
        // A human claimed it just now
        return NextResponse.json({
          skipped: true,
          reason: "Session is handled by a human agent",
        });
      }
    }

    if (useSse) {
      const stream = createSseStream(async ({ send }) => {
        try {
          const result = await runAiTurn({
            sessionId,
            latestMessage: latestMessage || "",
            pageContext,
            requestId,
            stream: {
              onToken: (text) => send({ event: "token", data: { text } }),
              onToolUse: (e) => send({ event: "tool_use", data: e }),
            },
          });
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
            send({ event: "done", data: {} });
            return;
          }
          log.error("chat.ai_fallback.sse_failed", {
            requestId,
            sessionId,
            error: serializeError(err),
          });
          send({
            event: "error",
            data: { message: "AI fallback failed" },
          });
        }
      });
      return new Response(stream, { headers: SSE_RESPONSE_HEADERS });
    }

    try {
      const result = await runAiTurn({
        sessionId,
        latestMessage: latestMessage || "",
        pageContext,
        requestId,
      });
      return NextResponse.json({ message: result.message });
    } catch (err) {
      if (isHumanTakeoverError(err)) {
        return NextResponse.json({
          skipped: true,
          reason: "Session is handled by a human agent",
        });
      }
      const isClaudeFailure =
        err && typeof err === "object" && "isCallClaudeFailure" in err;
      log.error("chat.ai_fallback.claude_failed", {
        requestId,
        sessionId,
        error: serializeError(err),
      });
      return NextResponse.json(
        {
          error: isClaudeFailure
            ? CALL_CLAUDE_ERROR_MESSAGE
            : "Failed to generate AI reply",
        },
        { status: 503 }
      );
    }
  } catch (error) {
    log.error("chat.ai_fallback_failed", { requestId, error: serializeError(error) });
    return NextResponse.json(
      { error: "AI fallback failed" },
      { status: 500 }
    );
  }
}
