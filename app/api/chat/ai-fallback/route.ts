import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { messages, sessions } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { buildPrompt } from "@/lib/ai/buildPrompt";
import { callClaude } from "@/lib/ai/callClaude";
import { getPusher } from "@/lib/pusher/server";

export const maxDuration = 30;

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

    if (session.status === "active_human") {
      return NextResponse.json({
        skipped: true,
        reason: "Session is handled by a human agent",
      });
    }

    if (session.status === "waiting") {
      await db
        .update(sessions)
        .set({ status: "active_ai" })
        .where(eq(sessions.id, sessionId));
    }

    const { system, conversationMessages } = await buildPrompt(
      sessionId,
      latestMessage || "",
      pageContext
    );

    const aiResponse = await callClaude(system, conversationMessages);

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
