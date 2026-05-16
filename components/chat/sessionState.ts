export type SessionState = "idle" | "waiting" | "active_ai" | "active_human" | "closed";

type MessageRole = "customer" | "agent" | "ai" | "system";

/**
 * Pure state-transition function for the chat session banner.
 *
 * An inbound AI message is authoritative proof that the AI now owns the
 * session — it overrides "active_human" regardless of whether the
 * session-released / session-claimed Pusher events were delivered first.
 */
export function resolveSessionState(
  prev: SessionState,
  role: MessageRole
): SessionState {
  if (role === "agent") return "active_human";
  if (role === "ai" && (prev === "idle" || prev === "waiting" || prev === "active_human"))
    return "active_ai";
  return prev;
}
