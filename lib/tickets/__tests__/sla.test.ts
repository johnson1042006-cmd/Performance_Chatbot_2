/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

const harness = vi.hoisted(() => {
  const triggerSpy = vi.fn().mockResolvedValue(undefined);
  const slackSpy = vi.fn().mockResolvedValue(true);
  const dbState: { executeQueue: unknown[]; insertCalls: unknown[] } = {
    executeQueue: [],
    insertCalls: [],
  };
  return { triggerSpy, slackSpy, dbState };
});

vi.mock("@/lib/log", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  serializeError: (err: unknown) =>
    err instanceof Error
      ? { name: err.name, message: err.message }
      : { message: String(err) },
}));

vi.mock("@/lib/pusher/server", () => ({
  getPusher: () => ({ trigger: harness.triggerSpy }),
}));

vi.mock("@/lib/alerts/notify", () => ({
  sendTicketSlaBreachAlert: harness.slackSpy,
}));

vi.mock("@/lib/db", () => ({
  db: {
    execute: vi.fn(async () => harness.dbState.executeQueue.shift() ?? { rows: [] }),
    insert: () => ({
      values: (vals: unknown) => {
        harness.dbState.insertCalls.push(vals);
        return Promise.resolve(undefined);
      },
    }),
  },
}));

vi.mock("@/lib/db/schema", () => ({
  alertEvents: {},
}));

import { slaHoursToMs, sweepBreachedTickets } from "@/lib/tickets/sla";

describe("slaHoursToMs", () => {
  it("returns the priority window in milliseconds", () => {
    expect(slaHoursToMs("urgent")).toBe(2 * 60 * 60 * 1000);
    expect(slaHoursToMs("high")).toBe(4 * 60 * 60 * 1000);
    expect(slaHoursToMs("normal")).toBe(24 * 60 * 60 * 1000);
    expect(slaHoursToMs("low")).toBe(72 * 60 * 60 * 1000);
  });

  it("respects custom windows", () => {
    expect(
      slaHoursToMs("urgent", { urgent: 1, high: 2, normal: 6, low: 12 })
    ).toBe(1 * 60 * 60 * 1000);
  });

  it("clamps below 1 hour and above 720", () => {
    expect(slaHoursToMs("urgent", { urgent: 0 })).toBe(1 * 60 * 60 * 1000);
    expect(slaHoursToMs("low", { low: 9999 })).toBe(720 * 60 * 60 * 1000);
  });
});

describe("sweepBreachedTickets", () => {
  beforeEach(() => {
    harness.dbState.executeQueue = [];
    harness.dbState.insertCalls = [];
    harness.triggerSpy.mockClear();
    harness.slackSpy.mockClear();
  });

  it("returns 0 and does no fan-out when no tickets breach", async () => {
    harness.dbState.executeQueue = [{ rows: [] }];
    const n = await sweepBreachedTickets();
    expect(n).toBe(0);
    expect(harness.dbState.insertCalls.length).toBe(0);
    expect(harness.triggerSpy).not.toHaveBeenCalled();
    expect(harness.slackSpy).not.toHaveBeenCalled();
  });

  it("inserts an alert_events row, fires Pusher, and posts Slack per breached ticket", async () => {
    const dueAt = new Date(Date.now() - 3 * 60 * 60 * 1000); // 3h past due
    harness.dbState.executeQueue = [
      {
        rows: [
          {
            id: "t-1",
            ticket_number: 7,
            subject: "Order missing",
            priority: "urgent",
            due_at: dueAt,
          },
        ],
      },
    ];
    const n = await sweepBreachedTickets();
    expect(n).toBe(1);
    expect(harness.dbState.insertCalls.length).toBe(1);
    const inserted = harness.dbState.insertCalls[0] as Record<string, unknown>;
    expect(inserted.kind).toBe("ticket_sla_breach");
    expect(inserted.value).toBe("7");

    expect(harness.triggerSpy).toHaveBeenCalledWith(
      "alerts",
      "ticket-sla-breached",
      expect.objectContaining({
        ticketId: "t-1",
        ticketNumber: 7,
        priority: "urgent",
      })
    );
    expect(harness.slackSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        ticketId: "t-1",
        ticketNumber: 7,
        priority: "urgent",
        hoursPastDue: expect.any(Number),
      })
    );
  });
});
