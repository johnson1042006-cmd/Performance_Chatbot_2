import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { messages, sessions } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { buildPrompt } from "@/lib/ai/buildPrompt";
import { callClaude, CALL_CLAUDE_ERROR_MESSAGE } from "@/lib/ai/callClaude";
import { getPusher } from "@/lib/pusher/server";
import { claimByAi } from "@/lib/sessions/state";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { sessionId, latestMessage, pageContext } = body;

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

    let system: string;
    let conversationMessages: { role: "user" | "assistant"; content: string }[];
    try {
      const result = await buildPrompt(
        sessionId,
        latestMessage || "",
        pageContext
      );
      system = result.system;
      conversationMessages = result.conversationMessages;
    } catch (buildErr) {
      console.error("buildPrompt failed:", buildErr);
      return NextResponse.json(
        {
          error:
            "I'm having trouble looking that up right now. Could you try rephrasing or asking again in a moment?",
        },
        { status: 503 }
      );
    }

    let aiResponse: string;
    try {
      aiResponse = await callClaude(system, conversationMessages);
    } catch (err) {
      const isClaudeFailure =
        err && typeof err === "object" && "isCallClaudeFailure" in err;
      return NextResponse.json(
        {
          error: isClaudeFailure
            ? CALL_CLAUDE_ERROR_MESSAGE
            : "Failed to generate AI reply",
        },
        { status: 503 }
      );
    }

    const [savedMessage] = await db
      .insert(messages)
      .values({
        sessionId,
        role: "ai",
        content: aiResponse,
      })
      .returning();

    try {
      const pusher = getPusher();
      await pusher.trigger(`session-${sessionId}`, "new-message", {
        id: savedMessage.id,
        role: "ai",
        content: savedMessage.content,
        sentAt: savedMessage.sentAt,
      });

      await pusher.trigger("dashboard", "session-update", {
        sessionId,
        lastMessage: savedMessage.content,
        role: "ai",
      });
    } catch (pusherError) {
      console.error("Pusher error (non-fatal):", pusherError);
    }

    return NextResponse.json({ message: savedMessage });
  } catch (error) {
    console.error("AI fallback error:", error);
    return NextResponse.json(
      { error: "AI fallback failed" },
      { status: 500 }
    );
  }
}
