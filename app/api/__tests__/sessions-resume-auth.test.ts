/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "crypto";

// Mirror of hashSessionToken() — inlined (not imported) so we don't statically
// pull @/lib/db in before the hoisted vi.mock factories below are initialized.
const hashSessionToken = (token: string): string =>
  createHash("sha256").update(token).digest("hex");

// Regression coverage for the session-resume ownership check: POST /api/sessions
// must only adopt an existing open session (returning its token + PII) when the
// caller proves ownership by presenting the session's current token. Knowing the
// customerIdentifier alone must NOT be enough — it yields a fresh session.

const mockDbSelect = vi.fn();
const updatedSets: any[] = [];
const insertedValues: any[] = [];

const selectChain = (terminal: (...a: any[]) => any) => {
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
          if (["limit", "returning", "offset"].includes(prop as string))
            return terminal(...args);
          return p;
        };
      },
    }
  );
  return () => p;
};

// db.update(...).set(...).where(...) — records the .set() payload and resolves.
const updateProxy: any = new Proxy(
  {},
  {
    get(_t, prop) {
      if (prop === "then") return undefined;
      return (...args: any[]) => {
        if (prop === "set") updatedSets.push(args[0]);
        if (prop === "where") return Promise.resolve(undefined);
        return updateProxy;
      };
    },
  }
);

const insertProxy: any = new Proxy(
  {},
  {
    get(_t, prop) {
      if (prop === "then") return undefined;
      return (...args: any[]) => {
        if (prop === "values") insertedValues.push(args[0]);
        if (prop === "returning") {
          const last = insertedValues[insertedValues.length - 1] ?? {};
          return Promise.resolve([
            { id: "sess-fresh", ...last, startedAt: new Date(), status: "waiting" },
          ]);
        }
        return insertProxy;
      };
    },
  }
);

vi.mock("@/lib/db", () => ({
  db: {
    select: selectChain(mockDbSelect),
    update: () => updateProxy,
    insert: () => insertProxy,
  },
}));

vi.mock("@/lib/db/schema", () => ({
  sessions: {
    id: "id",
    status: "status",
    startedAt: "started_at",
    customerIdentifier: "customer_identifier",
    tokenHash: "token_hash",
  },
  users: { id: "id", name: "name" },
  messages: { sessionId: "session_id", role: "role" },
}));

vi.mock("@/lib/sessions/lazyTick", () => ({
  maybeLazyTick: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/rateLimit", () => ({
  enforce: vi.fn().mockResolvedValue({ ok: true }),
  getClientIp: vi.fn().mockReturnValue("127.0.0.1"),
}));

vi.mock("@/lib/log", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  serializeError: (err: unknown) =>
    err instanceof Error ? { name: err.name, message: err.message } : { message: String(err) },
}));

const VICTIM_ID = "embed_victim";
const REAL_TOKEN = "the-real-raw-token";

function openSessionRow() {
  return {
    id: "sess-existing",
    status: "waiting",
    startedAt: new Date(),
    customerIdentifier: VICTIM_ID,
    tokenHash: hashSessionToken(REAL_TOKEN),
    customerEmail: "victim@example.com",
    customerName: "Victim",
    lastCustomerActivityAt: new Date(),
  };
}

describe("POST /api/sessions resume ownership", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insertedValues.length = 0;
    updatedSets.length = 0;
    // The existing-session lookup returns one open session for VICTIM_ID.
    mockDbSelect.mockReset().mockResolvedValue([openSessionRow()]);
  });

  it("adopts the existing session when the token is presented via the pc_st_<id> cookie (primary path, no header)", async () => {
    const { NextRequest } = await import("next/server");
    const { POST } = await import("@/app/api/sessions/route");

    // Cookie is the primary/preferred ownership check (extractToken reads it
    // before the header). This is the happy path in cookie-friendly browsers.
    const req = new NextRequest("http://localhost/api/sessions", {
      method: "POST",
      headers: { cookie: `pc_st_sess-existing=${REAL_TOKEN}` },
      body: JSON.stringify({ customerIdentifier: VICTIM_ID }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.session.id).toBe("sess-existing");
    expect(typeof data.sessionToken).toBe("string");
    expect(updatedSets.length).toBe(1);
    expect(insertedValues.length).toBe(0);
  });

  it("adopts the existing session via the x-session-token header FALLBACK when the cookie is absent (Safari ITP / Firefox ETP-strict / Chrome partitioning)", async () => {
    const { NextRequest } = await import("next/server");
    const { POST } = await import("@/app/api/sessions/route");

    // No cookie header at all — mirrors the widget's localStorage-token resume
    // path in a third-party-cookie-blocking browser. Ownership is proven purely
    // by the x-session-token header carrying the persisted token.
    const req = new NextRequest("http://localhost/api/sessions", {
      method: "POST",
      headers: { "x-session-token": REAL_TOKEN },
      body: JSON.stringify({ customerIdentifier: VICTIM_ID }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    // Legit resume: existing session returned with a rotated token, no new row.
    expect(data.session.id).toBe("sess-existing");
    expect(typeof data.sessionToken).toBe("string");
    expect(updatedSets.length).toBe(1);
    expect(insertedValues.length).toBe(0);
  });

  it("does NOT adopt the session (no token) — mints a fresh session instead, leaking no PII/token for the victim's session", async () => {
    const { NextRequest } = await import("next/server");
    const { POST } = await import("@/app/api/sessions/route");

    // Attacker knows only the customerIdentifier; carries no session token.
    const req = new NextRequest("http://localhost/api/sessions", {
      method: "POST",
      body: JSON.stringify({ customerIdentifier: VICTIM_ID }),
    });

    const res = await POST(req);
    expect(res.status).toBe(201);
    const data = await res.json();
    // A brand-new session is created; the victim's existing session is NOT
    // returned and its token is not rotated.
    expect(data.session.id).toBe("sess-fresh");
    expect(data.session.customerEmail).toBeUndefined();
    expect(updatedSets.length).toBe(0);
    expect(insertedValues.length).toBe(1);
  });

  it("does NOT adopt the session when a wrong token is presented", async () => {
    const { NextRequest } = await import("next/server");
    const { POST } = await import("@/app/api/sessions/route");

    const req = new NextRequest("http://localhost/api/sessions", {
      method: "POST",
      headers: { "x-session-token": "wrong-token" },
      body: JSON.stringify({ customerIdentifier: VICTIM_ID }),
    });

    const res = await POST(req);
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.session.id).toBe("sess-fresh");
    expect(insertedValues.length).toBe(1);
  });
});
