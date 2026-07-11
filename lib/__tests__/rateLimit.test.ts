/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Chainable + thenable proxy, same shape as app/api/__tests__/security.test.ts:
// method calls return the proxy, terminal methods (.returning) invoke the mock.
// vi.hoisted so the vi.mock factories below can reference these after hoisting.
const { mockDbInsert, chain } = vi.hoisted(() => {
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
            if (["limit", "returning", "offset"].includes(prop)) return terminal(...args);
            return p;
          };
        },
      },
    );
    return () => p;
  };
  return { mockDbInsert, chain };
});

vi.mock("@/lib/db", () => ({
  db: { insert: chain(mockDbInsert) },
}));

vi.mock("@/lib/db/schema", () => ({
  rateLimitBuckets: { key: "key", windowStart: "window_start", count: "count" },
}));

vi.mock("@/lib/log", () => ({
  log: { warn: vi.fn(), error: vi.fn() },
  serializeError: (e: unknown) => e,
}));

import { enforce } from "@/lib/rateLimit";

const LOCAL_KEY = "sessions:::1";
const REAL_IP_KEY = "sessions:203.0.113.42";

describe("enforce localhost bypass", () => {
  beforeEach(() => {
    mockDbInsert.mockReset();
    mockDbInsert.mockReturnValue([{ count: 1 }]);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("bypasses local keys outside production without touching the DB", async () => {
    const res = await enforce(LOCAL_KEY, 5, 60);
    expect(res).toEqual({ ok: true });
    expect(mockDbInsert).not.toHaveBeenCalled();
  });

  it("enforces local keys in production when E2E_RATE_LIMIT_BYPASS is unset", async () => {
    vi.stubEnv("NODE_ENV", "production");
    mockDbInsert.mockReturnValue([{ count: 6 }]);
    const res = await enforce(LOCAL_KEY, 5, 60);
    expect(res.ok).toBe(false);
    expect(res.retryAfter).toBeGreaterThanOrEqual(1);
  });

  it("bypasses local keys in production when E2E_RATE_LIMIT_BYPASS=1", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("E2E_RATE_LIMIT_BYPASS", "1");
    const res = await enforce(LOCAL_KEY, 5, 60);
    expect(res).toEqual({ ok: true });
    expect(mockDbInsert).not.toHaveBeenCalled();
  });

  it("still limits real client IPs when E2E_RATE_LIMIT_BYPASS=1", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("E2E_RATE_LIMIT_BYPASS", "1");
    mockDbInsert.mockReturnValue([{ count: 6 }]);
    const res = await enforce(REAL_IP_KEY, 5, 60);
    expect(res.ok).toBe(false);
  });

  it("allows real client IPs under the ceiling", async () => {
    vi.stubEnv("NODE_ENV", "production");
    mockDbInsert.mockReturnValue([{ count: 5 }]);
    const res = await enforce(REAL_IP_KEY, 5, 60);
    expect(res).toEqual({ ok: true });
  });
});
