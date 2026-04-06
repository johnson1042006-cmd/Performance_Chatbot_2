/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Shared DB mock — auth checks run before DB calls, so this only needs to
// satisfy import resolution.  For the few tests that *do* hit the DB (e.g.
// claim-conflict, public-route 404) we wire up mockDbSelect / mockDbUpdate.
// ---------------------------------------------------------------------------
const mockDbSelect = vi.fn();
const mockDbInsert = vi.fn();
const mockDbUpdate = vi.fn();
const mockDbDelete = vi.fn();

const chain = (terminal: (...a: any[]) => any) => {
  const p: any = new Proxy(
    {},
    {
      get(_t, prop) {
        if (typeof prop === "symbol") return undefined;
        return (...args: any[]) => {
          if (["limit", "returning"].includes(prop)) return terminal(...args);
          if (prop === "offset") return terminal(...args);
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
    delete: chain(mockDbDelete),
  },
}));

vi.mock("@/lib/db/schema", () => ({
  sessions: { id: "id", status: "status", startedAt: "started_at", customerIdentifier: "customer_identifier" },
  messages: { sessionId: "session_id", role: "role", sentAt: "sent_at" },
  knowledgeBase: { id: "id", topic: "topic" },
  users: { id: "id", email: "email", name: "name", role: "role", isActive: "is_active", createdAt: "created_at" },
  products: { sku: "sku" },
  productPairings: { id: "id" },
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
  buildPrompt: vi.fn().mockResolvedValue({ system: "s", conversationMessages: [] }),
}));

vi.mock("@/lib/ai/callClaude", () => ({
  callClaude: vi.fn().mockResolvedValue("AI response"),
}));

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ authOptions: {} }));

vi.mock("bcryptjs", () => ({
  default: { hash: vi.fn().mockResolvedValue("hashed"), compare: vi.fn() },
}));

