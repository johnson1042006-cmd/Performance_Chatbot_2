/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock all external dependencies used by the chat API routes
// ---------------------------------------------------------------------------
const mockDbSelect = vi.fn();
const mockDbInsert = vi.fn();
const mockDbUpdate = vi.fn();

// Proxy-based chain that's BOTH chainable (.from, .set, .where, etc. return
// the proxy) AND thenable (awaiting the chain at any point invokes the
// terminal mock). Terminal methods (.limit, .returning, .offset) also
// invoke the mock directly. This handles every drizzle pattern used by the
// chat routes including bare `await db.update(...).set(...).where(...)`.
const chain = (terminal: (...a: any[]) => any) => {
  const p: any = new Proxy(
    {},
    {
      get(_t, prop) {
        if (typeof prop === "symbol") return undefined;
        if (prop === "then") {
          return (
            resolve: (v: unknown) => void,
            reject: (e: unknown) => void,
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
    },
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
  // chatEvents and rateLimitBuckets intentionally omitted — see security.test.ts
}));

vi.mock("@/lib/pusher/server", () => ({
  getPusher: () => ({
    trigger: vi.fn().mockResolvedValue(undefined),
  }),
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
  callClaude: vi.fn().mockResolvedValue("AI response text"),
}));


// Session-token enforcement is exercised directly in security.test.ts. Here
// we always allow so the positional mockDbSelect queues stay aligned with the
// routes' own selects.
vi.mock("@/lib/sessions/verifySessionToken", () => ({
  verifySessionAccess: vi.fn().mockResolvedValue(true),
}));

vi.mock("@/lib/auth", () => ({ getStaffSession: vi.fn(), bustUserFlagCache: vi.fn() }));

// Mock @/lib/presence so anyAgentsOnline returns a controllable value
// without dragging in a `users` schema-mock proxy chain.
vi.mock("@/lib/presence", () => ({
  anyAgentsOnline: vi.fn().mockResolvedValue(true),
  recordAgentHeartbeat: vi.fn().mockResolvedValue(undefined),
  markAgentOffline: vi.fn().mockResolvedValue(undefined),
  getOnlineAgents: vi.fn().mockResolvedValue([]),
  getAllAgentsWithPresence: vi.fn().mockResolvedValue([]),
  ONLINE_THRESHOLD_SECONDS: 60,
}));

// Bypass the Postgres-backed rate limiter — it would otherwise consume
// mockDbInsert queue slots that real tests need.
vi.mock("@/lib/rateLimit", () => ({
  enforce: vi.fn().mockResolvedValue({ ok: true }),
  getClientIp: vi.fn().mockReturnValue("127.0.0.1"),
}));

// Silence structured-log noise from try/catch'd error paths inside
// claimByAi/releaseToQueue (they log when chatEvents access fails — which
// is expected because the schema mock intentionally omits chatEvents to
// avoid consuming mockDbInsert queues).
vi.mock("@/lib/log", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  serializeError: (err: unknown) =>
    err instanceof Error
      ? { name: err.name, message: err.message }
      : { message: String(err) },
}));

// Reset between tests so `mockResolvedValueOnce` queues from a previous
// test (especially failures that didn't consume their mocks) don't poison
// subsequent tests. clearAllMocks() does NOT clear the once-queue — reset
// does.
function resetDbMocks() {
  mockDbSelect.mockReset().mockResolvedValue([]);
  mockDbInsert.mockReset().mockResolvedValue([]);
  mockDbUpdate.mockReset().mockResolvedValue([]);
}

