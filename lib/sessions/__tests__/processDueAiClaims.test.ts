/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Sweep-path regression tests for the fitment sweep bug (7/12/2026).
 *
 * Live production bug: processDueAiClaims called runAiTurn with
 * latestMessage: "" — the sweep is the entry point that serves fresh
 * sessions whenever an agent dashboard is online (session waits out the
 * fallback timer instead of taking the inline /api/chat path). With an
 * empty opener, classifyRouting silently no-ops, so the Phase 2b routing
 * directive AND the pre-rendered product context never reached the prompt:
 * full-YMM fitment openers got the generic handoff copy with no products,
 * while the inline path (which passes the real message) worked.
 *
 * The existing complex_fitment preserve tests (escalation.test.ts §5b) call
 * runAiTurn directly with a populated latestMessage — the inline path's
 * invocation shape. These tests route through processDueAiClaims itself so
 * the sweep's own runAiTurn wiring is what's under test.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock all external I/O before the SUT is imported
// ---------------------------------------------------------------------------

const mockDbSelect = vi.fn();
const mockDbInsert = vi.fn();
const mockDbUpdate = vi.fn();
/** Rows passed to `.values(...)` on the insert chain, in call order — lets
 *  tests assert the CONTENT runAiTurn persisted, which the terminal-only
 *  chain in escalation.test.ts drops. */
const insertedRows: any[] = [];

/**
 * Chainable + thenable Drizzle proxy (same shape as escalation.test.ts),
 * extended to record `.values(...)` payloads into insertedRows.
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
        return (...args: any[]) => {
          if (prop === "values") {
            insertedRows.push(args[0]);
            return p;
          }
          if (["limit", "returning", "offset"].includes(prop as string))
            return terminal(...args);
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
  messages: {
    sessionId: "session_id",
    role: "role",
    sentAt: "sent_at",
    content: "content",
  },
  chatEvents: { sessionId: "session_id", type: "type" },
  sessions: {
    id: "id",
    aiClaimDueAt: "ai_claim_due_at",
    status: "status",
    claimedByUserId: "claimed_by_user_id",
    claimedByKind: "claimed_by_kind",
  },
  users: { id: "id" },
  knowledgeBase: { topic: "topic" },
}));

const mockTrigger = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/pusher/server", () => ({
  getPusher: () => ({ trigger: mockTrigger }),
}));

const mockBuildPrompt = vi.fn();
vi.mock("@/lib/ai/buildPrompt", () => ({
  buildPrompt: mockBuildPrompt,
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

const mockPauseAi = vi.fn().mockResolvedValue(undefined);
const mockPersistHandoff = vi.fn().mockResolvedValue(null);
vi.mock("@/lib/sessions/aiPause", () => ({
  pauseAi: mockPauseAi,
  persistHandoffMessage: mockPersistHandoff,
  HANDOFF_HUMAN_COMING:
    "Let me get someone from our team on this — hang tight one moment, they'll pick up right here in this chat.",
  HANDOFF_AFTER_HOURS:
    "I've flagged this for the team, but nobody's available at the moment — if you share your email, they'll reach out directly rather than leaving you hanging.",
}));

// Phase 2b routing layer: mocked so the test controls classification without
// an Anthropic call. classifyRouting mirrors the real empty-input contract
// (null on blank input) so a regression back to latestMessage: "" fails the
// includeProductContext assertions, not just the called-with assertion.
const mockClassifyRouting = vi.fn();
vi.mock("@/lib/ai/classify", () => ({
  routingClassifierEnabled: () => true,
  shouldClassifyTurn: (hasPriorAiMessage: boolean) => !hasPriorAiMessage,
  classifyRouting: mockClassifyRouting,
  routingDirective: () => "MOCK ROUTING DIRECTIVE",
}));

vi.mock("@/lib/ai/tagger", () => ({
  enqueueTag: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/log", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  serializeError: (err: unknown) =>
    err instanceof Error
      ? { name: err.name, message: err.message }
      : { message: String(err) },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SESSION_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const DUE_SESSION = {
  id: SESSION_ID,
  status: "waiting",
  claimedByUserId: null,
  claimedByKind: null,
  aiClaimDueAt: new Date(Date.now() - 30_000),
  pageContext: null,
};
const SAVED_MESSAGE = {
  id: "msg-sweep-001",
  sessionId: SESSION_ID,
  role: "ai",
  content: "placeholder",
  sentAt: new Date().toISOString(),
};

const FITMENT_QUESTION =
  "does the Michelin Road 6 fit a 2021 Kawasaki Ninja 650?";
const FITMENT_REPLY =
  "Great news — we carry the Michelin Road 6 Sport Touring Tires at $214.99, " +
  "in stock. For a 2021 Kawasaki Ninja 650 you'd typically run 120/70-17 front " +
  "and 160/60-17 rear. Our service team monitors this chat and will jump in to " +
  "confirm what'll fit your specific bike.";

/** Live-bug turn shape: products reach the reply via the prompt's
 *  pre-rendered RELEVANT PRODUCTS section, so the ONLY tool call is
 *  escalate_to_human(reason='complex_fitment'). */
