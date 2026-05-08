/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

const harness = vi.hoisted(() => ({
  dbState: { executeQueue: [] as unknown[] },
}));

vi.mock("@/lib/log", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  serializeError: () => ({}),
}));

vi.mock("@/lib/db", () => ({
  db: {
    execute: vi.fn(async () => harness.dbState.executeQueue.shift() ?? []),
  },
}));

const mockGetServerSession = vi.fn();
vi.mock("next-auth", () => ({
  getServerSession: mockGetServerSession,
}));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));

describe("GET /api/admin/tickets/stats", () => {
  beforeEach(() => {
    harness.dbState.executeQueue = [];
    mockGetServerSession.mockReset();
  });

  it("403s for non-managers", async () => {
    mockGetServerSession.mockResolvedValue({
      user: { id: "u-1", role: "support_agent", name: "Alex", email: "a@x" },
    });
    const { GET } = await import("@/app/api/admin/tickets/stats/route");
    const { NextRequest } = await import("next/server");
    const req = new NextRequest("http://localhost/api/admin/tickets/stats");
    const res = await GET(req);
    expect(res.status).toBe(403);
  });

  it("returns the documented shape with computed aggregates", async () => {
    mockGetServerSession.mockResolvedValue({
      user: {
        id: "u-1",
        role: "store_manager",
        name: "Manager",
        email: "m@x",
      },
    });
    harness.dbState.executeQueue = [
      // summary
      [
        {
          open_count: 3,
          total_in_window: 10,
          breached_in_window: 2,
          resolved_in_window: 5,
          avg_resolution_seconds: 7200,
        },
      ],
      // byCategory
      [
        { category: "order_status", count: 4 },
        { category: null, count: 1 },
      ],
      // byAgent
      [
        {
          agent_id: "u-1",
          name: "Alex",
          open_count: 2,
          resolved_count: 3,
          breached_count: 1,
          avg_resolution_seconds: 3600,
        },
      ],
      // sparkline
      [
        { d: "2026-05-01", open_count: 3 },
        { d: "2026-05-02", open_count: 4 },
      ],
    ];
    const { GET } = await import("@/app/api/admin/tickets/stats/route");
    const { NextRequest } = await import("next/server");
    const req = new NextRequest(
      "http://localhost/api/admin/tickets/stats?days=14"
    );
    const res = await GET(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.days).toBe(14);
    expect(data.openCount).toBe(3);
    expect(data.totalInWindow).toBe(10);
    expect(data.breachedInWindow).toBe(2);
    expect(data.resolvedInWindow).toBe(5);
    expect(data.breachRatePct).toBe(20);
    expect(data.avgResolutionHours).toBe(2);
    expect(data.byCategory).toEqual([
      { category: "order_status", count: 4 },
      { category: "uncategorized", count: 1 },
    ]);
    expect(data.byAgent[0]).toEqual(
      expect.objectContaining({
        agentId: "u-1",
        name: "Alex",
        openCount: 2,
        resolvedCount: 3,
        breachedCount: 1,
        avgResolutionHours: 1,
      })
    );
    expect(data.sparkline).toEqual([
      { date: "2026-05-01", openCount: 3 },
      { date: "2026-05-02", openCount: 4 },
    ]);
  });
});
