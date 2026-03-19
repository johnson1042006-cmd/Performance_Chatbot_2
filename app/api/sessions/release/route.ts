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

    const [updated] = await db
      .update(sessions)
      .set({
        status: "active_ai",
        claimedByUserId: null,
        claimedAt: null,
      })
      .where(eq(sessions.id, sessionId))
      .returning();

    if (!updated) {
      return NextResponse.json(
        { error: "Session not found" },
        { status: 404 }
      );
    }

    try {
      const pusher = getPusher();
      await pusher.trigger(`session-${sessionId}`, "session-released", {
        agentId: session.user.id,
      });
      await pusher.trigger("dashboard", "session-released", {
        sessionId,
      });
    } catch (pusherError) {
      console.error("Pusher error (non-fatal):", pusherError);
    }

    return NextResponse.json({ session: updated });
  } catch (error) {
    console.error("Release error:", error);
    return NextResponse.json(
      { error: "Failed to release session" },
      { status: 500 }
    );
  }
}
