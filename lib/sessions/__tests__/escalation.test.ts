/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Escalation-routing unit tests.
 *
 * Verifies that runAiTurn:
 *  1. Never sets session status to "closed" during auto-escalation
 *  2. Emits Pusher `request-contact` (no agents) or `session-update` (agents)
 *     for all three escalation triggers: sentiment -1, tool call, explicit request
 *  3. Returns autoEscalated metadata so the SSE caller can set EmailCaptureForm
 *  4. Is idempotent — a second turn on the same session does NOT re-insert the
 *     auto_escalated event when hasAutoEscalated already returns true
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock all external I/O before the SUT is imported
// ---------------------------------------------------------------------------

const mockDbSelect = vi.fn();
const mockDbInsert = vi.fn();
const mockDbUpdate = vi.fn();

/**
 * A chainable proxy that is also thenable. All intermediate Drizzle-ORM
 * builder calls (.from, .where, .set, .values, .orderBy, …) return the same
 * proxy; terminal calls (.limit, .returning) and awaiting the chain both
 * invoke the supplied terminal mock.
 */
const chain = (terminal: (...a: any[]) => any) => {
  const p: any = new Proxy(
    {},
    {
      get(_t, prop) {
        if (typeof prop === "symbol") return undefined;
        if (prop === "then") {
          return (resolve: (v: unknown) => void, reject: (e: unknown) => void) => {
            try {
              Promise.resolve(terminal()).then(resolve, reject);
            } catch (err) {
              reject(err);
            }
          };
        }
        return (..._args: any[]) => {
          if (["limit", "returning", "offset"].includes(prop as string))
            return terminal(..._args);
          return p;
        };
      },
    }
  );
  return () => p;
};

vi.mock("@/lib/db", () => ({
  db: {
    select: chain(mockDbSelect),
    insert: chain(mockDbInsert),
    update: chain(mockDbUpdate),
  },
}));

vi.mock("@/lib/db/schema", () => ({
  messages: { sessionId: "session_id", role: "role", sentAt: "sent_at" },
  chatEvents: { sessionId: "session_id", type: "type" },
  sessions: { id: "id", aiClaimDueAt: "ai_claim_due_at" },
}));

// drizzle-orm helpers are used as query-builder tag objects; they don't need
// real implementations — they just need to exist so destructuring doesn't throw.
vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual };
});

const mockTrigger = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/pusher/server", () => ({
  getPusher: () => ({ trigger: mockTrigger }),
}));

vi.mock("@/lib/ai/buildPrompt", () => ({
  buildPrompt: vi.fn().mockResolvedValue({
    system: "system prompt",
    conversationMessages: [{ role: "user", content: "hello" }],
  }),
}));

const mockCallClaude = vi.fn();
vi.mock("@/lib/ai/callClaude", () => ({
  callClaude: mockCallClaude,
  CALL_CLAUDE_ERROR_MESSAGE:
    "I'm having trouble connecting right now. A human agent will be with you shortly, or please try sending your message again.",
}));

const mockEscalateToHuman = vi.fn().mockResolvedValue("Connecting you now.");
vi.mock("@/lib/ai/tools", () => ({
  tools: [],
  toolHandlers: {},
  escalateToHuman: mockEscalateToHuman,
}));

const mockAssessConfidence = vi.fn();
const mockAssessSentiment = vi.fn();
vi.mock("@/lib/ai/quality", () => ({
  assessConfidence: mockAssessConfidence,
  assessSentiment: mockAssessSentiment,
}));

const mockAgentsOnline = vi.fn();
vi.mock("@/lib/presence", () => ({
  anyAgentsOnline: mockAgentsOnline,
}));

// Phase 2a: pause machinery is mocked so tests can assert WHEN runAiTurn
// pauses without exercising the (separately unit-tested) DB writes.
const mockPauseAi = vi.fn().mockResolvedValue(undefined);
const mockPersistHandoff = vi.fn().mockResolvedValue(null);
vi.mock("@/lib/sessions/aiPause", () => ({
  pauseAi: mockPauseAi,
  persistHandoffMessage: mockPersistHandoff,
}));

