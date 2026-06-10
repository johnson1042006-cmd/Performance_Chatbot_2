export type SessionState = "idle" | "waiting" | "active_ai" | "active_human" | "closed";

type MessageRole = "customer" | "agent" | "ai" | "system";

/**
 * Pure state-transition function for the chat session banner.
 *
 * An agent message always proves human ownership. An AI message upgrades
 * idle/waiting to active_ai, but NEVER downgrades active_human: once an
 * agent has joined, a late in-flight AI reply must not flip the banner back
 * to "AI Assistant is helping you". If the AI legitimately re-claims (agent
 * released), the session-released Pusher event moves state to "waiting"
 * first, and the next AI message upgrades from there.
 */
export function resolveSessionState(
  prev: SessionState,
  role: MessageRole
): SessionState {
  if (role === "agent") return "active_human";
  if (role === "ai" && (prev === "idle" || prev === "waiting"))
    return "active_ai";
  return prev;
}
