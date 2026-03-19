import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { sessions } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getPusher } from "@/lib/pusher/server";

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { sessionId } = body;

    if (!sessionId) {
      return NextResponse.json(
        { error: "sessionId is required" },
        { status: 400 }
      );
    }

    const [chatSession] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .limit(1);

    if (!chatSession) {
      return NextResponse.json(
        { error: "Session not found" },
        { status: 404 }
      );
    }

    if (chatSession.status === "active_human" && chatSession.claimedByUserId !== session.user.id) {
      return NextResponse.json(
        { error: "Session already claimed by another agent" },
        { status: 409 }
      );
    }

    const [updated] = await db
      .update(sessions)
      .set({
        status: "active_human",
        claimedByUserId: session.user.id,
        claimedAt: new Date(),
      })
      .where(eq(sessions.id, sessionId))
      .returning();

    try {
      const pusher = getPusher();
      await pusher.trigger(`session-${sessionId}`, "session-claimed", {
        agentId: session.user.id,
        agentName: session.user.name,
      });
      await pusher.trigger("dashboard", "session-claimed", {
        sessionId,
        agentId: session.user.id,
        agentName: session.user.name,
      });
    } catch (pusherError) {
      console.error("Pusher error (non-fatal):", pusherError);
    }

    return NextResponse.json({ session: updated });
  } catch (error) {
    console.error("Claim error:", error);
    return NextResponse.json(
      { error: "Failed to claim session" },
      { status: 500 }
    );
  }
}
