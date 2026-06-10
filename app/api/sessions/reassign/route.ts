import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { reassign } from "@/lib/sessions/state";
import { getPusher } from "@/lib/pusher/server";
import { sessionChannel, DASHBOARD_CHANNEL } from "@/lib/pusher/channels";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { log, serializeError } from "@/lib/log";

export async function POST(req: NextRequest) {
  const requestId = crypto.randomUUID();
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user || session.user.role !== "store_manager") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { sessionId, targetUserId } = body;

    if (!sessionId || !targetUserId) {
      return NextResponse.json(
        { error: "sessionId and targetUserId are required" },
        { status: 400 }
      );
    }

    // Verify target user exists
    const [targetUser] = await db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(eq(users.id, targetUserId))
      .limit(1);

    if (!targetUser) {
      return NextResponse.json(
        { error: "Target user not found" },
        { status: 404 }
      );
    }

    const updated = await reassign({
      sessionId,
      actorUserId: session.user.id,
      targetUserId,
    });

    if (!updated) {
      return NextResponse.json(
        { error: "Session not found" },
        { status: 404 }
      );
    }

    try {
      const pusher = getPusher();
      await pusher.trigger(sessionChannel(sessionId), "session-claimed", {
        agentId: targetUserId,
        agentName: targetUser.name,
        kind: "human",
        reassigned: true,
      });
      await pusher.trigger(DASHBOARD_CHANNEL, "session-claimed", {
        sessionId,
        agentId: targetUserId,
        agentName: targetUser.name,
        kind: "human",
        reassigned: true,
      });
    } catch (pusherError) {
      log.warn("sessions.reassign.pusher_failed", {
        requestId,
        sessionId,
        error: serializeError(pusherError),
      });
    }

    return NextResponse.json({ session: updated });
  } catch (error) {
    log.error("sessions.reassign_failed", { requestId, error: serializeError(error) });
    return NextResponse.json(
      { error: "Failed to reassign session" },
      { status: 500 }
    );
  }
}
