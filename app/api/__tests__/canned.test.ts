/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Same proxy-chain pattern as chat.test.ts so each `db.select()` /
// `db.insert()` call returns a chainable proxy that resolves via the
// terminal mock.
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
          if (["limit", "returning", "offset"].includes(prop))
            return terminal(...args);
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
  cannedResponses: {
    id: "id",
    title: "title",
    body: "body",
    category: "category",
  },
  sessions: { id: "id", customerName: "customer_name" },
  users: { id: "id", name: "name" },
}));

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  authOptions: {},
}));

vi.mock("@/lib/log", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  serializeError: (err: unknown) =>
    err instanceof Error
      ? { name: err.name, message: err.message }
      : { message: String(err) },
}));

async function setSessionUser(
  user: {
    id: string;
    role: "support_agent" | "store_manager";
    name: string;
    email: string;
  } | null
) {
  const { getServerSession } = await import("next-auth");
  (getServerSession as any).mockResolvedValue(user ? { user } : null);
}

function resetDbMocks() {
  mockDbSelect.mockReset().mockResolvedValue([]);
  mockDbInsert.mockReset().mockResolvedValue([]);
  mockDbUpdate.mockReset().mockResolvedValue([]);
  mockDbDelete.mockReset().mockResolvedValue([]);
}

// ---------------------------------------------------------------------------
// Admin canned CRUD
// ---------------------------------------------------------------------------
describe("/api/admin/canned", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDbMocks();
  });

  it("returns 401 for non-managers on POST", async () => {
    await setSessionUser({
      id: "u1",
      role: "support_agent",
      name: "Agent",
      email: "a@x",
    });

    const { NextRequest } = await import("next/server");
    const { POST } = await import("@/app/api/admin/canned/route");
    const req = new NextRequest("http://localhost/api/admin/canned", {
      method: "POST",
      body: JSON.stringify({ title: "hi", body: "hello", category: "greeting" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("returns 401 for non-managers on GET", async () => {
    await setSessionUser({
      id: "u1",
      role: "support_agent",
      name: "A",
      email: "a@x",
    });

    const { GET } = await import("@/app/api/admin/canned/route");
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("creates a canned reply for a manager", async () => {
    await setSessionUser({
      id: "mgr-1",
      role: "store_manager",
      name: "Mgr",
      email: "m@x",
    });
    mockDbInsert.mockResolvedValueOnce([
      {
        id: "c-1",
        title: "Greeting",
        body: "Hi {customer_name}!",
        category: "openers",
        createdBy: "mgr-1",
      },
    ]);

    const { NextRequest } = await import("next/server");
    const { POST } = await import("@/app/api/admin/canned/route");
    const req = new NextRequest("http://localhost/api/admin/canned", {
      method: "POST",
      body: JSON.stringify({
        title: "Greeting",
        body: "Hi {customer_name}!",
        category: "openers",
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.reply.id).toBe("c-1");
    expect(data.reply.body).toContain("{customer_name}");
  });

  it("400s on missing fields", async () => {
    await setSessionUser({
      id: "mgr-1",
      role: "store_manager",
      name: "Mgr",
      email: "m@x",
    });
    const { NextRequest } = await import("next/server");
    const { POST } = await import("@/app/api/admin/canned/route");
    const req = new NextRequest("http://localhost/api/admin/canned", {
      method: "POST",
      body: JSON.stringify({ title: "", body: "", category: "" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("PATCH updates an existing reply", async () => {
    await setSessionUser({
      id: "mgr-1",
      role: "store_manager",
      name: "Mgr",
      email: "m@x",
    });
    mockDbUpdate.mockResolvedValueOnce([
      { id: "c-1", title: "Updated", body: "Hi", category: "openers" },
    ]);

    const { NextRequest } = await import("next/server");
    const { PATCH } = await import("@/app/api/admin/canned/route");
    const req = new NextRequest("http://localhost/api/admin/canned", {
      method: "PATCH",
      body: JSON.stringify({ id: "c-1", title: "Updated" }),
    });
    const res = await PATCH(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.reply.title).toBe("Updated");
  });

  it("DELETE removes a reply", async () => {
    await setSessionUser({
      id: "mgr-1",
      role: "store_manager",
      name: "Mgr",
      email: "m@x",
    });
    mockDbDelete.mockResolvedValue([]);
    const { NextRequest } = await import("next/server");
    const { DELETE } = await import("@/app/api/admin/canned/route");
    const req = new NextRequest("http://localhost/api/admin/canned?id=c-1", {
      method: "DELETE",
    });
    const res = await DELETE(req);
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// /api/canned slash-replacement (server-side placeholder render)
// ---------------------------------------------------------------------------
describe("/api/canned (placeholder substitution)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDbMocks();
  });

  it("substitutes {customer_name} from sessions.customerName", async () => {
    await setSessionUser({
      id: "u1",
      role: "support_agent",
      name: "Agent Alex",
      email: "a@x",
    });

    mockDbSelect
      .mockResolvedValueOnce([{ customerName: "Casey" }])
      .mockResolvedValueOnce([
        {
          id: "c-1",
          title: "Greeting",
          body: "Hi {customer_name}, this is {agent_name}. Call us at {store_phone}.",
          category: "openers",
        },
      ]);

    const { NextRequest } = await import("next/server");
    const { GET } = await import("@/app/api/canned/route");
    const req = new NextRequest(
      "http://localhost/api/canned?sessionId=sess-1",
    );
    const res = await GET(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    const body = data.replies[0].body as string;
    expect(body).toContain("Hi Casey");
    expect(body).toContain("Agent Alex");
    expect(body).toContain("303-744-2011");
    expect(body).not.toContain("{customer_name}");
    expect(body).not.toContain("{agent_name}");
    expect(body).not.toContain("{store_phone}");
  });

  it("falls back to 'there' when customerName is null", async () => {
    await setSessionUser({
      id: "u1",
      role: "support_agent",
      name: "Agent Alex",
      email: "a@x",
    });

    mockDbSelect
      .mockResolvedValueOnce([{ customerName: null }])
      .mockResolvedValueOnce([
        {
          id: "c-1",
          title: "Greeting",
          body: "Hi {customer_name}!",
          category: "openers",
        },
      ]);

    const { NextRequest } = await import("next/server");
    const { GET } = await import("@/app/api/canned/route");
    const req = new NextRequest(
      "http://localhost/api/canned?sessionId=sess-1",
    );
    const res = await GET(req);
    const data = await res.json();
    expect(data.replies[0].body).toBe("Hi there!");
  });

  it("returns 401 when not authed", async () => {
    await setSessionUser(null);
    const { NextRequest } = await import("next/server");
    const { GET } = await import("@/app/api/canned/route");
    const req = new NextRequest("http://localhost/api/canned");
    const res = await GET(req);
    expect(res.status).toBe(401);
  });
});
