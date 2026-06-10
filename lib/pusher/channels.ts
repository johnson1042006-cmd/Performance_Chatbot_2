/**
 * Single source of truth for Pusher channel names, shared by server triggers
 * and client subscriptions.
 *
 * All channels are PRIVATE (require auth via /api/pusher/auth):
 *  - private-session-{id}: the customer who owns the session (via session
 *    token) or any staff member. Carries the live transcript.
 *  - private-dashboard: staff only. Queue/session updates.
 *  - private-alerts: staff only. Manager alert events.
 */

export const SESSION_CHANNEL_PREFIX = "private-session-";

export function sessionChannel(sessionId: string): string {
  return `${SESSION_CHANNEL_PREFIX}${sessionId}`;
}

/** Extracts the session id from a private-session-* channel name, or null. */
export function sessionIdFromChannel(channelName: string): string | null {
  if (!channelName.startsWith(SESSION_CHANNEL_PREFIX)) return null;
  const id = channelName.slice(SESSION_CHANNEL_PREFIX.length);
  return id.length > 0 ? id : null;
}

export const DASHBOARD_CHANNEL = "private-dashboard";
export const ALERTS_CHANNEL = "private-alerts";
