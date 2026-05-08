/**
 * Single source of truth for session state transitions.
 * All writes to claimed_by_kind / claimed_by / closed_at go through here.
 * `sessions.status` is always kept in sync by syncStatus() — never set directly.
 */
import { db } from "@/lib/db";
import { sessions, users, chatEvents } from "@/lib/db/schema";
import { eq, isNull, lt, and, or, ne } from "drizzle-orm";
import { getPusher } from "@/lib/pusher/server";
import { runAiTurn } from "@/lib/ai/runAi";
import { sql } from "drizzle-orm";
import { log, serializeError } from "@/lib/log";
import { enqueueTag } from "@/lib/ai/tagger";

type ClaimKind = "ai" | "human";
type SessionStatus = "waiting" | "active_human" | "active_ai" | "closed";

// ─── Pure derivation ────────────────────────────────────────────────────────

export function syncStatus(opts: {
  claimedByKind: ClaimKind | null | undefined;
  closedAt: Date | null | undefined;
}): SessionStatus {
  if (opts.closedAt) return "closed";
  if (opts.claimedByKind === "human") return "active_human";
  if (opts.claimedByKind === "ai") return "active_ai";
  return "waiting";
}

// ─── Claim by human (race-safe) ─────────────────────────────────────────────

export interface ClaimResult {
  session: typeof sessions.$inferSelect;
  claimed: boolean;
  /** Populated when claimed=false — the agent who already holds it */
  claimedByUser?: { id: string; name: string } | null;
}

export async function claimByHuman({
  sessionId,
  userId,
}: {
  sessionId: string;
  userId: string;
}): Promise<ClaimResult> {
  const now = new Date();

  // Atomic conditional update: only succeeds when no one else holds the session
  const [won] = await db
    .update(sessions)
    .set({
      claimedByUserId: userId,
      claimedByKind: "human",
      claimedAt: now,
      status: "active_human",
      aiClaimDueAt: null,
    })
    .where(
      and(
        eq(sessions.id, sessionId),
        isNull(sessions.claimedByUserId)
      )
    )
    .returning();

  if (won) {
    await logChatEvent({
      sessionId,
      type: "claimed_by_human",
      actorUserId: userId,
    });
    return { session: won, claimed: true };
  }

  // Lost the race — fetch current holder
  const [current] = await db
    .select({
      session: sessions,
      holderName: users.name,
      holderId: users.id,
    })
    .from(sessions)
    .leftJoin(users, eq(sessions.claimedByUserId, users.id))
    .where(eq(sessions.id, sessionId))
    .limit(1);

  return {
    session: current.session,
    claimed: false,
    claimedByUser: current.holderId
      ? { id: current.holderId, name: current.holderName ?? "Unknown" }
      : null,
  };
}

// ─── Claim by AI (race-safe) ─────────────────────────────────────────────────

export async function claimByAi(
  sessionId: string
): Promise<typeof sessions.$inferSelect | null> {
  const [won] = await db
    .update(sessions)
    .set({
      claimedByKind: "ai",
      claimedAt: new Date(),
      status: "active_ai",
      aiClaimDueAt: null,
      claimedByUserId: null,
    })
    .where(
      and(
        eq(sessions.id, sessionId),
        isNull(sessions.claimedByUserId),
        isNull(sessions.claimedByKind)
      )
    )
    .returning();

  if (won) {
    await logChatEvent({ sessionId, type: "claimed_by_ai" });
  }
  return won ?? null;
}

// ─── Release back to queue ───────────────────────────────────────────────────

export async function releaseToQueue({
  sessionId,
  actorUserId,
  aiClaimDueAt,
}: {
  sessionId: string;
  actorUserId: string;
  /** If aiEnabled and agents are online, pass a new due time; else null */
  aiClaimDueAt?: Date | null;
}): Promise<typeof sessions.$inferSelect | null> {
  const now = new Date();
  const [updated] = await db
    .update(sessions)
    .set({
      claimedByUserId: null,
      claimedByKind: null,
      claimedAt: null,
      status: "waiting",
      aiClaimDueAt: aiClaimDueAt ?? null,
      // Reset activity so the stale-sweep gives the freshly-queued session
      // a full window to be reclaimed (by AI or another agent) before it
      // could possibly be closed.
      lastCustomerActivityAt: now,
    })
    .where(eq(sessions.id, sessionId))
    .returning();

  if (updated) {
    await logChatEvent({
      sessionId,
      type: "released_to_queue",
      actorUserId,
    });
  }
  return updated ?? null;
}

// ─── Reassign ────────────────────────────────────────────────────────────────

export async function reassign({
  sessionId,
  actorUserId,
  targetUserId,
}: {
  sessionId: string;
  actorUserId: string;
  targetUserId: string;
}): Promise<typeof sessions.$inferSelect | null> {
  const [updated] = await db
    .update(sessions)
    .set({
      claimedByUserId: targetUserId,
      claimedByKind: "human",
      claimedAt: new Date(),
      status: "active_human",
      aiClaimDueAt: null,
    })
    .where(eq(sessions.id, sessionId))
    .returning();

  if (updated) {
    await logChatEvent({
      sessionId,
      type: "reassigned",
      actorUserId,
      targetUserId,
    });
  }
  return updated ?? null;
}

