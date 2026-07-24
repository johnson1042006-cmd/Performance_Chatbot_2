/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockDbSelect = vi.fn();
const mockDbInsert = vi.fn();
const mockDbUpdate = vi.fn();

const chain = (terminal: (...a: any[]) => any) => {
  const p: any = new Proxy(
    {},
    {
      get(_t, prop) {
        if (typeof prop === "symbol") return undefined;
        if (prop === "then") {
          return (
            resolve: (v: unknown) => void,
            reject: (e: unknown) => void
          ) => {
            try {
              Promise.resolve(terminal()).then(resolve, reject);
            } catch (err) {
              reject(err);
            }
          };
        }
        return (...args: any[]) => {
          if (["limit", "returning", "offset"].includes(prop)) return terminal(...args);
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
  sessions: { id: "id", status: "status" },
  messages: { sessionId: "session_id", role: "role", sentAt: "sent_at" },
  knowledgeBase: { topic: "topic" },
  users: { id: "id", isActive: "is_active", lastHeartbeatAt: "last_heartbeat_at" },
  chatEvents: { sessionId: "session_id", type: "type" },
  productPairings: { primarySku: "primary_sku", pairedSku: "paired_sku" },
}));

vi.mock("@/lib/pusher/server", () => ({
  getPusher: () => ({ trigger: vi.fn().mockResolvedValue(undefined) }),
}));

vi.mock("@/lib/bigcommerce/client", () => ({
  getProductBySKU: vi.fn().mockResolvedValue(null),
  getProductByName: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/lib/search/productSearch", () => ({
  extractSKUFromText: vi.fn().mockReturnValue(null),
}));

vi.mock("@/lib/ai/buildPrompt", () => ({
  buildPrompt: vi.fn().mockResolvedValue({
    system: "mock system",
    conversationMessages: [{ role: "user", content: "test" }],
  }),
}));

vi.mock("@/lib/ai/callClaude", () => ({
  callClaude: vi.fn(async (_system: string, _msgs: any[], opts?: any) => {
    if (opts?.stream) {
      // Simulate streaming a few tokens.
      opts.stream.onToken("Hello ");
      opts.stream.onToken("world");
      return "Hello world";
    }
    return "Hello world";
  }),
  CALL_CLAUDE_ERROR_MESSAGE: "trouble",
}));

vi.mock("@/lib/auth", () => ({ getStaffSession: vi.fn(), bustUserFlagCache: vi.fn() }));

// Token enforcement is covered in security.test.ts; allow everything here so
// positional mockDbSelect queues stay aligned with the route's own selects.
vi.mock("@/lib/sessions/verifySessionToken", () => ({
  verifySessionAccess: vi.fn().mockResolvedValue(true),
}));

vi.mock("@/lib/presence", () => ({
  anyAgentsOnline: vi.fn().mockResolvedValue(false),
  recordAgentHeartbeat: vi.fn(),
  markAgentOffline: vi.fn(),
  getOnlineAgents: vi.fn().mockResolvedValue([]),
  getAllAgentsWithPresence: vi.fn().mockResolvedValue([]),
  ONLINE_THRESHOLD_SECONDS: 60,
}));

vi.mock("@/lib/rateLimit", () => ({
  enforce: vi.fn().mockResolvedValue({ ok: true }),
  getClientIp: vi.fn().mockReturnValue("127.0.0.1"),
}));

vi.mock("@/lib/log", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  serializeError: (err: unknown) =>
    err instanceof Error
      ? { name: err.name, message: err.message }
      : { message: String(err) },
}));

// recordCustomerActivity / claimByAi from sessions/state — keep thin mocks
// so we don't recurse into the real DB chain logic.
vi.mock("@/lib/sessions/state", async () => {
  return {
    recordCustomerActivity: vi.fn().mockResolvedValue(undefined),
    claimByAi: vi.fn().mockResolvedValue({ id: "sess-1", status: "active_ai" }),
    processDueAiClaims: vi.fn().mockResolvedValue(undefined),
    sweepStaleSessions: vi.fn().mockResolvedValue(0),
  };
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

function resetDbMocks() {
  mockDbSelect.mockReset().mockResolvedValue([]);
  mockDbInsert.mockReset().mockResolvedValue([]);
  mockDbUpdate.mockReset().mockResolvedValue([]);
}

async function readStreamToString(body: ReadableStream<Uint8Array> | null): Promise<string> {
  if (!body) return "";
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let out = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  out += decoder.decode();
  return out;
}

describe("POST /api/chat — SSE branch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDbMocks();
  });

  it("returns text/event-stream with token + done events when Accept includes text/event-stream", async () => {
    // Session is unclaimed; no agents online → AI claims and runs inline.
    mockDbSelect.mockResolvedValueOnce([{ id: "sess-1", status: "waiting" }]);
    // Customer message insert
    mockDbInsert.mockResolvedValueOnce([
      { id: "msg-1", sessionId: "sess-1", role: "customer", content: "hi", sentAt: new Date() },
    ]);
    // bot_settings select (knowledgeBase)
    mockDbSelect.mockResolvedValueOnce([]);
    // recent customer messages select inside runAiTurn
    mockDbSelect.mockResolvedValueOnce([{ content: "hi" }]);
    // AI message insert
    mockDbInsert.mockResolvedValueOnce([
      { id: "ai-1", sessionId: "sess-1", role: "ai", content: "Hello world", sentAt: new Date() },
    ]);

    const { NextRequest } = await import("next/server");
    const { POST } = await import("@/app/api/chat/route");

    const req = new NextRequest("http://localhost/api/chat", {
      method: "POST",
      headers: { Accept: "text/event-stream", "Content-Type": "application/json" },
      body: JSON.stringify({ message: "hi", sessionId: "sess-1" }),
    });

    const res = await POST(req);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const body = await readStreamToString((res as Response).body);
    expect(body).toContain("event: token");
    expect(body).toContain('"text":"Hello "');
    expect(body).toContain("event: done");
  });

  it("returns JSON when Accept does not include text/event-stream", async () => {
    mockDbSelect.mockResolvedValueOnce([{ id: "sess-1", status: "waiting" }]);
    mockDbInsert.mockResolvedValueOnce([
      { id: "msg-1", sessionId: "sess-1", role: "customer", content: "hi", sentAt: new Date() },
    ]);
    mockDbSelect.mockResolvedValueOnce([]);
    mockDbSelect.mockResolvedValueOnce([{ content: "hi" }]);
    mockDbInsert.mockResolvedValueOnce([
      { id: "ai-1", sessionId: "sess-1", role: "ai", content: "Hello world", sentAt: new Date() },
    ]);

    const { NextRequest } = await import("next/server");
    const { POST } = await import("@/app/api/chat/route");

    const req = new NextRequest("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "hi", sessionId: "sess-1" }),
    });

    const res = await POST(req);
    expect(res.headers.get("content-type") || "").toContain("application/json");
    const data = await res.json();
    expect(data.message?.content).toBe("hi");
  });
});
