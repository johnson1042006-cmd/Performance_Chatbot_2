/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

// We test the pure decision matrix directly, plus the runAutoTicket
// orchestration via a mock-db harness mirroring the pattern in
// app/api/__tests__/notes.test.ts.

const harness = vi.hoisted(() => {
  const triggerSpy = vi.fn().mockResolvedValue(undefined);
  const sendTicketCreatedEmailSpy = vi
    .fn()
    .mockResolvedValue({ ok: true, status: 200 });
  const dbState: {
    selectQueue: unknown[];
    insertReturn: unknown;
    insertCalls: unknown[];
  } = {
    selectQueue: [],
    insertReturn: null,
    insertCalls: [],
  };
  function chainSelect() {
    const resolveValue = () => dbState.selectQueue.shift() ?? [];
    const proxy: any = {
      from: () => proxy,
      where: () => proxy,
      leftJoin: () => proxy,
      innerJoin: () => proxy,
      orderBy: () => proxy,
      limit: () => proxy,
      groupBy: () => proxy,
      then: (onF: any, onR: any) =>
        Promise.resolve(resolveValue()).then(onF, onR),
    };
    return proxy;
  }
  return {
    triggerSpy,
    sendTicketCreatedEmailSpy,
    dbState,
    chainSelect,
  };
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

vi.mock("@/lib/email/templates/ticket-created", () => ({
  sendTicketCreatedEmail: harness.sendTicketCreatedEmailSpy,
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: () => harness.chainSelect(),
    insert: () => ({
      values: (vals: unknown) => {
        harness.dbState.insertCalls.push(vals);
        return {
          returning: () =>
            Promise.resolve(harness.dbState.insertReturn ?? []),
          then: (onF: any) => Promise.resolve(undefined).then(onF),
        };
      },
    }),
  },
}));

vi.mock("@/lib/db/schema", () => ({
  knowledgeBase: { topic: "topic" },
  chatEvents: {
    sessionId: "session_id",
    type: "type",
    actorUserId: "actor_user_id",
    metadata: "metadata",
    createdAt: "created_at",
  },
  customerContacts: {
    sessionId: "session_id",
    capturedAt: "captured_at",
    email: "email",
    name: "name",
    consent: "consent",
  },
  messages: {
    sessionId: "session_id",
    role: "role",
    sentiment: "sentiment",
    confidence: "confidence",
    sentAt: "sent_at",
    content: "content",
  },
  sessions: {
    id: "id",
    intent: "intent",
    resolved: "resolved",
    customerEmail: "customer_email",
    customerName: "customer_name",
    startedAt: "started_at",
  },
  tickets: { id: "id", sessionId: "session_id" },
}));

import { decideAutoTicket, runAutoTicket } from "@/lib/tickets/autoCreate";

describe("decideAutoTicket", () => {
  it("flags negative sentiment as urgent", () => {
    expect(
      decideAutoTicket({
        hasNegativeSentiment: true,
        hasAutoEscalated: false,
        hasLowConfidence: false,
        unresolvedByTagger: false,
      })
    ).toEqual({ shouldCreate: true, priority: "urgent" });
  });

  it("flags auto-escalated as high", () => {
    expect(
      decideAutoTicket({
        hasNegativeSentiment: false,
        hasAutoEscalated: true,
        hasLowConfidence: false,
        unresolvedByTagger: false,
      })
    ).toEqual({ shouldCreate: true, priority: "high" });
  });

  it("flags low-confidence as high", () => {
    expect(
      decideAutoTicket({
        hasNegativeSentiment: false,
        hasAutoEscalated: false,
        hasLowConfidence: true,
        unresolvedByTagger: true,
      })
    ).toEqual({ shouldCreate: true, priority: "high" });
  });

  it("falls through to normal when only the tagger says unresolved", () => {
    expect(
      decideAutoTicket({
        hasNegativeSentiment: false,
        hasAutoEscalated: false,
        hasLowConfidence: false,
        unresolvedByTagger: true,
      })
    ).toEqual({ shouldCreate: true, priority: "normal" });
  });

  it("creates nothing for a clean session", () => {
    expect(
      decideAutoTicket({
        hasNegativeSentiment: false,
        hasAutoEscalated: false,
        hasLowConfidence: false,
        unresolvedByTagger: false,
      })
    ).toEqual({ shouldCreate: false, priority: "normal" });
  });
});

describe("runAutoTicket", () => {
  beforeEach(() => {
    harness.dbState.selectQueue = [];
    harness.dbState.insertReturn = null;
    harness.dbState.insertCalls = [];
    harness.triggerSpy.mockClear();
    harness.sendTicketCreatedEmailSpy.mockClear();
    process.env.TICKET_AUTO_CREATE_TEST_MODE = "1";
  });

  it("returns null when autoTicketOnEscalation is disabled", async () => {
    harness.dbState.selectQueue = [
      [{ content: JSON.stringify({ autoTicketOnEscalation: false }) }],
    ];
    const result = await runAutoTicket("s-1");
    expect(result).toBeNull();
    expect(harness.dbState.insertCalls.length).toBe(0);
  });

  it("dedupes when a ticket already exists for the session", async () => {
    harness.dbState.selectQueue = [
      [{ content: JSON.stringify({}) }],
      [{ id: "t-existing" }],
    ];
    const result = await runAutoTicket("s-1");
    expect(result).toBeNull();
    expect(harness.dbState.insertCalls.length).toBe(0);
  });

  it("creates an urgent ticket when the test marker word 'frustrated' is present", async () => {
    harness.dbState.selectQueue = [
      [{ content: JSON.stringify({}) }],
      [],
      [
        {
          id: "s-1",
          intent: "complaint",
          resolved: false,
          customerEmail: null,
          customerName: null,
          startedAt: new Date(),
        },
      ],
      [{ content: "I am extremely frustrated with this order" }],
      [{ content: "I am extremely frustrated with this order" }],
      [],
      [{ email: null, name: null }],
    ];
    harness.dbState.insertReturn = [
      {
        id: "t-1",
        ticketNumber: 42,
        sessionId: "s-1",
        subject: "I am extremely frustrated with this order",
        status: "open",
        priority: "urgent",
        category: "complaint",
        source: "auto",
        customerEmail: null,
        customerName: null,
        slaBreached: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    const ticket = await runAutoTicket("s-1");
    expect(ticket).not.toBeNull();
    expect(ticket?.priority).toBe("urgent");
    expect(harness.triggerSpy).toHaveBeenCalled();
    expect(harness.sendTicketCreatedEmailSpy).not.toHaveBeenCalled();
  });

  it("skips creation when nothing in the test-mode transcript flags it", async () => {
    harness.dbState.selectQueue = [
      [{ content: JSON.stringify({}) }],
      [],
      [
        {
          id: "s-1",
          intent: "order_status",
          resolved: true,
          customerEmail: null,
          customerName: null,
          startedAt: new Date(),
        },
      ],
      [{ content: "thanks!" }],
    ];
    const ticket = await runAutoTicket("s-1");
    expect(ticket).toBeNull();
    expect(harness.dbState.insertCalls.length).toBe(0);
  });
});
