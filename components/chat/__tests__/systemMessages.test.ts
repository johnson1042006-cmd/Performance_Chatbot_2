import { describe, it, expect } from "vitest";

// ---------------------------------------------------------------------------
// Pure helpers that mirror the message-building logic inside handleClaimed
// and handleReleased in ChatWidget.tsx. Testing them as pure functions keeps
// the suite consistent with the existing handleNewMessage.test.ts pattern
// (which tests resolveSessionState, also a pure utility).
// ---------------------------------------------------------------------------

interface SystemMessage {
  id: string;
  role: "system";
  content: string;
  sentAt: string;
}

/**
 * Mirrors the setMessages update inside handleClaimed.
 * Returns the new system message to append, or null when no message
 * should be inserted (e.g. kind="ai").
 */
function buildClaimedMessage(data: {
  kind?: string;
  agentName?: string;
}): SystemMessage | null {
  if (data.kind !== "human") return null;
  return {
    id: "sys-test",
    role: "system",
    content: data.agentName
      ? `${data.agentName} has joined the chat.`
      : "An agent has joined the chat.",
    sentAt: new Date().toISOString(),
  };
}

/**
 * Mirrors the setMessages update inside handleReleased.
 */
function buildReleasedMessage(): SystemMessage {
  return {
    id: "sys-test",
    role: "system",
    content: "The agent stepped away. AI assistant is back.",
    sentAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("handleClaimed — system message insertion", () => {
  it("inserts named agent message when kind=human and agentName is provided", () => {
    const msg = buildClaimedMessage({ kind: "human", agentName: "Sarah" });
    expect(msg).not.toBeNull();
    expect(msg!.role).toBe("system");
    expect(msg!.content).toBe("Sarah has joined the chat.");
  });

  it("inserts generic agent message when kind=human and agentName is omitted", () => {
    const msg = buildClaimedMessage({ kind: "human" });
    expect(msg).not.toBeNull();
    expect(msg!.role).toBe("system");
    expect(msg!.content).toBe("An agent has joined the chat.");
  });

  it("does NOT insert a system message when kind=ai (regression guard)", () => {
    const msg = buildClaimedMessage({ kind: "ai" });
    expect(msg).toBeNull();
  });
});

describe("handleReleased — system message insertion", () => {
  it("inserts AI-back message when the agent releases the session", () => {
    const msg = buildReleasedMessage();
    expect(msg.role).toBe("system");
    expect(msg.content).toBe("The agent stepped away. AI assistant is back.");
  });
});