vi.mock("@/lib/log", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  serializeError: (err: unknown) =>
    err instanceof Error ? { name: err.name, message: err.message } : { message: String(err) },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SESSION_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const SAVED_MESSAGE = {
  id: "msg-001",
  sessionId: SESSION_ID,
  role: "ai",
  content: "I'll connect you now.",
  sentAt: new Date().toISOString(),
};

function resetMocks() {
  vi.clearAllMocks();
  mockCallClaude.mockResolvedValue("I'll connect you now.");
  mockAssessConfidence.mockReturnValue({ confidence: "high", reasons: [] });
  mockAssessSentiment.mockReturnValue({ score: 0, reasons: [] });
  mockEscalateToHuman.mockResolvedValue("Connecting you now.");
  mockTrigger.mockResolvedValue(undefined);
  mockDbUpdate.mockResolvedValue([]);
  mockDbInsert.mockResolvedValue([SAVED_MESSAGE]);
  // By default: no prior auto_escalated event, no recent customer messages
  mockDbSelect.mockResolvedValue([]);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runAiTurn auto-escalation", () => {
  beforeEach(resetMocks);

  // ── 1. Sentiment trigger (-1 score) ─────────────────────────────────────

  describe("sentiment === -1 trigger", () => {
    it("does NOT update session status to closed", async () => {
      mockAgentsOnline.mockResolvedValue(false);
      mockAssessSentiment.mockReturnValue({ score: -1, reasons: ["phrase: this is ridiculous"] });
      // First select → loadRecentCustomerMessages; second → hasAutoEscalated (empty)
      mockDbSelect.mockResolvedValueOnce([]); // humanOwnsSession: not claimed
      mockDbSelect.mockResolvedValueOnce([{ content: "this is ridiculous" }, { content: "useless" }]);
      mockDbSelect.mockResolvedValueOnce([]); // hasAutoEscalated: false

      const { runAiTurn } = await import("@/lib/ai/runAi");
      await runAiTurn({ sessionId: SESSION_ID, latestMessage: "useless bot" });

      // No db.update call should set status = "closed"
      const updateCalls = mockDbUpdate.mock.calls.map((c) => JSON.stringify(c));
      expect(updateCalls.some((c) => c.includes("closed"))).toBe(false);
    });

    it("fires request-contact Pusher event when no agents online", async () => {
      mockAgentsOnline.mockResolvedValue(false);
      mockAssessSentiment.mockReturnValue({ score: -1, reasons: ["phrase: this is ridiculous"] });
      mockDbSelect.mockResolvedValueOnce([]); // humanOwnsSession: not claimed
      mockDbSelect.mockResolvedValueOnce([{ content: "this is ridiculous" }, { content: "useless" }]);
      mockDbSelect.mockResolvedValueOnce([]); // hasAutoEscalated: false

      const { runAiTurn } = await import("@/lib/ai/runAi");
      await runAiTurn({ sessionId: SESSION_ID, latestMessage: "useless bot" });

      const requestContact = mockTrigger.mock.calls.find(
        ([channel, event]) =>
          channel === `private-session-${SESSION_ID}` && event === "request-contact"
      );
      expect(requestContact).toBeDefined();
      expect(requestContact![2]).toMatchObject({ reason: "frustrated_customer" });
    });

    it("fires session-update on dashboard when agents are online", async () => {
      mockAgentsOnline.mockResolvedValue(true);
      mockAssessSentiment.mockReturnValue({ score: -1, reasons: [] });
      mockDbSelect.mockResolvedValueOnce([]); // humanOwnsSession: not claimed
      mockDbSelect.mockResolvedValueOnce([{ content: "speak to a manager" }, { content: "ridiculous" }]);
      mockDbSelect.mockResolvedValueOnce([]); // hasAutoEscalated: false

      const { runAiTurn } = await import("@/lib/ai/runAi");
      await runAiTurn({ sessionId: SESSION_ID, latestMessage: "speak to a manager" });

      // runAiTurn fires two session-update events to "dashboard":
      //   1. The AI message update (with lastMessage / role / confidence / sentiment)
      //   2. The auto-escalation update (with autoEscalated: true)
      // We want the escalation one specifically.
      const escalationUpdate = mockTrigger.mock.calls.find(
        ([channel, event, payload]) =>
          channel === "private-dashboard" &&
          event === "session-update" &&
          payload?.autoEscalated === true
      );
      expect(escalationUpdate).toBeDefined();
      expect(escalationUpdate![2]).toMatchObject({ sessionId: SESSION_ID, autoEscalated: true });
    });

    it("returns autoEscalated metadata for SSE caller", async () => {
      mockAgentsOnline.mockResolvedValue(false);
      mockAssessSentiment.mockReturnValue({ score: -1, reasons: [] });
      mockDbSelect.mockResolvedValueOnce([]); // humanOwnsSession: not claimed
      mockDbSelect.mockResolvedValueOnce([{ content: "this is ridiculous" }, { content: "where is my order" }]);
      mockDbSelect.mockResolvedValueOnce([]); // hasAutoEscalated: false

      const { runAiTurn } = await import("@/lib/ai/runAi");
      const result = await runAiTurn({ sessionId: SESSION_ID, latestMessage: "where is my order" });

      expect(result.autoEscalated).not.toBeNull();
      expect(result.autoEscalated?.reason).toBe("frustrated_customer");
      expect(result.autoEscalated?.agentsOnline).toBe(false);
    });
  });

  // ── 2. Explicit human request trigger ───────────────────────────────────

  describe("isExplicitHumanRequest trigger (single first message)", () => {
    it("fires request-contact for 'real human' in message, no agents", async () => {
      mockAgentsOnline.mockResolvedValue(false);
      // Sentiment stays 0 — single message, normal score
      mockAssessSentiment.mockReturnValue({ score: 0, reasons: [] });
      mockDbSelect.mockResolvedValueOnce([]); // humanOwnsSession: not claimed
      mockDbSelect.mockResolvedValueOnce([]); // loadRecentCustomerMessages: empty prior history
      mockDbSelect.mockResolvedValueOnce([]); // hasAutoEscalated: false

      const { runAiTurn } = await import("@/lib/ai/runAi");
      const result = await runAiTurn({
        sessionId: SESSION_ID,
        latestMessage: "I want to speak to a real human RIGHT NOW, not your stupid bot.",
      });

      expect(result.autoEscalated).not.toBeNull();
      expect(result.autoEscalated?.reason).toBe("explicit_request");

      const requestContact = mockTrigger.mock.calls.find(
        ([channel, event]) =>
          channel === `private-session-${SESSION_ID}` && event === "request-contact"
      );
      expect(requestContact).toBeDefined();
    });

    it("fires request-contact for 'talk to a human'", async () => {
      mockAgentsOnline.mockResolvedValue(false);
      mockAssessSentiment.mockReturnValue({ score: 0, reasons: [] });
      mockDbSelect.mockResolvedValueOnce([]); // humanOwnsSession: not claimed
      mockDbSelect.mockResolvedValueOnce([]);
      mockDbSelect.mockResolvedValueOnce([]);

      const { runAiTurn } = await import("@/lib/ai/runAi");
      const result = await runAiTurn({
        sessionId: SESSION_ID,
        latestMessage: "Please let me talk to a human instead.",
      });

      expect(result.autoEscalated?.reason).toBe("explicit_request");
    });

    it("does NOT close the session for an explicit human request", async () => {
      mockAgentsOnline.mockResolvedValue(false);
      mockAssessSentiment.mockReturnValue({ score: 0, reasons: [] });
      mockDbSelect.mockResolvedValueOnce([]); // humanOwnsSession: not claimed
      mockDbSelect.mockResolvedValueOnce([]);
      mockDbSelect.mockResolvedValueOnce([]);

      const { runAiTurn } = await import("@/lib/ai/runAi");
      await runAiTurn({
        sessionId: SESSION_ID,
        latestMessage: "I need to speak to a human agent please.",
      });

      const updateCalls = mockDbUpdate.mock.calls.map((c) => JSON.stringify(c));
      expect(updateCalls.some((c) => c.includes("closed"))).toBe(false);
    });

    // Expanded phrasings — the customer-facing banner literally says
    // "A team member can take over if needed", so these must all escalate.
    const explicitPhrases = [
      "can I talk to a team member",
      "can i talk to a teammate",
      "I'd like to speak with someone",
      "connect me with a rep",
      "chat with a real person",
    ];
    for (const phrase of explicitPhrases) {
      it(`escalates as explicit_request for: "${phrase}"`, async () => {
        mockAgentsOnline.mockResolvedValue(false);
        mockAssessSentiment.mockReturnValue({ score: 0, reasons: [] });
        mockAssessConfidence.mockReturnValue({ confidence: "high", reasons: [] });
        mockDbSelect.mockResolvedValueOnce([]); // humanOwnsSession: not claimed
        mockDbSelect.mockResolvedValueOnce([]); // loadRecentCustomerMessages
        mockDbSelect.mockResolvedValueOnce([]); // hasAutoEscalated: false

        const { runAiTurn } = await import("@/lib/ai/runAi");
        const result = await runAiTurn({
          sessionId: SESSION_ID,
          latestMessage: phrase,
        });

        expect(result.autoEscalated).not.toBeNull();
        expect(result.autoEscalated?.reason).toBe("explicit_request");
      });
    }

    it('does NOT escalate for "do you sell helmets"', async () => {
      mockAgentsOnline.mockResolvedValue(false);
      mockAssessSentiment.mockReturnValue({ score: 0, reasons: [] });
      mockAssessConfidence.mockReturnValue({ confidence: "high", reasons: [] });
      // No escalation trigger fires, so only humanOwnsSession +
      // loadRecentCustomerMessages run (hasAutoEscalated is guarded behind
      // shouldEscalate) — queue exactly two values so we don't leave a
      // dangling mockResolvedValueOnce that would poison the next test.
      mockDbSelect.mockResolvedValueOnce([]); // humanOwnsSession: not claimed
      mockDbSelect.mockResolvedValueOnce([{ content: "do you sell helmets" }]);

      const { runAiTurn } = await import("@/lib/ai/runAi");
      const result = await runAiTurn({
        sessionId: SESSION_ID,
        latestMessage: "do you sell helmets",
      });

      expect(result.autoEscalated).toBeNull();
    });
  });

  // ── 3. Tool-based escalation trigger ────────────────────────────────────

  describe("aiEscalatedViaTool trigger", () => {
    // Enable tool usage so runAiTurn wires up the onToolCall callback.
    // Without USE_AI_TOOLS=true the callback is never passed to callClaude.
    beforeEach(() => {
      process.env.USE_AI_TOOLS = "true";
    });
    afterEach(() => {
      delete process.env.USE_AI_TOOLS;
    });

    it("fires request-contact without calling escalateToHuman again", async () => {
      mockAgentsOnline.mockResolvedValue(false);
      mockAssessSentiment.mockReturnValue({ score: 0, reasons: [] });
      // Simulate Claude calling the escalate_to_human tool by invoking the
      // onToolCall hook that runAiTurn passes to callClaude.
      mockCallClaude.mockImplementation(
        async (
          _system: string,
          _msgs: unknown[],
          opts: { onToolCall?: (e: any) => Promise<void> }
        ) => {
          if (opts?.onToolCall) {
            await opts.onToolCall({
              name: "escalate_to_human",
              input: { reason: "frustrated_customer" },
              output: { ok: true },
              durationMs: 100,
              isError: false,
            });
          }
          return "I'm connecting you now.";
        }
      );
      mockDbSelect.mockResolvedValueOnce([]); // humanOwnsSession: not claimed
      mockDbSelect.mockResolvedValueOnce([]);
      mockDbSelect.mockResolvedValueOnce([]);

      const { runAiTurn } = await import("@/lib/ai/runAi");
      const result = await runAiTurn({
        sessionId: SESSION_ID,
        latestMessage: "I need help with my order",
      });

      // The auto-escalation block must NOT call escalateToHuman a second time
      // (the tool handler already fired it, and since we've mocked the entire
      // tools module, the mock call count reflects only runAiTurn's own block).
      expect(mockEscalateToHuman).not.toHaveBeenCalled();

      // Pusher request-contact MUST still fire even though we skipped the
      // escalateToHuman call
      const requestContact = mockTrigger.mock.calls.find(
        ([channel, event]) =>
          channel === `private-session-${SESSION_ID}` && event === "request-contact"
      );
      expect(requestContact).toBeDefined();

      // autoEscalated must be populated for the SSE message event
      expect(result.autoEscalated).not.toBeNull();
    });

    it("does NOT fire request-contact twice when both tool and explicit-request are true", async () => {
      // Verifies only one request-contact event is emitted even when both
      // aiEscalatedViaTool AND isExplicitHumanRequest fire simultaneously.
      mockAgentsOnline.mockResolvedValue(false);
      mockAssessSentiment.mockReturnValue({ score: 0, reasons: [] });
      mockCallClaude.mockImplementation(
        async (_s: string, _m: unknown[], opts: { onToolCall?: (e: any) => Promise<void> }) => {
          if (opts?.onToolCall) {
            await opts.onToolCall({
              name: "escalate_to_human",
              input: { reason: "explicit_request" },
              output: { ok: true },
              durationMs: 50,
              isError: false,
            });
          }
          return "Connecting you.";
        }
      );
      mockDbSelect.mockResolvedValueOnce([]); // humanOwnsSession: not claimed
      mockDbSelect.mockResolvedValueOnce([]);
      mockDbSelect.mockResolvedValueOnce([]);

      const { runAiTurn } = await import("@/lib/ai/runAi");
      await runAiTurn({
        sessionId: SESSION_ID,
        latestMessage: "I want to talk to a human agent please",
      });

      const contactEvents = mockTrigger.mock.calls.filter(
        ([channel, event]) =>
          channel === `private-session-${SESSION_ID}` && event === "request-contact"
      );
      // hasAutoEscalated guard ensures exactly one event per session
      expect(contactEvents).toHaveLength(1);
    });
  });

  // ── 4. Idempotency — hasAutoEscalated guard ──────────────────────────────

  describe("idempotency via hasAutoEscalated", () => {
    it("does NOT insert auto_escalated event or fire request-contact on second turn", async () => {
      mockAgentsOnline.mockResolvedValue(false);
      mockAssessSentiment.mockReturnValue({ score: -1, reasons: [] });
      // First select → loadRecentCustomerMessages; second → hasAutoEscalated returns existing row
      mockDbSelect.mockResolvedValueOnce([]); // humanOwnsSession: not claimed
      mockDbSelect.mockResolvedValueOnce([{ content: "this is ridiculous" }, { content: "useless" }]);
      mockDbSelect.mockResolvedValueOnce([{ id: "evt-existing" }]); // already escalated

      const { runAiTurn } = await import("@/lib/ai/runAi");
      await runAiTurn({ sessionId: SESSION_ID, latestMessage: "still frustrated" });

      // No new auto_escalated insert
      const insertCalls = mockDbInsert.mock.calls
        .map((c) => JSON.stringify(c))
        .filter((c) => c.includes("auto_escalated"));
      expect(insertCalls).toHaveLength(0);

      // No request-contact
      const requestContact = mockTrigger.mock.calls.find(
        ([channel, event]) =>
          channel === `private-session-${SESSION_ID}` && event === "request-contact"
      );
      expect(requestContact).toBeUndefined();
    });

    it("returns autoEscalated: null when already escalated", async () => {
      mockAgentsOnline.mockResolvedValue(false);
      mockAssessSentiment.mockReturnValue({ score: -1, reasons: [] });
      mockDbSelect.mockResolvedValueOnce([]); // humanOwnsSession: not claimed
      mockDbSelect.mockResolvedValueOnce([{ content: "still angry" }]);
      mockDbSelect.mockResolvedValueOnce([{ id: "evt-existing" }]);

      const { runAiTurn } = await import("@/lib/ai/runAi");
      const result = await runAiTurn({ sessionId: SESSION_ID, latestMessage: "still angry" });

      expect(result.autoEscalated).toBeNull();
    });
  });

  // ── 5. Phase 2a mode split: no_data / undeliverable_offer / pause ────────

  describe("Phase 2a mode split", () => {
    beforeEach(() => {
      process.env.USE_AI_TOOLS = "true";
    });
    afterEach(() => {
      delete process.env.USE_AI_TOOLS;
    });

    /** Simulate a turn whose data tools returned nothing and whose reply hedges. */
    function mockNoDataTurn(reply: string) {
      mockCallClaude.mockImplementation(
        async (_s: string, _m: unknown[], opts: { onToolCall?: (e: any) => Promise<void> }) => {
          if (opts?.onToolCall) {
            await opts.onToolCall({
              name: "search_products",
              input: { query: "5w40 oil" },
              output: { count: 0, products: [] },
              durationMs: 80,
              isError: false,
            });
          }
          return reply;
        }
      );
      mockAssessConfidence.mockReturnValue({
        confidence: "low",
        reasons: ["phrase: I don't have"],
      });
      mockAssessSentiment.mockReturnValue({ score: 0, reasons: [] });
    }

    it("mode (a): low confidence + empty search + no prior offer => no_data, paused, handoff message", async () => {
      mockAgentsOnline.mockResolvedValue(true);
      mockNoDataTurn("I don't have that in our system — you could check the chemical page.");
      mockDbSelect.mockResolvedValueOnce([]); // humanOwnsSession
      mockDbSelect.mockResolvedValueOnce([{ content: "do you have 5w40 oil?" }]); // loadRecentCustomerMessages
      mockDbSelect.mockResolvedValueOnce([{ id: "msg-001", content: "irrelevant" }]); // loadPreviousAiMessage (only this turn's reply)
      mockDbSelect.mockResolvedValueOnce([]); // hasAutoEscalated: false

      const { runAiTurn } = await import("@/lib/ai/runAi");
      const result = await runAiTurn({
        sessionId: SESSION_ID,
        latestMessage: "do you have 5w40 oil?",
      });

      expect(result.autoEscalated).toMatchObject({ reason: "no_data", paused: true });
      expect(mockEscalateToHuman).toHaveBeenCalledWith(SESSION_ID, "no_data", "normal");
      expect(mockPauseAi).toHaveBeenCalledWith(SESSION_ID, "no_data");
      // Reply was a passive punt, so the active-handoff message is appended
      expect(mockPersistHandoff).toHaveBeenCalledWith(SESSION_ID, true);
    });

    it("mode (b): prior AI message offered the info => undeliverable_offer", async () => {
      mockAgentsOnline.mockResolvedValue(true);
      mockNoDataTurn("Hmm, I don't have the top speed on hand.");
      mockDbSelect.mockResolvedValueOnce([]); // humanOwnsSession
      mockDbSelect.mockResolvedValueOnce([{ content: "what's the top speed?" }]); // loadRecentCustomerMessages
      mockDbSelect.mockResolvedValueOnce([
        { id: "msg-001", content: "Hmm, I don't have the top speed on hand." },
        { id: "msg-prev", content: "Would you like to know the specs on the Stage 2 M2?" },
      ]); // loadPreviousAiMessage → prior offer
      mockDbSelect.mockResolvedValueOnce([]); // hasAutoEscalated: false

      const { runAiTurn } = await import("@/lib/ai/runAi");
      const result = await runAiTurn({
        sessionId: SESSION_ID,
        latestMessage: "what's the top speed?",
      });

      expect(result.autoEscalated).toMatchObject({
        reason: "undeliverable_offer",
        paused: true,
      });
      expect(mockPauseAi).toHaveBeenCalledWith(SESSION_ID, "undeliverable_offer");
    });

    it("bare low confidence WITH retrieved data stays notify-only (no pause)", async () => {
      mockAgentsOnline.mockResolvedValue(true);
      mockCallClaude.mockImplementation(
        async (_s: string, _m: unknown[], opts: { onToolCall?: (e: any) => Promise<void> }) => {
          if (opts?.onToolCall) {
            await opts.onToolCall({
              name: "search_products",
              input: { query: "helmets" },
              output: { count: 3, products: [{}, {}, {}] },
              durationMs: 90,
              isError: false,
            });
          }
          return "I'm not sure which of these fits best, but here are three options.";
        }
      );
      mockAssessConfidence.mockReturnValue({
        confidence: "low",
        reasons: ["phrase: I'm not sure"],
      });
      mockAssessSentiment.mockReturnValue({ score: 0, reasons: [] });
      mockDbSelect.mockResolvedValueOnce([]); // humanOwnsSession
      mockDbSelect.mockResolvedValueOnce([{ content: "which helmet?" }]); // loadRecentCustomerMessages
      mockDbSelect.mockResolvedValueOnce([]); // hasAutoEscalated: false (no priorAi select — got_data)

      const { runAiTurn } = await import("@/lib/ai/runAi");
      const result = await runAiTurn({
        sessionId: SESSION_ID,
        latestMessage: "which helmet?",
      });

      expect(result.autoEscalated).toMatchObject({ reason: "unsupported", paused: false });
      expect(mockPauseAi).not.toHaveBeenCalled();
      expect(mockPersistHandoff).not.toHaveBeenCalled();
    });

    it("explicit human request pauses AND skips the duplicate handoff when the reply already reads as one", async () => {
      mockAgentsOnline.mockResolvedValue(true);
      mockAssessConfidence.mockReturnValue({ confidence: "high", reasons: [] });
      mockAssessSentiment.mockReturnValue({ score: 0, reasons: [] });
      mockCallClaude.mockResolvedValue("Connecting you to a teammate now — they'll have full context.");
      mockDbSelect.mockResolvedValueOnce([]); // humanOwnsSession
      mockDbSelect.mockResolvedValueOnce([]); // loadRecentCustomerMessages
      mockDbSelect.mockResolvedValueOnce([]); // hasAutoEscalated: false

      const { runAiTurn } = await import("@/lib/ai/runAi");
      const result = await runAiTurn({
        sessionId: SESSION_ID,
        latestMessage: "let me talk to a human please",
      });

      expect(result.autoEscalated).toMatchObject({ reason: "explicit_request", paused: true });
      expect(mockPauseAi).toHaveBeenCalledWith(SESSION_ID, "explicit_request");
      expect(mockPersistHandoff).not.toHaveBeenCalled();
    });

    it("re-pauses on a repeat wall even though notify already fired (once-per-session)", async () => {
      mockAgentsOnline.mockResolvedValue(true);
      mockNoDataTurn("I still don't have that information available, sorry.");
      mockDbSelect.mockResolvedValueOnce([]); // humanOwnsSession
      mockDbSelect.mockResolvedValueOnce([{ content: "any update?" }]); // loadRecentCustomerMessages
      mockDbSelect.mockResolvedValueOnce([{ id: "msg-001", content: "x" }]); // loadPreviousAiMessage
      mockDbSelect.mockResolvedValueOnce([{ id: "evt-existing" }]); // hasAutoEscalated: TRUE

      const { runAiTurn } = await import("@/lib/ai/runAi");
      const result = await runAiTurn({
        sessionId: SESSION_ID,
        latestMessage: "any update?",
      });

      // Notify is deduped…
      expect(result.autoEscalated).toBeNull();
      expect(mockEscalateToHuman).not.toHaveBeenCalled();
      // …but the pause still re-arms so suppression holds.
      expect(mockPauseAi).toHaveBeenCalledWith(SESSION_ID, "no_data");
    });
  });

  // ── 6. Happy-path (no escalation) sanity check ──────────────────────────

  it("does not fire request-contact for a normal message with no escalation trigger", async () => {
    mockAgentsOnline.mockResolvedValue(false);
    mockAssessSentiment.mockReturnValue({ score: 0, reasons: [] });
    mockAssessConfidence.mockReturnValue({ confidence: "high", reasons: [] });
    mockDbSelect.mockResolvedValueOnce([]); // humanOwnsSession: not claimed
    mockDbSelect.mockResolvedValueOnce([{ content: "do you sell helmets?" }]);
    mockDbSelect.mockResolvedValueOnce([]); // hasAutoEscalated not reached

    const { runAiTurn } = await import("@/lib/ai/runAi");
    const result = await runAiTurn({
      sessionId: SESSION_ID,
      latestMessage: "do you sell helmets?",
    });

    expect(result.autoEscalated).toBeNull();
    const requestContact = mockTrigger.mock.calls.find(
      ([channel, event]) =>
        channel === `private-session-${SESSION_ID}` && event === "request-contact"
    );
    expect(requestContact).toBeUndefined();
  });
});
