import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the callClaude module so the test never reaches the SDK. We
// reassign `mockResponse` per test to control Claude's reply.
let mockResponse = "";
vi.mock("@/lib/ai/callClaude", () => ({
  callClaude: vi.fn(async () => mockResponse),
}));

// Mock the database. tagSession only needs:
//   - select(...).from(messages).where(...).orderBy(...).limit(...)  → returns transcript rows
//   - update(sessions).set(...).where(...) → resolves
const transcriptRows: Array<{ role: string; content: string; sentAt: Date }> = [
  { role: "customer", content: "Where is my order #12345?", sentAt: new Date() },
  { role: "ai", content: "Let me check.", sentAt: new Date() },
];

const persistedRows: Array<Record<string, unknown>> = [];

vi.mock("@/lib/db", () => {
  function selectChain() {
    return {
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: () => Promise.resolve(transcriptRows),
          }),
        }),
      }),
    };
  }
  function updateChain() {
    let payload: Record<string, unknown> = {};
    return {
      set: (p: Record<string, unknown>) => {
        payload = p;
        return {
          where: () => {
            persistedRows.push(payload);
            return Promise.resolve();
          },
        };
      },
    };
  }
  return {
    db: {
      select: () => selectChain(),
      update: () => updateChain(),
    },
  };
});

// Mock the log helper to keep the JSON line out of the test output and
// to assert on warn() calls.
const warnSpy = vi.fn();
vi.mock("@/lib/log", () => ({
  log: {
    info: vi.fn(),
    warn: warnSpy,
    error: vi.fn(),
  },
  serializeError: (e: unknown) => ({ message: String(e) }),
}));

beforeEach(() => {
  persistedRows.length = 0;
  warnSpy.mockReset();
  delete process.env.TAGGER_TEST_MODE;
});

describe("tagger.tagSession", () => {
  it("parses well-formed JSON output from Claude", async () => {
    mockResponse = JSON.stringify({
      intent: "order_status",
      topics: ["order-123", "shipping"],
      resolved: true,
    });
    const { tagSession } = await import("@/lib/ai/tagger");
    const result = await tagSession("00000000-0000-0000-0000-000000000001");
    expect(result.intent).toBe("order_status");
    expect(result.topics).toContain("order-123");
    expect(result.resolved).toBe(true);
    expect(persistedRows.at(-1)).toMatchObject({
      intent: "order_status",
      resolved: true,
    });
  });

  it("strips ```json fences and parses", async () => {
    mockResponse = "```json\n" + JSON.stringify({
      intent: "shipping_question",
      topics: ["delivery"],
      resolved: false,
    }) + "\n```";
    const { tagSession } = await import("@/lib/ai/tagger");
    const result = await tagSession("00000000-0000-0000-0000-000000000002");
    expect(result.intent).toBe("shipping_question");
    expect(result.resolved).toBe(false);
  });

  it("fails open on garbage output and logs a warning", async () => {
    mockResponse = "I cannot do that, Dave.";
    const { tagSession } = await import("@/lib/ai/tagger");
    const result = await tagSession("00000000-0000-0000-0000-000000000003");
    expect(result).toEqual({ intent: "other", topics: [], resolved: false });
    expect(warnSpy).toHaveBeenCalled();
    expect(persistedRows.at(-1)).toMatchObject({
      intent: "other",
      resolved: false,
    });
  });

  it("fails open when intent is not in the enum", async () => {
    mockResponse = JSON.stringify({
      intent: "totally_made_up",
      topics: [],
      resolved: false,
    });
    const { tagSession } = await import("@/lib/ai/tagger");
    const result = await tagSession("00000000-0000-0000-0000-000000000004");
    expect(result.intent).toBe("other");
    expect(persistedRows.at(-1)).toMatchObject({ intent: "other" });
  });

  it("caps topics at 10 and slugifies them", async () => {
    mockResponse = JSON.stringify({
      intent: "other",
      topics: Array.from({ length: 15 }, (_, i) => `Topic With Spaces ${i}!`),
      resolved: false,
    });
    const { tagSession } = await import("@/lib/ai/tagger");
    const result = await tagSession("00000000-0000-0000-0000-000000000005");
    expect(result.topics.length).toBeLessThanOrEqual(10);
    expect(result.topics[0]).toMatch(/^topic-with-spaces-/);
  });

  it("honors TAGGER_TEST_MODE for hermetic e2e runs", async () => {
    process.env.TAGGER_TEST_MODE = "1";
    const { tagSession } = await import("@/lib/ai/tagger");
    const result = await tagSession("00000000-0000-0000-0000-000000000006");
    // Test mode is transcript-aware; "Where is my order" → order_status
    expect(result.intent).toBe("order_status");
    expect(persistedRows.at(-1)?.intent).toBe("order_status");
  });
});