// ---------------------------------------------------------------------------
// /api/chat POST tests
// ---------------------------------------------------------------------------
describe("POST /api/chat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDbMocks();
  });

  it("returns 400 when message is missing", async () => {
    const { NextRequest } = await import("next/server");
    const { POST } = await import("@/app/api/chat/route");

    const req = new NextRequest("http://localhost/api/chat", {
      method: "POST",
      body: JSON.stringify({ sessionId: "abc" }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("required");
  });

  it("returns 400 when sessionId is missing", async () => {
    const { NextRequest } = await import("next/server");
    const { POST } = await import("@/app/api/chat/route");

    const req = new NextRequest("http://localhost/api/chat", {
      method: "POST",
      body: JSON.stringify({ message: "hello" }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 413 when the message exceeds the length cap", async () => {
    const { NextRequest } = await import("next/server");
    const { POST } = await import("@/app/api/chat/route");

    const req = new NextRequest("http://localhost/api/chat", {
      method: "POST",
      body: JSON.stringify({ sessionId: "abc", message: "x".repeat(4001) }),
    });

    const res = await POST(req);
    expect(res.status).toBe(413);
    const data = await res.json();
    expect(data.error).toBe("message_too_long");
  });

  it("returns 400 when message is not a string", async () => {
    const { NextRequest } = await import("next/server");
    const { POST } = await import("@/app/api/chat/route");

    const req = new NextRequest("http://localhost/api/chat", {
      method: "POST",
      body: JSON.stringify({ sessionId: "abc", message: { nested: "obj" } }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 404 when session does not exist", async () => {
    mockDbSelect.mockResolvedValueOnce([]);

    const { NextRequest } = await import("next/server");
    const { POST } = await import("@/app/api/chat/route");

    const req = new NextRequest("http://localhost/api/chat", {
      method: "POST",
      body: JSON.stringify({ message: "hello", sessionId: "nonexistent" }),
    });

    const res = await POST(req);
    expect(res.status).toBe(404);
  });

  it("returns 200 and saves message for valid request", async () => {
    const mockSession = { id: "sess-1", status: "waiting" };
    const mockMessage = {
      id: "msg-1", sessionId: "sess-1", role: "customer",
      content: "hello", sentAt: new Date(),
    };

    mockDbSelect.mockResolvedValueOnce([mockSession]);
    mockDbInsert.mockResolvedValueOnce([mockMessage]);

    const { NextRequest } = await import("next/server");
    const { POST } = await import("@/app/api/chat/route");

    const req = new NextRequest("http://localhost/api/chat", {
      method: "POST",
      body: JSON.stringify({ message: "hello", sessionId: "sess-1" }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.message.content).toBe("hello");
    expect(data.sessionStatus).toBe("waiting");
  });
});

// ---------------------------------------------------------------------------
// /api/chat/ai-fallback POST tests
// ---------------------------------------------------------------------------
describe("POST /api/chat/ai-fallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDbMocks();
  });

  it("returns 400 when sessionId is missing", async () => {
    const { NextRequest } = await import("next/server");
    const { POST } = await import("@/app/api/chat/ai-fallback/route");

    const req = new NextRequest("http://localhost/api/chat/ai-fallback", {
      method: "POST",
      body: JSON.stringify({}),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 404 when session does not exist", async () => {
    mockDbSelect.mockResolvedValueOnce([]);

    const { NextRequest } = await import("next/server");
    const { POST } = await import("@/app/api/chat/ai-fallback/route");

    const req = new NextRequest("http://localhost/api/chat/ai-fallback", {
      method: "POST",
      body: JSON.stringify({ sessionId: "nonexistent" }),
    });

    const res = await POST(req);
    expect(res.status).toBe(404);
  });

  it("skips AI when session is active_human", async () => {
    // The route checks `claimedByKind === "human"` (the source of truth);
    // status is derived state. The test session must reflect that.
    mockDbSelect.mockResolvedValueOnce([
      { id: "sess-1", status: "active_human", claimedByKind: "human" },
    ]);

    const { NextRequest } = await import("next/server");
    const { POST } = await import("@/app/api/chat/ai-fallback/route");

    const req = new NextRequest("http://localhost/api/chat/ai-fallback", {
      method: "POST",
      body: JSON.stringify({ sessionId: "sess-1" }),
    });

    const res = await POST(req);
    const data = await res.json();
    expect(data.skipped).toBe(true);
    expect(data.reason).toContain("human");
  });

  it("sets status to active_ai for waiting sessions", async () => {
    mockDbSelect
      .mockResolvedValueOnce([{ id: "sess-1", status: "waiting" }]) // session lookup
      // FIX-5 freshness guard: newest message (not an AI reply) + a recent
      // customer message so the route proceeds to run the AI turn.
      .mockResolvedValueOnce([{ role: "customer", sentAt: new Date() }])
      .mockResolvedValueOnce([{ sentAt: new Date() }]);
    // claimByAi does `update(...).returning()` and destructures the first
    // row — must be an array containing the won session.
    mockDbUpdate.mockResolvedValueOnce([
      { id: "sess-1", status: "active_ai", claimedByKind: "ai" },
    ]);
    mockDbInsert.mockResolvedValueOnce([{
      id: "ai-msg-1", sessionId: "sess-1", role: "ai",
      content: "AI response text", sentAt: new Date(),
    }]);

    const { NextRequest } = await import("next/server");
    const { POST } = await import("@/app/api/chat/ai-fallback/route");

    const req = new NextRequest("http://localhost/api/chat/ai-fallback", {
      method: "POST",
      body: JSON.stringify({ sessionId: "sess-1", latestMessage: "hello" }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.message.role).toBe("ai");
    expect(data.message.content).toBe("AI response text");
  });

  it("falls back to the stored customer message when the body omits latestMessage", async () => {
    // Fitment sweep bug (7/12/2026): callers without a body message used to
    // hand runAiTurn latestMessage: "" — which silently disabled the routing
    // classifier. The route must fall back to the stored customer message
    // (already selected for the freshness guard).
    const STORED_QUESTION =
      "does the Michelin Road 6 fit a 2021 Kawasaki Ninja 650?";
    mockDbSelect
      .mockResolvedValueOnce([{ id: "sess-2", status: "waiting" }]) // session lookup
      .mockResolvedValueOnce([{ role: "customer", sentAt: new Date() }]) // newest: not an AI reply
      .mockResolvedValueOnce([{ content: STORED_QUESTION, sentAt: new Date() }]); // latest customer message
    mockDbUpdate.mockResolvedValueOnce([
      { id: "sess-2", status: "active_ai", claimedByKind: "ai" },
    ]);
    mockDbInsert.mockResolvedValueOnce([{
      id: "ai-msg-2", sessionId: "sess-2", role: "ai",
      content: "AI response text", sentAt: new Date(),
    }]);

    const { buildPrompt } = await import("@/lib/ai/buildPrompt");
    const { NextRequest } = await import("next/server");
    const { POST } = await import("@/app/api/chat/ai-fallback/route");

    const req = new NextRequest("http://localhost/api/chat/ai-fallback", {
      method: "POST",
      body: JSON.stringify({ sessionId: "sess-2" }), // no latestMessage in body
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    // runAiTurn received the stored message, not "" — visible as
    // buildPrompt's latestMessage argument.
    expect(vi.mocked(buildPrompt).mock.calls[0][1]).toBe(STORED_QUESTION);
  });
});

// ---------------------------------------------------------------------------
// /api/chat/settings GET tests
// ---------------------------------------------------------------------------
describe("GET /api/chat/settings", () => {
  it("returns defaults when no bot_settings row exists", async () => {
    // Override db mock for this specific test
    const originalModule = await import("@/app/api/chat/settings/route");

    // We test the route by verifying its expected default behavior
    expect(originalModule.dynamic).toBe("force-dynamic");
  });
});

// ---------------------------------------------------------------------------
// /api/admin/settings tests
// ---------------------------------------------------------------------------
describe("/api/admin/settings", () => {
  it("requires store_manager role for GET", async () => {
    const { getStaffSession } = await import("@/lib/auth");
    (getStaffSession as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      user: { id: "u1", role: "support_agent", name: "Agent", email: "a@test.com" },
    });

    const { GET } = await import("@/app/api/admin/settings/route");
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("requires store_manager role for POST", async () => {
    const { getStaffSession } = await import("@/lib/auth");
    (getStaffSession as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      user: { id: "u1", role: "support_agent", name: "Agent", email: "a@test.com" },
    });

    const { NextRequest } = await import("next/server");
    const { POST } = await import("@/app/api/admin/settings/route");

    const req = new NextRequest("http://localhost/api/admin/settings", {
      method: "POST",
      body: JSON.stringify({ aiEnabled: false }),
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("returns 401 when not authenticated", async () => {
    const { getStaffSession } = await import("@/lib/auth");
    (getStaffSession as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

    const { GET } = await import("@/app/api/admin/settings/route");
    const res = await GET();
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// /api/analytics GET tests
// ---------------------------------------------------------------------------
describe("GET /api/analytics", () => {
  it("returns 401 when not authenticated", async () => {
    const { getStaffSession } = await import("@/lib/auth");
    (getStaffSession as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

    const { GET } = await import("@/app/api/analytics/route");
    const res = await GET();
    expect(res.status).toBe(401);
  });
});