// ─── Record customer activity ─────────────────────────────────────────────────

export async function recordCustomerActivity(sessionId: string): Promise<void> {
  await db
    .update(sessions)
    .set({ lastCustomerActivityAt: new Date() })
    .where(eq(sessions.id, sessionId));
}

export async function recordSessionHeartbeat(sessionId: string): Promise<void> {
  await db
    .update(sessions)
    .set({
      lastHeartbeatAt: new Date(),
      lastCustomerActivityAt: new Date(),
    })
    .where(eq(sessions.id, sessionId));
}

// ─── Process due AI claims (tick sweep) ─────────────────────────────────────

export async function processDueAiClaims(): Promise<void> {
  const now = new Date();

  // Find sessions where the AI claim window has elapsed and no human claimed
  const dueSessions = await db
    .select()
    .from(sessions)
    .where(
      and(
        isNull(sessions.claimedByUserId),
        isNull(sessions.claimedByKind),
        lt(sessions.aiClaimDueAt, now),
        sql`${sessions.status} != 'closed'`
      )
    )
    .limit(20);

  for (const session of dueSessions) {
    const won = await claimByAi(session.id);
    if (!won) continue; // human beat us

    // Fire the AI response. runAiTurn handles buildPrompt + callClaude
    // (with optional tool use), persistence with confidence/sentiment,
    // new-message + session-update Pusher events, and auto-escalation.
    // We still need to fire the session-claimed events here because the
    // sweep is the actor that just transitioned the session into AI hands.
    try {
      await runAiTurn({
        sessionId: session.id,
        latestMessage: "",
        pageContext: session.pageContext as Record<string, unknown> | null,
      });

      try {
        const pusher = getPusher();
        await pusher.trigger(`session-${session.id}`, "session-claimed", {
          kind: "ai",
        });
        await pusher.trigger("dashboard", "session-claimed", {
          sessionId: session.id,
          kind: "ai",
        });
      } catch (pusherErr) {
        log.warn("sessions.ai_fallback_session_claimed_pusher_failed", {
          sessionId: session.id,
          error: serializeError(pusherErr),
        });
      }
    } catch (err) {
      log.error("sessions.ai_fallback_failed", {
        sessionId: session.id,
        error: serializeError(err),
      });
    }
  }
}

// ─── Sweep stale sessions ────────────────────────────────────────────────────

const STALE_MINUTES = 2;

export async function sweepStaleSessions(): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_MINUTES * 60 * 1000);

  // A session is stale when BOTH:
  //  - last_customer_activity_at is old (or null)
  //  - last_heartbeat_at is old (or null)
  // This prevents closing a session that has a live tab open.
  //
  // Human-claimed sessions are exempt: an agent who has actively claimed a
  // chat must close it explicitly. Otherwise a customer with a hidden tab
  // would have their human-active conversation auto-closed in 2 minutes.
  const stale = await db
    .update(sessions)
    .set({ status: "closed", closedAt: new Date() })
    .where(
      and(
        ne(sessions.status, "closed"),
        ne(sessions.status, "active_human"),
        or(
          isNull(sessions.lastCustomerActivityAt),
          lt(sessions.lastCustomerActivityAt, cutoff)
        ),
        or(
          isNull(sessions.lastHeartbeatAt),
          lt(sessions.lastHeartbeatAt, cutoff)
        )
      )
    )
    .returning({ id: sessions.id });

  if (stale.length > 0) {
    for (const { id } of stale) {
      await logChatEvent({ sessionId: id, type: "stale_closed" });
      // Phase 5: kick off the AI tagger fire-and-forget. The semaphore in
      // lib/ai/tagger.ts caps concurrent in-flight calls per Lambda and
      // any drops are picked up by the next sweep because intent stays
      // null until persisted.
      enqueueTag(id);
    }
    try {
      const pusher = getPusher();
      await pusher.trigger("dashboard", "session-update", {
        staleClosedIds: stale.map((s) => s.id),
      });
      // Fan out session-closed on each per-session channel so the dashboard
      // right pane and the customer embed can react in real time. Pusher's
      // multi-channel trigger accepts up to 100 channels per call; chunk to
      // be safe.
      const sessionChannels = stale.map((s) => `session-${s.id}`);
      const CHUNK = 100;
      for (let i = 0; i < sessionChannels.length; i += CHUNK) {
        await pusher.trigger(
          sessionChannels.slice(i, i + CHUNK),
          "session-closed",
          { reason: "stale" }
        );
      }
    } catch (err) {
      log.warn("sessions.stale_pusher_failed", {
        staleCount: stale.length,
        error: serializeError(err),
      });
    }
  }

  return stale.length;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

async function logChatEvent(opts: {
  sessionId: string;
  type: typeof chatEvents.$inferInsert["type"];
  actorUserId?: string;
  targetUserId?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    await db.insert(chatEvents).values({
      sessionId: opts.sessionId,
      type: opts.type,
      actorUserId: opts.actorUserId ?? null,
      targetUserId: opts.targetUserId ?? null,
      metadata: opts.metadata ?? null,
    });
  } catch (err) {
    log.error("sessions.log_chat_event_failed", {
      sessionId: opts.sessionId,
      type: opts.type,
      error: serializeError(err),
    });
  }
}
