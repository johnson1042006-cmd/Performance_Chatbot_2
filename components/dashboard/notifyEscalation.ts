const REASON_LABELS: Record<string, string> = {
  complex_fitment: "Fitment question — service team needed",
  tech_air_service: "Tech-Air service request",
  frustrated_customer: "Customer is frustrated",
  explicit_request: "Customer asked for a human",
  policy_exception: "Policy exception",
  unsupported: "Unsupported / escalated",
};

export function notifyEscalation(payload: {
  sessionId: string;
  reason: string;
  urgency: string;
}) {
  const label = REASON_LABELS[payload.reason] || `Escalation: ${payload.reason}`;

  // Desktop notification — surfaces on Apple Watch via macOS forwarding.
  try {
    if (typeof window !== "undefined" && "Notification" in window) {
      if (Notification.permission === "granted") {
        new Notification(label, {
          body: payload.urgency === "high" ? "High urgency" : "Open the dashboard to claim",
          tag: `escalation-${payload.sessionId}`,
          requireInteraction: payload.urgency === "high",
        });
      } else if (Notification.permission !== "denied") {
        // Best-effort permission ask; user can decline.
        Notification.requestPermission().catch(() => {});
      }
    }
  } catch {
    /* desktop notifications not available */
  }

  // Audible chime — short, soft. Agents wearing a watch or not at desk get pulled in.
  try {
    const audio = new Audio("/sounds/escalation-ping.wav");
    audio.volume = 0.5;
    void audio.play().catch(() => {});
  } catch {
    /* ignore */
  }
}
