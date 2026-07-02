/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Phase 2a AI-pause mechanism unit tests: pause-state derivation (including
 * the 45-minute lazy timeout), pause/clear persistence, and the
 * holding-ack dedupe (acknowledge once, then stay quiet).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Recording DB mock — captures .values()/.set() payloads so assertions can
// inspect exactly what would be written.
// ---------------------------------------------------------------------------

const insertedValues: any[] = [];
const setValues: any[] = [];
let selectQueue: any[][] = [];
let insertReturning: any[] = [];

vi.mock("@/lib/db", () => ({
  db: {
    insert: vi.fn(() => ({
      values: vi.fn((v: any) => {
        insertedValues.push(v);
        const result = insertReturning.length > 0 ? insertReturning : [];
        const p: any = Promise.resolve(result);
        p.returning = () => Promise.resolve(result);
        return p;
      }),
    })),
    update: vi.fn(() => ({
      set: vi.fn((v: any) => {
        setValues.push(v);
        return { where: () => Promise.resolve([]) };
      }),
    })),
    select: vi.fn(() => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: () => Promise.resolve(selectQueue.shift() ?? []),
          }),
        }),
      }),
    })),
  },
}));

vi.mock("@/lib/db/schema", () => ({
  sessions: { id: "id", aiPausedAt: "ai_paused_at", aiPauseReason: "ai_pause_reason" },
  chatEvents: { sessionId: "session_id", type: "type" },
  messages: { id: "id", sessionId: "session_id", role: "role", sentAt: "sent_at", content: "content" },
}));

const mockTrigger = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/pusher/server", () => ({
  getPusher: () => ({ trigger: mockTrigger }),
}));

vi.mock("@/lib/log", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  serializeError: (err: unknown) => ({ message: String(err) }),
}));

import {
  getAiPauseState,
  pauseAi,
  clearAiPause,
  persistHoldingAckIfNeeded,
  persistHandoffMessage,
  AI_PAUSE_TIMEOUT_MINUTES,
  PAUSED_HOLDING_ACK,
  HANDOFF_HUMAN_COMING,
  HANDOFF_AFTER_HOURS,
} from "../aiPause";

const SESSION_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

beforeEach(() => {
  vi.clearAllMocks();
  insertedValues.length = 0;
  setValues.length = 0;
  selectQueue = [];
  insertReturning = [];
});

describe("getAiPauseState", () => {
  const now = new Date("2026-07-02T12:00:00Z");

  it("returns none when aiPausedAt is null", () => {
    expect(getAiPauseState({ aiPausedAt: null }, now)).toBe("none");
  });

  it("returns active for a fresh pause", () => {
    const pausedAt = new Date(now.getTime() - 60_000); // 1 min ago
    expect(getAiPauseState({ aiPausedAt: pausedAt }, now)).toBe("active");
  });

  it("returns active just inside the timeout window", () => {
    const pausedAt = new Date(
      now.getTime() - (AI_PAUSE_TIMEOUT_MINUTES * 60_000 - 1000)
    );
    expect(getAiPauseState({ aiPausedAt: pausedAt }, now)).toBe("active");
  });

  it("returns expired once the timeout has elapsed", () => {
    const pausedAt = new Date(
      now.getTime() - (AI_PAUSE_TIMEOUT_MINUTES * 60_000 + 1000)
    );
    expect(getAiPauseState({ aiPausedAt: pausedAt }, now)).toBe("expired");
  });

  it("accepts string timestamps (raw DB rows)", () => {
    const pausedAt = new Date(now.getTime() - 60_000).toISOString();
    expect(getAiPauseState({ aiPausedAt: pausedAt }, now)).toBe("active");
  });
});

describe("pauseAi / clearAiPause", () => {
  it("pauseAi sets the pause columns and logs an ai_paused event", async () => {
    await pauseAi(SESSION_ID, "no_data");

    expect(setValues).toHaveLength(1);
    expect(setValues[0].aiPausedAt).toBeInstanceOf(Date);
    expect(setValues[0].aiPauseReason).toBe("no_data");

    const event = insertedValues.find((v) => v.type === "ai_paused");
    expect(event).toBeDefined();
    expect(event.metadata).toMatchObject({ reason: "no_data" });
  });

  it("clearAiPause nulls the columns and logs ai_pause_cleared with the cause", async () => {
    await clearAiPause(SESSION_ID, "timeout");

    expect(setValues[0]).toMatchObject({ aiPausedAt: null, aiPauseReason: null });
    const event = insertedValues.find((v) => v.type === "ai_pause_cleared");
    expect(event).toBeDefined();
    expect(event.metadata).toMatchObject({ clearedBy: "timeout" });
  });
});

describe("persistHoldingAckIfNeeded", () => {
  it("persists the ack and fans out Pusher when the last AI message differs", async () => {
    selectQueue.push([{ id: "m1", content: "Here are some helmets." }]);
    insertReturning = [
      { id: "m2", sessionId: SESSION_ID, role: "ai", content: PAUSED_HOLDING_ACK, sentAt: new Date() },
    ];

    const saved = await persistHoldingAckIfNeeded(SESSION_ID);

    expect(saved).not.toBeNull();
    expect(saved!.content).toBe(PAUSED_HOLDING_ACK);
    const msgInsert = insertedValues.find((v) => v.content === PAUSED_HOLDING_ACK);
    expect(msgInsert).toBeDefined();
    expect(mockTrigger).toHaveBeenCalledWith(
      expect.stringContaining(SESSION_ID),
      "new-message",
      expect.objectContaining({ content: PAUSED_HOLDING_ACK })
    );
  });

  it("stays quiet (returns null, no insert) when the ack was already the last AI message", async () => {
    selectQueue.push([{ id: "m2", content: PAUSED_HOLDING_ACK }]);

    const saved = await persistHoldingAckIfNeeded(SESSION_ID);

    expect(saved).toBeNull();
    expect(insertedValues).toHaveLength(0);
    expect(mockTrigger).not.toHaveBeenCalled();
  });
});

describe("persistHandoffMessage", () => {
  it("uses the human-coming copy when agents are online", async () => {
    insertReturning = [
      { id: "m3", sessionId: SESSION_ID, role: "ai", content: HANDOFF_HUMAN_COMING, sentAt: new Date() },
    ];
    await persistHandoffMessage(SESSION_ID, true);
    expect(insertedValues[0].content).toBe(HANDOFF_HUMAN_COMING);
  });

  it("uses the after-hours copy when no agents are online", async () => {
    insertReturning = [
      { id: "m4", sessionId: SESSION_ID, role: "ai", content: HANDOFF_AFTER_HOURS, sentAt: new Date() },
    ];
    await persistHandoffMessage(SESSION_ID, false);
    expect(insertedValues[0].content).toBe(HANDOFF_AFTER_HOURS);
  });
});
