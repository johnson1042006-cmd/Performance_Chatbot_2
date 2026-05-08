import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sessions } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { runAiTurn } from "@/lib/ai/runAi";
import { CALL_CLAUDE_ERROR_MESSAGE } from "@/lib/ai/callClaude";
import { claimByAi } from "@/lib/sessions/state";
import { log, serializeError } from "@/lib/log";
import { createSseStream, SSE_RESPONSE_HEADERS, wantsSse } from "@/lib/ai/sse";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const requestId = crypto.randomUUID();
  try {
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

    if (session.claimedByKind === "human") {
      return NextResponse.json({
        skipped: true,
        reason: "Session is handled by a human agent",
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
