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

// Capture the values passed to db.insert(...).values(...) so we can assert
// on the geo columns. We do this with a thin wrapper around the chain proxy:
// the .values() call is intercepted to record args.
const insertedValues: any[] = [];
const insertProxy: any = new Proxy(
  {},
  {
    get(_t, prop) {
      if (prop === "then") return undefined;
      return (...args: any[]) => {
        if (prop === "values") {
          insertedValues.push(args[0]);
        }
        if (prop === "returning") {
          // Return a "session row" echoing whatever was inserted so the
          // route's `.returning()` resolves to a defined session.
          const last = insertedValues[insertedValues.length - 1] ?? {};
          return Promise.resolve([
            {
              id: "sess-new",
              ...last,
              startedAt: new Date(),
              status: "waiting",
            },
          ]);
        }
        return insertProxy;
      };
    },
  },
);

vi.mock("@/lib/db", () => ({
  db: {
    select: chain(mockDbSelect),
    insert: () => insertProxy,
  },
}));

vi.mock("@/lib/db/schema", () => ({
  sessions: {
    id: "id",
    status: "status",
    startedAt: "started_at",
    customerIdentifier: "customer_identifier",
  },
  users: { id: "id", name: "name" },
  messages: { sessionId: "session_id", role: "role" },
}));

vi.mock("@/lib/sessions/state", () => ({
  processDueAiClaims: vi.fn().mockResolvedValue(undefined),
  sweepStaleSessions: vi.fn().mockResolvedValue(undefined),
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

function reset() {
  insertedValues.length = 0;
  mockDbSelect.mockReset().mockResolvedValue([]);
  mockDbInsert.mockReset().mockResolvedValue([]);
}

describe("POST /api/sessions geo capture", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reset();
  });

  it("persists Vercel geo columns when x-vercel-ip-* headers are present", async () => {
    const { NextRequest } = await import("next/server");
    const { POST } = await import("@/app/api/sessions/route");

    const req = new NextRequest("http://localhost/api/sessions", {
      method: "POST",
      headers: {
        "x-vercel-ip-city": "Denver",
        "x-vercel-ip-country-region": "CO",
        "x-vercel-ip-country": "US",
      },
      body: JSON.stringify({
        customerIdentifier: "embed_abc",
        pageContext: null,
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(201);
    expect(insertedValues.length).toBe(1);
    expect(insertedValues[0].customerCity).toBe("Denver");
    expect(insertedValues[0].customerRegion).toBe("CO");
    expect(insertedValues[0].customerCountry).toBe("US");
  });

  it("decodes URL-encoded city values from Vercel", async () => {
    const { NextRequest } = await import("next/server");
    const { POST } = await import("@/app/api/sessions/route");

    const req = new NextRequest("http://localhost/api/sessions", {
      method: "POST",
      headers: {
        "x-vercel-ip-city": "Mountain%20View",
        "x-vercel-ip-country-region": "CA",
        "x-vercel-ip-country": "US",
      },
      body: JSON.stringify({
        customerIdentifier: "embed_xyz",
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    expect(insertedValues[0].customerCity).toBe("Mountain View");
  });

  it("leaves all three geo columns null when Vercel headers are absent", async () => {
    const { NextRequest } = await import("next/server");
    const { POST } = await import("@/app/api/sessions/route");

    const req = new NextRequest("http://localhost/api/sessions", {
      method: "POST",
      body: JSON.stringify({ customerIdentifier: "embed_def" }),
    });

    const res = await POST(req);
    expect(res.status).toBe(201);
    expect(insertedValues[0].customerCity).toBeUndefined();
    expect(insertedValues[0].customerRegion).toBeUndefined();
    expect(insertedValues[0].customerCountry).toBeUndefined();
  });
});
