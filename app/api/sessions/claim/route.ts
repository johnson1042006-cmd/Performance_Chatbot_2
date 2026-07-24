import { NextRequest, NextResponse } from "next/server";
import { getStaffSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { sessions } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { claimByHuman } from "@/lib/sessions/state";
import { getPusher } from "@/lib/pusher/server";
import { sessionChannel, DASHBOARD_CHANNEL } from "@/lib/pusher/channels";
import { log, serializeError } from "@/lib/log";

export async function POST(req: NextRequest) {
  const requestId = crypto.randomUUID();
  try {
    const session = await getStaffSession();
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

    // Existence pre-check: distinguishes "not found" from "claimed by other"
    // so the dashboard can show the right toast. Mirrors the release route.
    const [existing] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .limit(1);

    if (!existing) {
      return NextResponse.json(
        { error: "Session not found" },
        { status: 404 }
      );
    }

    const result = await claimByHuman({
      sessionId,
      userId: session.user.id,
    });

    if (!result.claimed) {
      return NextResponse.json(
        {
          error: "Session already claimed",
          claimedBy: result.claimedByUser ?? null,
        },
        { status: 409 }
      );
    }

    try {
      const pusher = getPusher();
      await pusher.trigger(sessionChannel(sessionId), "session-claimed", {
        agentId: session.user.id,
        agentName: session.user.name,
        kind: "human",
      });
      await pusher.trigger(DASHBOARD_CHANNEL, "session-claimed", {
        sessionId,
        agentId: session.user.id,
        agentName: session.user.name,
        kind: "human",
      });
    } catch (pusherError) {
      log.warn("sessions.claim.pusher_failed", {
        requestId,
        sessionId,
        error: serializeError(pusherError),
      });
    }

    return NextResponse.json({ session: result.session });
  } catch (error) {
    log.error("sessions.claim_failed", { requestId, error: serializeError(error) });
    return NextResponse.json(
      { error: "Failed to claim session" },
      { status: 500 }
    );
  }
}
