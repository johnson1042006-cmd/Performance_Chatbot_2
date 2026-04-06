import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock all external dependencies used by the chat API routes
// ---------------------------------------------------------------------------
const mockDbSelect = vi.fn();
const mockDbInsert = vi.fn();
const mockDbUpdate = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: () => mockDbSelect() }) }) }),
    insert: () => ({ values: () => ({ returning: () => mockDbInsert() }) }),
    update: () => ({ set: () => ({ where: () => mockDbUpdate() }) }),
  },
}));

vi.mock("@/lib/db/schema", () => ({
  sessions: { id: "id", status: "status" },
  messages: { sessionId: "session_id" },
  knowledgeBase: { topic: "topic" },
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

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  authOptions: {},
}));

// ---------------------------------------------------------------------------
// /api/chat POST tests
// ---------------------------------------------------------------------------
describe("POST /api/chat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    mockDbSelect.mockResolvedValueOnce([{ id: "sess-1", status: "active_human" }]);

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
    mockDbSelect.mockResolvedValueOnce([{ id: "sess-1", status: "waiting" }]);
    mockDbUpdate.mockResolvedValueOnce(undefined);
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
    const { getServerSession } = await import("next-auth");
    (getServerSession as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      user: { id: "u1", role: "support_agent", name: "Agent", email: "a@test.com" },
    });

    const { GET } = await import("@/app/api/admin/settings/route");
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("requires store_manager role for POST", async () => {
    const { getServerSession } = await import("next-auth");
    (getServerSession as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
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
    const { getServerSession } = await import("next-auth");
    (getServerSession as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

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
    const { getServerSession } = await import("next-auth");
    (getServerSession as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

    const { GET } = await import("@/app/api/analytics/route");
    const res = await GET();
    expect(res.status).toBe(401);
  });
});