function mockFitmentTurn(reply: string) {
  mockCallClaude.mockImplementation(
    async (
      _s: string,
      _m: unknown[],
      o: { onToolCall?: (e: any) => Promise<void> }
    ) => {
      if (o?.onToolCall) {
        await o.onToolCall({
          name: "escalate_to_human",
          input: { reason: "complex_fitment" },
          output: { ok: true, reason: "complex_fitment", urgency: "normal" },
          durationMs: 40,
          isError: false,
        });
      }
      return reply;
    }
  );
}

function resetMocks() {
  vi.clearAllMocks();
  insertedRows.length = 0;
  mockBuildPrompt.mockResolvedValue({
    system: "system prompt",
    conversationMessages: [{ role: "user", content: FITMENT_QUESTION }],
  });
  mockAssessConfidence.mockReturnValue({ confidence: "high", reasons: [] });
  mockAssessSentiment.mockReturnValue({ score: 0, reasons: [] });
  mockAgentsOnline.mockResolvedValue(true); // agents online = the bug's trigger condition
  mockDbSelect.mockResolvedValue([]);
  mockDbInsert.mockResolvedValue([SAVED_MESSAGE]);
  // claimByAi's update(...).returning() must yield the won session
  mockDbUpdate.mockResolvedValue([{ ...DUE_SESSION, claimedByKind: "ai" }]);
  // Real empty-input contract: blank opener → null (no classification)
  mockClassifyRouting.mockImplementation(async (msg: string) =>
    (msg || "").trim()
      ? { category: "tire_fitment", confidence: "high", missingFields: [] }
      : null
  );
}

/** Queue the ordered db.select results for one sweep pass over DUE_SESSION.
 *  Order: dueSessions → latest customer message (the fix) →
 *  loadRecentCustomerMessages → hasPriorAiMessage → humanOwnsSession →
 *  hasAutoEscalated. */
