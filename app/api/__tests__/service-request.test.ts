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
  sessions: {
    id: "id",
    customerEmail: "customer_email",
    customerName: "customer_name",
    status: "status",
  },
  chatEvents: { sessionId: "session_id", type: "type", metadata: "metadata" },
  messages: {
    id: "id",
    sessionId: "session_id",
    role: "role",
    content: "content",
    sentAt: "sent_at",
    redactionHits: "redaction_hits",
    confidence: "confidence",
    sentiment: "sentiment",
  },
}));

const triggerSpy = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/pusher/server", () => ({
  getPusher: () => ({ trigger: triggerSpy }),
}));

vi.mock("@/lib/rateLimit", () => ({
  enforce: vi.fn().mockResolvedValue({ ok: true }),
  getClientIp: () => "127.0.0.1",
}));

vi.mock("@/lib/log", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  serializeError: (err: unknown) =>
    err instanceof Error
      ? { name: err.name, message: err.message }
      : { message: String(err) },
}));

const sendSpy = vi.fn().mockResolvedValue({ ok: true, status: 200 });
vi.mock("@/lib/email/templates/tech-air-request", () => ({
  sendTechAirRequestEmail: (...args: any[]) => sendSpy(...args),
}));

function resetMocks() {
  mockDbSelect.mockReset().mockResolvedValue([]);
  mockDbInsert.mockReset().mockResolvedValue([]);
  triggerSpy.mockClear();
  sendSpy.mockClear();
  process.env.SERVICE_INBOX = "service@example.com";
}

describe("/api/sessions/[id]/service-request", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetMocks();
  });

  it("400s when serial number is missing", async () => {
    const { NextRequest } = await import("next/server");
    const { POST } = await import("@/app/api/sessions/[id]/service-request/route");

    const req = new NextRequest(
      "http://localhost/api/sessions/11111111-1111-1111-1111-111111111111/service-request",
      {
        method: "POST",
        body: JSON.stringify({
          fullName: "Alex",
          email: "a@x.com",
          airbagModel: "Tech-Air 5",
          serialNumber: "   ",
          serviceRequested: "Cartridge replacement",
          description: "Error light",
          returnShippingAddress: "Name\nStreet\nCity, ST 80000",
          preferredReturnShipping: "Standard ground",
          consent: true,
        }),
      },
    );
    const res = await POST(req, {
      params: { id: "11111111-1111-1111-1111-111111111111" },
    });
    expect(res.status).toBe(400);
  });

  it("400s on invalid email", async () => {
    const { NextRequest } = await import("next/server");
    const { POST } = await import("@/app/api/sessions/[id]/service-request/route");

    const req = new NextRequest(
      "http://localhost/api/sessions/11111111-1111-1111-1111-111111111111/service-request",
      {
        method: "POST",
        body: JSON.stringify({
          fullName: "Alex",
          email: "not-an-email",
          airbagModel: "Tech-Air 5",
          serialNumber: "SN123",
          serviceRequested: "Cartridge replacement",
          description: "Error light",
          returnShippingAddress: "Name\nStreet\nCity, ST 80000",
          preferredReturnShipping: "Standard ground",
          consent: true,
        }),
      },
    );
    const res = await POST(req, {
      params: { id: "11111111-1111-1111-1111-111111111111" },
    });
    expect(res.status).toBe(400);
  });

  it("happy path: inserts note + sends email + inserts confirmation message", async () => {
    mockDbSelect.mockResolvedValueOnce([
      {
        id: "11111111-1111-1111-1111-111111111111",
        customerEmail: null,
        customerName: null,
      },
    ]);
    // First insert: internal_note
    // Second insert: messages row returning saved message
    mockDbInsert
      .mockResolvedValueOnce([{ id: "n1" }])
      .mockResolvedValueOnce([
        {
          id: "m1",
          role: "ai",
          content: "Got it",
          sentAt: new Date().toISOString(),
        },
      ]);

    const { NextRequest } = await import("next/server");
    const { POST } = await import("@/app/api/sessions/[id]/service-request/route");

    const req = new NextRequest(
      "http://localhost/api/sessions/11111111-1111-1111-1111-111111111111/service-request",
      {
        method: "POST",
        body: JSON.stringify({
          fullName: "Alex Rider",
          email: "alex@example.com",
          phone: "(303) 555-1212",
          airbagModel: "Tech-Air 5",
          serialNumber: "SN123",
          serviceRequested: "Cartridge replacement",
          description: "Error light E1",
          returnShippingAddress: "Alex Rider\n123 Main St\nCentennial, CO 80112",
          preferredReturnShipping: "Standard ground",
          consent: true,
        }),
      },
    );
    const res = await POST(req, {
      params: { id: "11111111-1111-1111-1111-111111111111" },
    });
    expect(res.status).toBe(200);
    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(mockDbInsert).toHaveBeenCalled();
  });
});

