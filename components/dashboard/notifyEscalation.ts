import { isTabAway } from "@/lib/notifications/desktop";

const REASON_LABELS: Record<string, string> = {
  complex_fitment: "Fitment question — service team needed",
  tech_air_service: "Tech-Air service request",
  frustrated_customer: "Customer is frustrated",
  explicit_request: "Customer asked for a human",
  policy_exception: "Policy exception",
  unsupported: "Unsupported / escalated",
  no_data: "Bot has no data — customer waiting",
  undeliverable_offer: "Bot offered info it can't deliver",
};

// Dedupe window: if the same sessionId fires within this many ms,
// only the first call actually notifies. Covers the double-fire from
// escalation-requested + session-update(autoEscalated:true) on the
// dashboard channel.
const DEDUPE_MS = 5000;
const recentlyNotified = new Map<string, number>();

/** Test-only helper to clear the dedupe map between unit tests. */
export function __resetDedupe() {
  recentlyNotified.clear();
}

function showNotification(label: string, payload: {
  sessionId: string;
  reason: string;
  urgency: string;
}) {
  try {
    new Notification(label, {
      body: payload.urgency === "high" ? "High urgency" : "Open the dashboard to claim",
      tag: `escalation-${payload.sessionId}`,
      requireInteraction: payload.urgency === "high",
    });
  } catch (err) {
    console.warn("notifyEscalation: Notification constructor failed", err);
  }
}

function playChime() {
  try {
    const audio = new Audio("/sounds/escalation-ping.wav");
    audio.volume = 0.5;
    const result = audio.play();
    if (result && typeof result.then === "function") {
      result.catch((err) => {
        // Chrome's autoplay policy blocks audio without prior user
        // interaction. Log so we can see this in the console rather than
        // silently failing.
        console.warn("notifyEscalation: audio.play() blocked", err?.name ?? err);
      });
    }
  } catch (err) {
    console.warn("notifyEscalation: Audio constructor failed", err);
  }
}

export function notifyEscalation(payload: {
  sessionId: string;
  reason: string;
  urgency: string;
}) {
  // Dedupe rapid duplicates from multiple Pusher events for the same session.
  const last = recentlyNotified.get(payload.sessionId);
  const now = Date.now();
  if (last && now - last < DEDUPE_MS) return;
  recentlyNotified.set(payload.sessionId, now);
  // Best-effort cleanup so the map doesn't grow forever.
  if (recentlyNotified.size > 100) {
    const cutoff = now - DEDUPE_MS;
    recentlyNotified.forEach((t, k) => {
      if (t < cutoff) recentlyNotified.delete(k);
    });
  }

  const label = REASON_LABELS[payload.reason] || `Escalation: ${payload.reason}`;

  // Chime fires regardless of notification permission state.
  playChime();

  // Desktop notification — surfaces on Apple Watch via macOS forwarding.
  // Only fire it when the dashboard tab is NOT focused: if the agent is
  // actively looking at the dashboard the chime + in-app UI are enough, and a
  // system notification would just be redundant noise.
  try {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (!isTabAway()) return;

    if (Notification.permission === "granted") {
      showNotification(label, payload);
    } else if (Notification.permission !== "denied") {
      // Permission is "default". Ask for it AND fire the notification once
      // the user grants it, so the very first escalation isn't lost to the
      // permission dialog.
      Notification.requestPermission()
        .then((perm) => {
          if (perm === "granted" && isTabAway()) showNotification(label, payload);
        })
        .catch(() => {});
    }
  } catch {
    /* desktop notifications not available */
  }
}
