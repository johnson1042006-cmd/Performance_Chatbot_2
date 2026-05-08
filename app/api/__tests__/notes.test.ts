/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockDbSelect = vi.fn();
const mockDbInsert = vi.fn();

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
  },
}));

vi.mock("@/lib/db/schema", () => ({
  chatEvents: {
    id: "id",
    sessionId: "session_id",
    type: "type",
    actorUserId: "actor_user_id",
    metadata: "metadata",
    createdAt: "created_at",
  },
  sessions: { id: "id" },
  users: { id: "id", name: "name" },
  messages: { sessionId: "session_id", role: "role" },
}));

const triggerSpy = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/pusher/server", () => ({
  getPusher: () => ({
    trigger: triggerSpy,
  }),
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

function resetMocks() {
  mockDbSelect.mockReset().mockResolvedValue([]);
  mockDbInsert.mockReset().mockResolvedValue([]);
  triggerSpy.mockClear();
}

describe("/api/sessions/[id]/notes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetMocks();
  });

  it("401s when not authed (POST)", async () => {
    await setSessionUser(null);
    const { NextRequest } = await import("next/server");
    const { POST } = await import("@/app/api/sessions/[id]/notes/route");
    const req = new NextRequest("http://localhost/api/sessions/s-1/notes", {
      method: "POST",
      body: JSON.stringify({ body: "hi" }),
    });
    const res = await POST(req, { params: { id: "s-1" } });
    expect(res.status).toBe(401);
  });

  it("400s on empty body", async () => {
    await setSessionUser({
      id: "u1",
      role: "support_agent",
      name: "Alex",
      email: "a@x",
    });
    const { NextRequest } = await import("next/server");
    const { POST } = await import("@/app/api/sessions/[id]/notes/route");
    const req = new NextRequest("http://localhost/api/sessions/s-1/notes", {
      method: "POST",
      body: JSON.stringify({ body: "   " }),
    });
    const res = await POST(req, { params: { id: "s-1" } });
    expect(res.status).toBe(400);
  });

  it("inserts a note as chat_events row and never triggers session-* Pusher channel", async () => {
    await setSessionUser({
      id: "u1",
      role: "support_agent",
      name: "Alex",
      email: "a@x",
    });
    mockDbSelect.mockResolvedValueOnce([{ id: "s-1" }]);
    mockDbInsert.mockResolvedValueOnce([
      {
        id: "n-1",
        sessionId: "s-1",
        type: "internal_note",
        actorUserId: "u1",
        metadata: { body: "private memo" },
        createdAt: new Date(),
      },
    ]);

    const { NextRequest } = await import("next/server");
    const { POST } = await import("@/app/api/sessions/[id]/notes/route");
    const req = new NextRequest("http://localhost/api/sessions/s-1/notes", {
      method: "POST",
      body: JSON.stringify({ body: "private memo" }),
    });
    const res = await POST(req, { params: { id: "s-1" } });
    expect(res.status).toBe(201);

    const data = await res.json();
    expect(data.note.body).toBe("private memo");

    // The route must NOT trigger anything on session-${id}.
    const channelCalls = triggerSpy.mock.calls.map((c) => c[0]);
    expect(channelCalls).not.toContain("session-s-1");
    for (const ch of channelCalls) {
      expect(ch).not.toMatch(/^session-/);
    }
  });

  it("GET returns notes joined with author name", async () => {
    await setSessionUser({
      id: "u1",
      role: "support_agent",
      name: "Alex",
      email: "a@x",
    });
    mockDbSelect.mockResolvedValueOnce([
      {
        id: "n-1",
        metadata: { body: "memo" },
        createdAt: new Date(),
        actorUserId: "u1",
        authorName: "Alex",
      },
    ]);
    const { NextRequest } = await import("next/server");
    const { GET } = await import("@/app/api/sessions/[id]/notes/route");
    const req = new NextRequest("http://localhost/api/sessions/s-1/notes");
    const res = await GET(req, { params: { id: "s-1" } });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.notes[0].body).toBe("memo");
    expect(data.notes[0].authorName).toBe("Alex");
  });
});
