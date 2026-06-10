/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock setup mirrors app/api/__tests__/chat.test.ts. A proxy-based
// chainable+thenable surface lets us await `db.select().from().where()...`
// at any point and resolve from a single mock function.
// ---------------------------------------------------------------------------
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
  sessions: { id: "id" },
  messages: { sessionId: "session_id", role: "role" },
}));

vi.mock("@/lib/pusher/server", () => ({
  getPusher: () => ({ trigger: vi.fn().mockResolvedValue(undefined) }),
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

// Token enforcement is covered in security.test.ts; allow everything here so
// the route's own selects line up with the positional mock queues.
vi.mock("@/lib/sessions/verifySessionToken", () => ({
  verifySessionAccess: vi.fn().mockResolvedValue(true),
}));

const mockGetOrder = vi.fn();
const mockGetShipments = vi.fn();
vi.mock("@/lib/bigcommerce/client", () => ({
  getOrderByEmailAndOrderId: (...args: any[]) => mockGetOrder(...args),
  getOrderShipments: (...args: any[]) => mockGetShipments(...args),
  BC_ORDER_STATUS: {
    2: "Shipped",
    7: "Awaiting Payment",
    11: "Awaiting Fulfillment",
  },
}));

const VALID_SESSION_ID = "11111111-1111-1111-1111-111111111111";

function resetDbMocks() {
  mockDbSelect.mockReset().mockResolvedValue([]);
  mockDbInsert.mockReset().mockResolvedValue([]);
}

describe("POST /api/orders/lookup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDbMocks();
    mockGetOrder.mockReset();
    mockGetShipments.mockReset();
  });

  it("returns 400 when email is missing", async () => {
    const { NextRequest } = await import("next/server");
    const { POST } = await import("@/app/api/orders/lookup/route");

    const req = new NextRequest("http://localhost/api/orders/lookup", {
      method: "POST",
      body: JSON.stringify({ orderId: 12345, sessionId: VALID_SESSION_ID }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/email/i);
  });

  it("returns 400 when email is malformed", async () => {
    const { NextRequest } = await import("next/server");
    const { POST } = await import("@/app/api/orders/lookup/route");

    const req = new NextRequest("http://localhost/api/orders/lookup", {
      method: "POST",
      body: JSON.stringify({
        email: "not-an-email",
        orderId: 12345,
        sessionId: VALID_SESSION_ID,
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 when orderId is missing", async () => {
    const { NextRequest } = await import("next/server");
    const { POST } = await import("@/app/api/orders/lookup/route");

    const req = new NextRequest("http://localhost/api/orders/lookup", {
      method: "POST",
      body: JSON.stringify({
        email: "j@e.co",
        sessionId: VALID_SESSION_ID,
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/order/i);
  });

  it("returns 400 when orderId is non-positive", async () => {
    const { NextRequest } = await import("next/server");
    const { POST } = await import("@/app/api/orders/lookup/route");

    const req = new NextRequest("http://localhost/api/orders/lookup", {
      method: "POST",
      body: JSON.stringify({
        email: "j@e.co",
        orderId: -5,
        sessionId: VALID_SESSION_ID,
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns { found: false } when BC has no matching order", async () => {
    // Session lookup succeeds, BC returns null.
    mockDbSelect.mockResolvedValueOnce([{ id: VALID_SESSION_ID }]);
    mockGetOrder.mockResolvedValueOnce(null);

    const { NextRequest } = await import("next/server");
    const { POST } = await import("@/app/api/orders/lookup/route");

    const req = new NextRequest("http://localhost/api/orders/lookup", {
      method: "POST",
      body: JSON.stringify({
        email: "j@e.co",
        orderId: 12345,
        sessionId: VALID_SESSION_ID,
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.found).toBe(false);
  });

  it("returns 200 with summary and inserts AI message when order is found", async () => {
    mockDbSelect.mockResolvedValueOnce([{ id: VALID_SESSION_ID }]);
    mockGetOrder.mockResolvedValueOnce({
      id: 12345,
      status: "Shipped",
      status_id: 2,
      date_created: "Mon, 12 Jan 2026 09:14:25 +0000",
      total_inc_tax: "234.50",
      currency_code: "USD",
      items_total: 3,
      items_shipped: 3,
      payment_method: "Credit Card",
      customer_id: 99,
      billing_address: { first_name: "J", last_name: "D" },
    });
    mockGetShipments.mockResolvedValueOnce([
      {
        id: 1,
        order_id: 12345,
        tracking_number: "1Z999AA10123456784",
        tracking_carrier: "ups",
        date_created: "Mon, 12 Jan 2026 09:14:25 +0000",
        shipping_method: "UPS Ground",
      },
    ]);
    mockDbInsert.mockResolvedValueOnce([
      {
        id: "msg-1",
        sessionId: VALID_SESSION_ID,
        role: "ai",
        content: "summary",
        sentAt: new Date(),
      },
    ]);

    const { NextRequest } = await import("next/server");
    const { POST } = await import("@/app/api/orders/lookup/route");

    const req = new NextRequest("http://localhost/api/orders/lookup", {
      method: "POST",
      body: JSON.stringify({
        email: "j@e.co",
        orderId: 12345,
        sessionId: VALID_SESSION_ID,
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.found).toBe(true);
    expect(data.order.id).toBe(12345);
    expect(data.order.status).toBe("Shipped");
    expect(data.message.id).toBe("msg-1");

    // Confirms an AI message was inserted (not a customer or agent message).
    expect(mockDbInsert).toHaveBeenCalledTimes(1);
  });

  it("returns 404 when the session does not exist", async () => {
    mockDbSelect.mockResolvedValueOnce([]);

    const { NextRequest } = await import("next/server");
    const { POST } = await import("@/app/api/orders/lookup/route");

    const req = new NextRequest("http://localhost/api/orders/lookup", {
      method: "POST",
      body: JSON.stringify({
        email: "j@e.co",
        orderId: 12345,
        sessionId: VALID_SESSION_ID,
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(404);
  });
});
