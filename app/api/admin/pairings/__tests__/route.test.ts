/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Chainable proxy mock that handles Drizzle's fluent API.
// The terminal mock is invoked when the chain is awaited or when a terminal
// method (.limit, .returning) is called.
const mockDbSelect = vi.fn();

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
        return (..._args: any[]) => {
          if (["limit", "returning"].includes(prop as string))
            return terminal(..._args);
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
  },
}));

vi.mock("@/lib/db/schema", () => ({
  productPairings: {
    id: "id",
    primarySku: "primary_sku",
    pairedSku: "paired_sku",
    pairingType: "pairing_type",
  },
  products: { sku: "sku", name: "name" },
}));

vi.mock("drizzle-orm/pg-core", () => ({
  alias: () => ({ sku: "sku", name: "name" }),
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(),
}));

vi.mock("@/lib/log", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  serializeError: () => ({}),
}));

const mockGetServerSession = vi.fn();
vi.mock("next-auth", () => ({ getServerSession: mockGetServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));

describe("GET /api/admin/pairings", () => {
  beforeEach(() => {
    mockDbSelect.mockReset();
    mockGetServerSession.mockReset();
    mockGetServerSession.mockResolvedValue({
      user: { id: "u-1", role: "store_manager", name: "Manager", email: "m@x" },
    });
  });

  it("returns 401 for non-managers", async () => {
    mockGetServerSession.mockResolvedValue({
      user: { id: "u-2", role: "support_agent", name: "Agent", email: "a@x" },
    });
    const { GET } = await import("@/app/api/admin/pairings/route");
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("returns 200 with primaryName populated and pairedName='Unknown' when pairedSku is not in products", async () => {
    // Simulate LEFT JOIN result: pairedSku has no match → pairedName is null
    mockDbSelect.mockResolvedValueOnce([
      {
        id: "pair-1",
        primarySku: "SKU-A",
        pairedSku: "SKU-B",
        pairingType: "accessory",
        primaryName: "Test Product",
        pairedName: null,
      },
    ]);

    const { GET } = await import("@/app/api/admin/pairings/route");
    const res = await GET();

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.pairings).toHaveLength(1);
    expect(data.pairings[0].primaryName).toBe("Test Product");
    expect(data.pairings[0].pairedName).toBe("Unknown");
  });

  it("returns 200 with both names populated when both SKUs exist", async () => {
    mockDbSelect.mockResolvedValueOnce([
      {
        id: "pair-2",
        primarySku: "SKU-C",
        pairedSku: "SKU-D",
        pairingType: "frequently_bought",
        primaryName: "Product C",
        pairedName: "Product D",
      },
    ]);

    const { GET } = await import("@/app/api/admin/pairings/route");
    const res = await GET();

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.pairings[0].primaryName).toBe("Product C");
    expect(data.pairings[0].pairedName).toBe("Product D");
  });

  it("returns 200 with empty array when no pairings exist", async () => {
    mockDbSelect.mockResolvedValueOnce([]);

    const { GET } = await import("@/app/api/admin/pairings/route");
    const res = await GET();

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.pairings).toEqual([]);
  });
});