function queueSweepSelects() {
  mockDbSelect.mockResolvedValueOnce([DUE_SESSION]); // due sessions
  mockDbSelect.mockResolvedValueOnce([{ content: FITMENT_QUESTION }]); // latest customer message (sweep fix)
  mockDbSelect.mockResolvedValueOnce([{ content: FITMENT_QUESTION }]); // loadRecentCustomerMessages
  mockDbSelect.mockResolvedValueOnce([]); // hasPriorAiMessage: none (fresh session)
  mockDbSelect.mockResolvedValueOnce([]); // humanOwnsSession: still AI's
  mockDbSelect.mockResolvedValueOnce([]); // hasAutoEscalated: false
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("processDueAiClaims — fitment sweep regression (7/12/2026)", () => {
  beforeEach(() => {
    resetMocks();
    process.env.USE_AI_TOOLS = "true";
  });
  afterEach(() => {
    delete process.env.USE_AI_TOOLS;
  });

  it("passes the REAL latest customer message to the routing classifier (never '')", async () => {
    queueSweepSelects();
    mockFitmentTurn(FITMENT_REPLY);

    const { processDueAiClaims } = await import("@/lib/sessions/state");
    await processDueAiClaims();

    expect(mockClassifyRouting).toHaveBeenCalledTimes(1);
    expect(mockClassifyRouting.mock.calls[0][0]).toBe(FITMENT_QUESTION);
  });

  it("full-YMM fitment opener served by the sweep gets includeProductContext=true and a directive", async () => {
    queueSweepSelects();
    mockFitmentTurn(FITMENT_REPLY);

    const { processDueAiClaims } = await import("@/lib/sessions/state");
    await processDueAiClaims();

    expect(mockBuildPrompt).toHaveBeenCalledTimes(1);
    // buildPrompt(sessionId, latestMessage, pageContext, latestMessageRaw,
    //             agentsOnline, directive, opts)
    const [sessionId, latestMessage, , , , directive, opts] =
      mockBuildPrompt.mock.calls[0];
    expect(sessionId).toBe(SESSION_ID);
    expect(latestMessage).toBe(FITMENT_QUESTION);
    expect(directive).toBe("MOCK ROUTING DIRECTIVE");
    expect(opts).toEqual({ includeProductContext: true });
  });

  it("persists the preserved product reply with the handoff line APPENDED (not replaced)", async () => {
    queueSweepSelects();
    mockFitmentTurn(FITMENT_REPLY);

    const { HANDOFF_HUMAN_COMING } = await import("@/lib/sessions/aiPause");
    const { processDueAiClaims } = await import("@/lib/sessions/state");
    await processDueAiClaims();

    const aiRow = insertedRows.find((r) => r?.role === "ai");
    expect(aiRow).toBeDefined();
    // The customer keeps the product recommendation (name + price)…
    expect(aiRow.content).toContain("Michelin Road 6 Sport Touring Tires");
    expect(aiRow.content).toContain("$214.99");
    // …with the handoff line appended after it, byte-exact.
    expect(aiRow.content).toBe(`${FITMENT_REPLY}\n\n${HANDOFF_HUMAN_COMING}`);
    // The session still pauses — a human owes the fitment confirmation.
    expect(mockPauseAi).toHaveBeenCalled();
  });

  it("counterfactual: an empty opener (no customer rows) still degrades gracefully — classifier null, no product context", async () => {
    // A session with no customer messages at all (edge: due claim on an
    // empty session). The sweep must not crash, and the unrouted path runs.
    mockDbSelect.mockResolvedValueOnce([DUE_SESSION]); // due sessions
    mockDbSelect.mockResolvedValueOnce([]); // latest customer message: none
    mockDbSelect.mockResolvedValueOnce([]); // loadRecentCustomerMessages
    mockDbSelect.mockResolvedValueOnce([]); // hasPriorAiMessage
    mockDbSelect.mockResolvedValueOnce([]); // humanOwnsSession
    mockDbSelect.mockResolvedValueOnce([]); // hasAutoEscalated
    mockCallClaude.mockResolvedValue("Hi! How can I help you today?");

    const { processDueAiClaims } = await import("@/lib/sessions/state");
    await processDueAiClaims();

    // classifyRouting sees "" and returns null (real contract, mirrored by
    // the mock) → no directive, no product context.
    expect(mockClassifyRouting).toHaveBeenCalledWith("", expect.anything());
    const [, , , , , directive, opts] = mockBuildPrompt.mock.calls[0];
    expect(directive).toBeNull();
    expect(opts).toEqual({ includeProductContext: false });
  });
});
