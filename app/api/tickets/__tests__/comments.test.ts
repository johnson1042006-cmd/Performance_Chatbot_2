/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

const harness = vi.hoisted(() => {
  const triggerSpy = vi.fn().mockResolvedValue(undefined);
  const dbState: {
    selectQueue: unknown[];
    insertReturn: unknown;
    updateCalls: unknown[];
    insertCalls: unknown[];
    executeQueue: unknown[];
  } = {
    selectQueue: [],
    insertReturn: null,
    updateCalls: [],
    insertCalls: [],
    executeQueue: [],
  };
  function chainSelect() {
    const proxy: any = {
      from: () => proxy,
      where: () => proxy,
      leftJoin: () => proxy,
      orderBy: () => proxy,
      limit: () => proxy,
      then: (onF: any, onR: any) =>
        Promise.resolve(dbState.selectQueue.shift() ?? []).then(onF, onR),
    };
    return proxy;
  }
  function chainUpdate() {
    const proxy: any = {
      set: (vals: unknown) => {
        dbState.updateCalls.push(vals);
        return proxy;
      },
      where: () => proxy,
      then: (onF: any) => Promise.resolve(undefined).then(onF),
    };
    return proxy;
  }
  return { triggerSpy, dbState, chainSelect, chainUpdate };
});

vi.mock("@/lib/log", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  serializeError: () => ({}),
}));

vi.mock("@/lib/pusher/server", () => ({
  getPusher: () => ({ trigger: harness.triggerSpy }),
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: () => harness.chainSelect(),
    update: () => harness.chainUpdate(),
    execute: vi.fn(async () => harness.dbState.executeQueue.shift() ?? []),
    insert: () => ({
      values: (vals: unknown) => {
        harness.dbState.insertCalls.push(vals);
        return {
          returning: () =>
            Promise.resolve(
              harness.dbState.insertReturn
                ? [harness.dbState.insertReturn]
                : []
            ),
        };
      },
    }),
  },
}));

vi.mock("@/lib/db/schema", () => ({
  ticketComments: {
    id: "id",
    ticketId: "ticket_id",
    authorId: "author_id",
    body: "body",
    isInternal: "is_internal",
    createdAt: "created_at",
  },
  tickets: {
    id: "id",
    firstResponseAt: "first_response_at",
    updatedAt: "updated_at",
  },
}));

const mockGetServerSession = vi.fn();
vi.mock("next-auth", () => ({
  getServerSession: mockGetServerSession,
}));
vi.mock("@/lib/auth", () => ({
  authOptions: {},
}));

describe("/api/tickets/[id]/comments POST", () => {
  beforeEach(() => {
    harness.dbState.selectQueue = [];
    harness.dbState.insertReturn = null;
    harness.dbState.updateCalls = [];
    harness.dbState.insertCalls = [];
    harness.triggerSpy.mockClear();
    mockGetServerSession.mockReset();
  });

  it("403s when neither agent nor manager", async () => {
    mockGetServerSession.mockResolvedValue({
      user: { id: "u-1", role: "customer", name: "X", email: "x@y" },
    });
    const { POST } = await import(
      "@/app/api/tickets/[id]/comments/route"
    );
    const { NextRequest } = await import("next/server");
    const req = new NextRequest("http://localhost/api/tickets/t-1/comments", {
      method: "POST",
      body: JSON.stringify({ body: "hi" }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: "t-1" }) });
    expect(res.status).toBe(403);
  });

  it("400s on empty body", async () => {
    mockGetServerSession.mockResolvedValue({
      user: { id: "u-1", role: "support_agent", name: "Alex", email: "a@x" },
    });
    const { POST } = await import(
      "@/app/api/tickets/[id]/comments/route"
    );
    const { NextRequest } = await import("next/server");
    const req = new NextRequest("http://localhost/api/tickets/t-1/comments", {
      method: "POST",
      body: JSON.stringify({ body: "  " }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: "t-1" }) });
    expect(res.status).toBe(400);
  });

  it("stamps first_response_at on the first non-internal staff comment", async () => {
    mockGetServerSession.mockResolvedValue({
      user: { id: "u-1", role: "support_agent", name: "Alex", email: "a@x" },
    });
    harness.dbState.selectQueue = [[{ id: "t-1", firstResponseAt: null }]];
    harness.dbState.insertReturn = {
      id: "c-1",
      ticketId: "t-1",
      authorId: "u-1",
      body: "Looking into it",
      isInternal: false,
      createdAt: new Date(),
    };

    const { POST } = await import(
      "@/app/api/tickets/[id]/comments/route"
    );
    const { NextRequest } = await import("next/server");
    const req = new NextRequest("http://localhost/api/tickets/t-1/comments", {
      method: "POST",
      body: JSON.stringify({ body: "Looking into it" }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: "t-1" }) });
    expect(res.status).toBe(201);
    expect(harness.dbState.updateCalls.length).toBe(1);
    const setVals = harness.dbState.updateCalls[0] as Record<string, unknown>;
    expect(setVals.firstResponseAt).toBeDefined();
  });

  it("does NOT stamp first_response_at when the comment is internal", async () => {
    mockGetServerSession.mockResolvedValue({
      user: { id: "u-1", role: "support_agent", name: "Alex", email: "a@x" },
    });
    harness.dbState.selectQueue = [[{ id: "t-1", firstResponseAt: null }]];
    harness.dbState.insertReturn = {
      id: "c-1",
      ticketId: "t-1",
      authorId: "u-1",
      body: "internal note",
      isInternal: true,
      createdAt: new Date(),
    };
    const { POST } = await import(
      "@/app/api/tickets/[id]/comments/route"
    );
    const { NextRequest } = await import("next/server");
    const req = new NextRequest("http://localhost/api/tickets/t-1/comments", {
      method: "POST",
      body: JSON.stringify({ body: "internal note", isInternal: true }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: "t-1" }) });
    expect(res.status).toBe(201);
    expect(harness.dbState.updateCalls.length).toBe(0);
  });
});
