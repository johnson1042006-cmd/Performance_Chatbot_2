import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { sessions } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { releaseToQueue } from "@/lib/sessions/state";
import { anyAgentsOnline } from "@/lib/presence";
import { knowledgeBase } from "@/lib/db/schema";
import { getPusher } from "@/lib/pusher/server";
import { log, serializeError } from "@/lib/log";

const DEFAULT_FALLBACK_SECONDS = 60;

async function getFallbackSeconds(): Promise<number | null> {
  try {
    const [entry] = await db
      .select()
      .from(knowledgeBase)
      .where(eq(knowledgeBase.topic, "bot_settings"))
      .limit(1);
    if (!entry) return null;
    const p = JSON.parse(entry.content);
    if (!p.aiEnabled) return null;
    return Math.min(300, Math.max(10, Number(p.fallbackTimerSeconds) || DEFAULT_FALLBACK_SECONDS));
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const requestId = crypto.randomUUID();
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

    // Only the owning agent or a manager can release
    if (
      chatSession.claimedByUserId &&
      chatSession.claimedByUserId !== session.user.id &&
      session.user.role !== "store_manager"
    ) {
      return NextResponse.json(
        { error: "Only the claiming agent or a manager can release this session" },
        { status: 403 }
      );
    }

    // Determine new ai_claim_due_at when releasing
    const fallbackSeconds = await getFallbackSeconds();
    let newAiClaimDueAt: Date | null = null;
    if (fallbackSeconds !== null) {
      const agentsOnline = await anyAgentsOnline();
      if (agentsOnline) {
        newAiClaimDueAt = new Date(Date.now() + fallbackSeconds * 1000);
      }
    }

    const updated = await releaseToQueue({
      sessionId,
      actorUserId: session.user.id,
      aiClaimDueAt: newAiClaimDueAt,
    });

    try {
      const pusher = getPusher();
      await pusher.trigger(`session-${sessionId}`, "session-released", {
        agentId: session.user.id,
      });
      await pusher.trigger("dashboard", "session-released", { sessionId });
    } catch (pusherError) {
      log.warn("sessions.release.pusher_failed", {
        requestId,
        sessionId,
        error: serializeError(pusherError),
      });
    }

    return NextResponse.json({ session: updated });
  } catch (error) {
    log.error("sessions.release_failed", { requestId, error: serializeError(error) });
    return NextResponse.json(
      { error: "Failed to release session" },
      { status: 500 }
    );
  }
}
