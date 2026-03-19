import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { messages, sessions } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getPusher } from "@/lib/pusher/server";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { message, sessionId, pageContext, role = "customer", agentName } = body;

    if (!message || !sessionId) {
      return NextResponse.json(
        { error: "message and sessionId are required" },
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

    if (pageContext && role === "customer") {
      await db
        .update(sessions)
        .set({ pageContext })
        .where(eq(sessions.id, sessionId));
    }

    const [savedMessage] = await db
      .insert(messages)
      .values({
        sessionId,
        role,
        content: message,
        pageContext: role === "customer" ? pageContext : undefined,
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
      });

      await pusher.trigger("dashboard", "session-update", {
        sessionId,
        lastMessage: savedMessage.content,
        role: savedMessage.role,
        pageContext,
      });
    } catch (pusherError) {
      console.error("Pusher error (non-fatal):", pusherError);
    }

    return NextResponse.json({
      message: savedMessage,
      sessionStatus: session.status,
    });
  } catch (error) {
    console.error("Chat API error:", error);
    return NextResponse.json(
      { error: "Failed to process message" },
      { status: 500 }
    );
  }
}