// Helpers ---------------------------------------------------------------
function makeReq(url: string, method = "POST", body?: object) {
  const { NextRequest } = require("next/server");
  return new NextRequest(url, {
    method,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

async function mockSession(role: "store_manager" | "support_agent" | null) {
  const { getServerSession } = await import("next-auth");
  if (role === null) {
    (getServerSession as any).mockResolvedValueOnce(null);
  } else {
    (getServerSession as any).mockResolvedValueOnce({
      user: { id: "u1", role, name: "Test User", email: "test@test.com" },
    });
  }
}

// =======================================================================
// 1. Protected routes — must return 401 for unauthenticated requests
// =======================================================================
describe("Unauthenticated access to protected routes", () => {
  beforeEach(() => vi.clearAllMocks());

  const protectedGets: [string, string][] = [
    ["GET /api/analytics", "@/app/api/analytics/route"],
    ["GET /api/sessions/history", "@/app/api/sessions/history/route"],
    ["GET /api/admin/settings", "@/app/api/admin/settings/route"],
    ["GET /api/admin/users", "@/app/api/admin/users/route"],
    ["GET /api/admin/knowledge", "@/app/api/admin/knowledge/route"],
    ["GET /api/admin/pairings", "@/app/api/admin/pairings/route"],
  ];

  for (const [label, mod] of protectedGets) {
    it(`${label} returns 401`, async () => {
      await mockSession(null);
      const { GET } = await import(mod);
      const res = label.includes("history")
        ? await GET(makeReq("http://localhost/api/sessions/history?page=1", "GET"))
        : await GET();
      expect(res.status).toBe(401);
    });
  }

  const protectedPosts: [string, string, string, object][] = [
    ["POST /api/sessions/claim", "@/app/api/sessions/claim/route", "http://localhost/api/sessions/claim", { sessionId: "s1" }],
    ["POST /api/sessions/release", "@/app/api/sessions/release/route", "http://localhost/api/sessions/release", { sessionId: "s1" }],
    ["POST /api/sessions/close", "@/app/api/sessions/close/route", "http://localhost/api/sessions/close", { sessionId: "s1" }],
    ["POST /api/admin/settings", "@/app/api/admin/settings/route", "http://localhost/api/admin/settings", { aiEnabled: true }],
    ["POST /api/admin/users", "@/app/api/admin/users/route", "http://localhost/api/admin/users", { email: "a@b.c", name: "A", password: "p" }],
    ["POST /api/admin/knowledge", "@/app/api/admin/knowledge/route", "http://localhost/api/admin/knowledge", { topic: "t", content: "c" }],
    ["POST /api/admin/pairings", "@/app/api/admin/pairings/route", "http://localhost/api/admin/pairings", { primarySku: "a", pairedSku: "b", pairingType: "c" }],
  ];

  for (const [label, mod, url, body] of protectedPosts) {
    it(`${label} returns 401`, async () => {
      await mockSession(null);
      const { POST } = await import(mod);
      const res = await POST(makeReq(url, "POST", body));
      expect(res.status).toBe(401);
    });
  }

  it("PATCH /api/admin/users returns 401", async () => {
    await mockSession(null);
    const { PATCH } = await import("@/app/api/admin/users/route");
    const res = await PATCH(makeReq("http://localhost/api/admin/users", "PATCH", { id: "u1" }));
    expect(res.status).toBe(401);
  });

  it("DELETE /api/admin/knowledge returns 401", async () => {
    await mockSession(null);
    const { DELETE } = await import("@/app/api/admin/knowledge/route");
    const res = await DELETE(makeReq("http://localhost/api/admin/knowledge?id=1", "DELETE"));
    expect(res.status).toBe(401);
  });

  it("DELETE /api/admin/pairings returns 401", async () => {
    await mockSession(null);
    const { DELETE } = await import("@/app/api/admin/pairings/route");
    const res = await DELETE(makeReq("http://localhost/api/admin/pairings?id=1", "DELETE"));
    expect(res.status).toBe(401);
  });
});

// =======================================================================
// 2. Agent (support_agent) accessing manager-only routes — must get 401
// =======================================================================
describe("Agent access to manager-only routes", () => {
  beforeEach(() => vi.clearAllMocks());

  const managerGets: [string, string][] = [
    ["GET /api/admin/settings", "@/app/api/admin/settings/route"],
    ["GET /api/admin/users", "@/app/api/admin/users/route"],
    ["GET /api/admin/knowledge", "@/app/api/admin/knowledge/route"],
    ["GET /api/admin/pairings", "@/app/api/admin/pairings/route"],
  ];

  for (const [label, mod] of managerGets) {
    it(`${label} returns 401 for agent`, async () => {
      await mockSession("support_agent");
      const { GET } = await import(mod);
      const res = await GET();
      expect(res.status).toBe(401);
    });
  }

  const managerPosts: [string, string, string, object][] = [
    ["POST /api/admin/settings", "@/app/api/admin/settings/route", "http://localhost/api/admin/settings", { aiEnabled: true }],
    ["POST /api/admin/users", "@/app/api/admin/users/route", "http://localhost/api/admin/users", { email: "a@b.c", name: "A", password: "p" }],
    ["POST /api/admin/knowledge", "@/app/api/admin/knowledge/route", "http://localhost/api/admin/knowledge", { topic: "t", content: "c" }],
    ["POST /api/admin/pairings", "@/app/api/admin/pairings/route", "http://localhost/api/admin/pairings", { primarySku: "a", pairedSku: "b", pairingType: "c" }],
  ];

  for (const [label, mod, url, body] of managerPosts) {
    it(`${label} returns 401 for agent`, async () => {
      await mockSession("support_agent");
      const { POST } = await import(mod);
      const res = await POST(makeReq(url, "POST", body));
      expect(res.status).toBe(401);
    });
  }

  it("PATCH /api/admin/users returns 401 for agent", async () => {
    await mockSession("support_agent");
    const { PATCH } = await import("@/app/api/admin/users/route");
    const res = await PATCH(makeReq("http://localhost/api/admin/users", "PATCH", { id: "u1" }));
    expect(res.status).toBe(401);
  });

  it("DELETE /api/admin/knowledge returns 401 for agent", async () => {
    await mockSession("support_agent");
    const { DELETE } = await import("@/app/api/admin/knowledge/route");
    const res = await DELETE(makeReq("http://localhost/api/admin/knowledge?id=1", "DELETE"));
    expect(res.status).toBe(401);
  });

  it("DELETE /api/admin/pairings returns 401 for agent", async () => {
    await mockSession("support_agent");
    const { DELETE } = await import("@/app/api/admin/pairings/route");
    const res = await DELETE(makeReq("http://localhost/api/admin/pairings?id=1", "DELETE"));
    expect(res.status).toBe(401);
  });
});

// =======================================================================
// 3. Business logic security
// =======================================================================
describe("Business logic security", () => {
  beforeEach(() => vi.clearAllMocks());

  it("POST /api/sessions/claim returns 409 when claimed by another agent", async () => {
    await mockSession("support_agent");
    mockDbSelect.mockResolvedValueOnce([
      { id: "s1", status: "active_human", claimedByUserId: "other-agent" },
    ]);

    const { POST } = await import("@/app/api/sessions/claim/route");
    const res = await POST(makeReq("http://localhost/api/sessions/claim", "POST", { sessionId: "s1" }));
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.error).toContain("already claimed");
  });

  it("POST /api/sessions/claim returns 404 when session does not exist", async () => {
    await mockSession("support_agent");
    mockDbSelect.mockResolvedValueOnce([]);

    const { POST } = await import("@/app/api/sessions/claim/route");
    const res = await POST(makeReq("http://localhost/api/sessions/claim", "POST", { sessionId: "nonexistent" }));
    expect(res.status).toBe(404);
  });

  it("POST /api/sessions/claim returns 400 when sessionId missing", async () => {
    await mockSession("support_agent");

    const { POST } = await import("@/app/api/sessions/claim/route");
    const res = await POST(makeReq("http://localhost/api/sessions/claim", "POST", {}));
    expect(res.status).toBe(400);
  });

  it("POST /api/sessions/release returns 400 when sessionId missing", async () => {
    await mockSession("support_agent");

    const { POST } = await import("@/app/api/sessions/release/route");
    const res = await POST(makeReq("http://localhost/api/sessions/release", "POST", {}));
    expect(res.status).toBe(400);
  });

  it("POST /api/sessions/release returns 403 when a different agent tries to release", async () => {
    await mockSession("support_agent");
    mockDbSelect.mockResolvedValueOnce([
      { id: "s1", status: "active_human", claimedByUserId: "other-agent" },
    ]);

    const { POST } = await import("@/app/api/sessions/release/route");
    const res = await POST(makeReq("http://localhost/api/sessions/release", "POST", { sessionId: "s1" }));
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error).toContain("claiming agent");
  });

  it("POST /api/sessions/release succeeds for the claiming agent", async () => {
    await mockSession("support_agent");
    mockDbSelect.mockResolvedValueOnce([
      { id: "s1", status: "active_human", claimedByUserId: "u1" },
    ]);
    mockDbUpdate.mockResolvedValueOnce([
      { id: "s1", status: "active_ai", claimedByUserId: null, claimedAt: null },
    ]);

    const { POST } = await import("@/app/api/sessions/release/route");
    const res = await POST(makeReq("http://localhost/api/sessions/release", "POST", { sessionId: "s1" }));
    expect(res.status).toBe(200);
  });

  it("POST /api/sessions/release succeeds for a manager even if not the claimer", async () => {
    await mockSession("store_manager");
    mockDbSelect.mockResolvedValueOnce([
      { id: "s1", status: "active_human", claimedByUserId: "other-agent" },
    ]);
    mockDbUpdate.mockResolvedValueOnce([
      { id: "s1", status: "active_ai", claimedByUserId: null, claimedAt: null },
    ]);

    const { POST } = await import("@/app/api/sessions/release/route");
    const res = await POST(makeReq("http://localhost/api/sessions/release", "POST", { sessionId: "s1" }));
    expect(res.status).toBe(200);
  });

  it("POST /api/chat returns 401 when unauthenticated caller sends role:agent", async () => {
    await mockSession(null);

    const { POST } = await import("@/app/api/chat/route");
    const res = await POST(makeReq("http://localhost/api/chat", "POST", {
      message: "spoofed", sessionId: "s1", role: "agent",
    }));
    expect(res.status).toBe(401);
  });

  it("POST /api/chat allows role:customer without auth (public widget)", async () => {
    mockDbSelect.mockResolvedValueOnce([{ id: "s1", status: "waiting" }]);
    mockDbInsert.mockResolvedValueOnce([{
      id: "msg-1", sessionId: "s1", role: "customer",
      content: "hello", sentAt: new Date(),
    }]);

    const { POST } = await import("@/app/api/chat/route");
    const res = await POST(makeReq("http://localhost/api/chat", "POST", {
      message: "hello", sessionId: "s1",
    }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.message.role).toBe("customer");
  });
});

// =======================================================================
// 4. Public route input validation
// =======================================================================
describe("Public route input validation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("POST /api/chat returns 400 when message is missing", async () => {
    const { POST } = await import("@/app/api/chat/route");
    const res = await POST(makeReq("http://localhost/api/chat", "POST", { sessionId: "s1" }));
    expect(res.status).toBe(400);
  });

  it("POST /api/chat returns 400 when sessionId is missing", async () => {
    const { POST } = await import("@/app/api/chat/route");
    const res = await POST(makeReq("http://localhost/api/chat", "POST", { message: "hi" }));
    expect(res.status).toBe(400);
  });

  it("POST /api/chat returns 404 for non-existent session", async () => {
    mockDbSelect.mockResolvedValueOnce([]);
    const { POST } = await import("@/app/api/chat/route");
    const res = await POST(makeReq("http://localhost/api/chat", "POST", { message: "hi", sessionId: "nope" }));
    expect(res.status).toBe(404);
  });

  it("POST /api/chat/ai-fallback returns 400 when sessionId is missing", async () => {
    const { POST } = await import("@/app/api/chat/ai-fallback/route");
    const res = await POST(makeReq("http://localhost/api/chat/ai-fallback", "POST", {}));
    expect(res.status).toBe(400);
  });

  it("POST /api/chat/ai-fallback returns 404 for non-existent session", async () => {
    mockDbSelect.mockResolvedValueOnce([]);
    const { POST } = await import("@/app/api/chat/ai-fallback/route");
    const res = await POST(makeReq("http://localhost/api/chat/ai-fallback", "POST", { sessionId: "nope" }));
    expect(res.status).toBe(404);
  });

  it("POST /api/admin/users returns 400 when fields missing (with manager auth)", async () => {
    await mockSession("store_manager");
    const { POST } = await import("@/app/api/admin/users/route");
    const res = await POST(makeReq("http://localhost/api/admin/users", "POST", { email: "a@b.c" }));
    expect(res.status).toBe(400);
  });

  it("PATCH /api/admin/users returns 400 when id missing (with manager auth)", async () => {
    await mockSession("store_manager");
    const { PATCH } = await import("@/app/api/admin/users/route");
    const res = await PATCH(makeReq("http://localhost/api/admin/users", "PATCH", { role: "support_agent" }));
    expect(res.status).toBe(400);
  });

  it("POST /api/admin/knowledge returns 400 when fields missing (with manager auth)", async () => {
    await mockSession("store_manager");
    const { POST } = await import("@/app/api/admin/knowledge/route");
    const res = await POST(makeReq("http://localhost/api/admin/knowledge", "POST", { topic: "t" }));
    expect(res.status).toBe(400);
  });

  it("DELETE /api/admin/knowledge returns 400 when id missing (with manager auth)", async () => {
    await mockSession("store_manager");
    const { DELETE } = await import("@/app/api/admin/knowledge/route");
    const res = await DELETE(makeReq("http://localhost/api/admin/knowledge", "DELETE"));
    expect(res.status).toBe(400);
  });

  it("POST /api/admin/pairings returns 400 when fields missing (with manager auth)", async () => {
    await mockSession("store_manager");
    const { POST } = await import("@/app/api/admin/pairings/route");
    const res = await POST(makeReq("http://localhost/api/admin/pairings", "POST", { primarySku: "a" }));
    expect(res.status).toBe(400);
  });

  it("DELETE /api/admin/pairings returns 400 when id missing (with manager auth)", async () => {
    await mockSession("store_manager");
    const { DELETE } = await import("@/app/api/admin/pairings/route");
    const res = await DELETE(makeReq("http://localhost/api/admin/pairings", "DELETE"));
    expect(res.status).toBe(400);
  });
});
