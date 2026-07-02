/**
 * Phase 2a AI pause mechanism. When an escalation decides a human owes the
 * customer an answer, the session's AI is paused: inline AI turns are
 * suppressed until a human claims/releases the session or the pause times
 * out (lazily evaluated — no cron needed).
 *
 * All customer-facing copy for the handoff lives here (variants approved by
 * Antonio 7/2/2026, Phase 2a Step 4).
 */

import { db } from "@/lib/db";
import { sessions, chatEvents, messages } from "@/lib/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { getPusher } from "@/lib/pusher/server";
import { sessionChannel, DASHBOARD_CHANNEL } from "@/lib/pusher/channels";
import { log, serializeError } from "@/lib/log";

/** Antonio 7/2/2026: pause clears on human claim/reply OR this timeout,
 *  whichever comes first. */
export const AI_PAUSE_TIMEOUT_MINUTES = 45;

/** Active handoff — agents online (copy variant 1). */
export const HANDOFF_HUMAN_COMING =
  "Let me get someone from our team on this — hang tight one moment, they'll pick up right here in this chat.";

/** Active handoff — after hours / no agents (copy variant 3); fires alongside
 *  the request-contact event that renders the email-capture form. */
export const HANDOFF_AFTER_HOURS =
  "I've flagged this for the team, but nobody's available at the moment — if you share your email, they'll reach out directly rather than leaving you hanging.";

/** One-time acknowledgment when the customer keeps typing while paused.
 *  Sent at most once in a row — repeated follow-ups stay quiet. */
export const PAUSED_HOLDING_ACK =
  "Thanks — I've added that to the conversation for our team. They'll pick things up right here as soon as someone's available.";

export type AiPauseState = "none" | "active" | "expired";

export function getAiPauseState(
  session: { aiPausedAt: Date | string | null },
  now: Date = new Date()
): AiPauseState {
  if (!session.aiPausedAt) return "none";
  const pausedAtMs = new Date(session.aiPausedAt).getTime();
  const ageMs = now.getTime() - pausedAtMs;
  return ageMs < AI_PAUSE_TIMEOUT_MINUTES * 60_000 ? "active" : "expired";
}

export async function pauseAi(sessionId: string, reason: string): Promise<void> {
  await db
    .update(sessions)
    .set({ aiPausedAt: new Date(), aiPauseReason: reason })
    .where(eq(sessions.id, sessionId));
  try {
    await db.insert(chatEvents).values({
      sessionId,
      type: "ai_paused",
      metadata: { reason },
    });
  } catch (err) {
    log.warn("sessions.ai_pause_event_failed", {
      sessionId,
      error: serializeError(err),
    });
  }
}

export async function clearAiPause(
  sessionId: string,
  clearedBy: "human_claim" | "released_to_queue" | "timeout"
): Promise<void> {
  await db
    .update(sessions)
    .set({ aiPausedAt: null, aiPauseReason: null })
    .where(eq(sessions.id, sessionId));
  try {
    await db.insert(chatEvents).values({
      sessionId,
      type: "ai_pause_cleared",
      metadata: { clearedBy },
    });
  } catch (err) {
    log.warn("sessions.ai_pause_clear_event_failed", {
      sessionId,
      error: serializeError(err),
    });
  }
}

async function fanOutAiMessage(
  saved: typeof messages.$inferSelect
): Promise<void> {
  try {
    const pusher = getPusher();
    await pusher.trigger(sessionChannel(saved.sessionId), "new-message", {
      id: saved.id,
      role: "ai",
      content: saved.content,
      sentAt: saved.sentAt,
    });
    await pusher.trigger(DASHBOARD_CHANNEL, "session-update", {
      sessionId: saved.sessionId,
      lastMessage: saved.content,
      role: "ai",
    });
  } catch (err) {
    log.warn("sessions.ai_pause_pusher_failed", {
      sessionId: saved.sessionId,
      error: serializeError(err),
    });
  }
}

/**
 * Persist the active-handoff message that accompanies a new pause. The
 * runAi caller skips this when the model's own reply already reads as a
 * handoff (see replyAlreadyReadsAsHandoff).
 */
export async function persistHandoffMessage(
  sessionId: string,
  agentsOnline: boolean
): Promise<typeof messages.$inferSelect | null> {
  const content = agentsOnline ? HANDOFF_HUMAN_COMING : HANDOFF_AFTER_HOURS;
  const [saved] = await db
    .insert(messages)
    .values({ sessionId, role: "ai", content, confidence: "high" })
    .returning();
  if (!saved) return null;
  await fanOutAiMessage(saved);
  return saved;
}

/**
 * Customer typed into a paused session: acknowledge once, then stay quiet.
 * Returns the persisted ack, or null when the last AI message is already
 * the ack (so repeated follow-ups don't spam the customer).
 */
export async function persistHoldingAckIfNeeded(
  sessionId: string
): Promise<typeof messages.$inferSelect | null> {
  const [lastAi] = await db
    .select({ id: messages.id, content: messages.content })
    .from(messages)
    .where(and(eq(messages.sessionId, sessionId), eq(messages.role, "ai")))
    .orderBy(desc(messages.sentAt))
    .limit(1);
  if (lastAi?.content === PAUSED_HOLDING_ACK) return null;

  const [saved] = await db
    .insert(messages)
    .values({
      sessionId,
      role: "ai",
      content: PAUSED_HOLDING_ACK,
      confidence: "high",
    })
    .returning();
  if (!saved) return null;
  await fanOutAiMessage(saved);
  return saved;
}
