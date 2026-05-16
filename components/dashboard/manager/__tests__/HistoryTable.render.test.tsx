// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import HistoryTable from "../HistoryTable";

function makeSession(overrides: Partial<{
  aiMessageCount: number;
  humanInvolved: boolean;
}> = {}) {
  return {
    id: "sess-1",
    customerIdentifier: "Customer #0001",
    pageContext: null,
    startedAt: new Date("2026-01-01T10:00:00Z").toISOString(),
    closedAt: new Date("2026-01-01T10:30:00Z").toISOString(),
    status: "closed",
    messageCount: 9,
    aiMessageCount: 5,
    humanInvolved: false,
    ...overrides,
  };
}

function mockFetch(session: ReturnType<typeof makeSession>) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      sessions: [session],
      total: 1,
      page: 1,
      totalPages: 1,
    }),
  } as unknown as Response);
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("HistoryTable — Handler badge rendering", () => {
  it("shows 'AI' badge when humanInvolved=false", async () => {
    mockFetch(makeSession({ aiMessageCount: 5, humanInvolved: false }));
    render(<HistoryTable />);
    await waitFor(() => expect(screen.getByText("AI")).toBeInTheDocument());
    expect(screen.queryByText("Mixed")).not.toBeInTheDocument();
    expect(screen.queryByText("Human")).not.toBeInTheDocument();
  });

  it("shows 'Mixed' badge when humanInvolved=true and aiMessageCount>0", async () => {
    mockFetch(makeSession({ aiMessageCount: 3, humanInvolved: true }));
    render(<HistoryTable />);
    await waitFor(() => expect(screen.getByText("Mixed")).toBeInTheDocument());
    expect(screen.queryByText("AI")).not.toBeInTheDocument();
    expect(screen.queryByText("Human")).not.toBeInTheDocument();
  });

  it("shows 'Human' badge when humanInvolved=true and aiMessageCount=0", async () => {
    mockFetch(makeSession({ aiMessageCount: 0, humanInvolved: true }));
    render(<HistoryTable />);
    await waitFor(() => expect(screen.getByText("Human")).toBeInTheDocument());
    expect(screen.queryByText("AI")).not.toBeInTheDocument();
    expect(screen.queryByText("Mixed")).not.toBeInTheDocument();
  });
});
