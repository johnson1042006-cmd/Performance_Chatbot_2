/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Unit tests for sendEscalationPush.
 *
 * Verifies that it:
 *  1. No-ops (no DB read, no send) when VAPID env is not configured.
 *  2. Sends a web-push notification to every saved subscription.
 *  3. Prunes a subscription when the push service reports it gone (410).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSelect = vi.fn();
const mockDelete = vi.fn();

// Chainable + thenable proxy. Builder calls (.from, .where) return the proxy;
// awaiting the chain invokes the supplied terminal mock.
const chain = (terminal: (...a: any[]) => any) => {
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
        return () => p;
      },
    }
  );
  return () => p;
};

vi.mock("@/lib/db", () => ({
  db: {
    select: chain(mockSelect),
    delete: chain(mockDelete),
  },
}));

vi.mock("@/lib/db/schema", () => ({
  pushSubscriptions: {
    endpoint: "endpoint",
    p256dh: "p256dh",
    auth: "auth",
    userId: "user_id",
  },
}));

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual };
});

const mockSetVapid = vi.fn();
const mockSendNotification = vi.fn();
vi.mock("web-push", () => ({
  default: {
    setVapidDetails: mockSetVapid,
    sendNotification: mockSendNotification,
  },
}));

vi.mock("@/lib/log", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  serializeError: (err: unknown) =>
    err instanceof Error ? { message: err.message } : { message: String(err) },
}));

const SUB_A = { endpoint: "https://push/a", p256dh: "pa", auth: "aa" };
const SUB_B = { endpoint: "https://push/b", p256dh: "pb", auth: "ab" };

function setVapidEnv() {
  process.env.VAPID_PUBLIC_KEY = "test-public";
  process.env.VAPID_PRIVATE_KEY = "test-private";
  process.env.VAPID_SUBJECT = "mailto:test@test.com";
}

function clearVapidEnv() {
  delete process.env.VAPID_PUBLIC_KEY;
  delete process.env.VAPID_PRIVATE_KEY;
  delete process.env.VAPID_SUBJECT;
}

describe("sendEscalationPush", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockSelect.mockResolvedValue([]);
    mockDelete.mockResolvedValue([]);
    mockSendNotification.mockResolvedValue(undefined);
  });

  it("no-ops when VAPID env is not configured", async () => {
    clearVapidEnv();
    const { sendEscalationPush } = await import("@/lib/push/send");
    await sendEscalationPush({
      sessionId: "s1",
      reason: "explicit_request",
      urgency: "normal",
    });

    expect(mockSendNotification).not.toHaveBeenCalled();
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it("sends a notification to every saved subscription", async () => {
    setVapidEnv();
    mockSelect.mockResolvedValue([SUB_A, SUB_B]);

    const { sendEscalationPush } = await import("@/lib/push/send");
    await sendEscalationPush({
      sessionId: "s1",
      reason: "explicit_request",
      urgency: "normal",
    });

    expect(mockSetVapid).toHaveBeenCalled();
    expect(mockSendNotification).toHaveBeenCalledTimes(2);

    const endpoints = mockSendNotification.mock.calls.map(
      ([sub]) => sub.endpoint
    );
    expect(endpoints).toEqual(
      expect.arrayContaining([SUB_A.endpoint, SUB_B.endpoint])
    );

    // Title comes from the reason-label map.
    const [, payload] = mockSendNotification.mock.calls[0];
    expect(JSON.parse(payload).title).toBe("Customer asked for a human");
  });

  it("prunes a subscription when the push service returns 410", async () => {
    setVapidEnv();
    mockSelect.mockResolvedValue([SUB_A]);
    mockSendNotification.mockRejectedValueOnce({ statusCode: 410 });

    const { sendEscalationPush } = await import("@/lib/push/send");
    await sendEscalationPush({
      sessionId: "s1",
      reason: "frustrated_customer",
      urgency: "high",
    });

    // The expired endpoint is deleted.
    expect(mockDelete).toHaveBeenCalledTimes(1);
  });

  it("does not prune on a transient (500) send failure", async () => {
    setVapidEnv();
    mockSelect.mockResolvedValue([SUB_A]);
    mockSendNotification.mockRejectedValueOnce({ statusCode: 500 });

    const { sendEscalationPush } = await import("@/lib/push/send");
    await sendEscalationPush({
      sessionId: "s1",
      reason: "unsupported",
      urgency: "normal",
    });

    expect(mockDelete).not.toHaveBeenCalled();
  });
});
