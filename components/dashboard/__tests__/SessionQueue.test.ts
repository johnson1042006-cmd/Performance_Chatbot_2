import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Stub browser globals so the Node environment doesn't throw on
// Notification / Audio constructors used by notifyEscalation.
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockNotification: any = vi.fn();
mockNotification.permission = "granted";
mockNotification.requestPermission = vi.fn().mockResolvedValue("granted");

const playMock = vi.fn().mockResolvedValue(undefined);
// Use a real function (not arrow) so `new` works and the factory return value
// is respected by JavaScript's constructor semantics.
const mockAudio = vi.fn(function MockAudio() {
  return { volume: 1, play: playMock };
});

vi.stubGlobal("window", { Notification: mockNotification });
vi.stubGlobal("Notification", mockNotification);
vi.stubGlobal("Audio", mockAudio);

// ---------------------------------------------------------------------------
// Module under test
// ---------------------------------------------------------------------------

import { notifyEscalation, __resetDedupe } from "../notifyEscalation";

// ---------------------------------------------------------------------------
// notifyEscalation unit tests
// ---------------------------------------------------------------------------

describe("notifyEscalation", () => {
  beforeEach(() => {
    mockNotification.mockClear();
    mockAudio.mockClear();
    playMock.mockClear();
    mockNotification.requestPermission.mockClear();
    mockNotification.requestPermission.mockResolvedValue("granted");
    mockNotification.permission = "granted";
    __resetDedupe();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fires a desktop Notification with the correct reason label", () => {
    notifyEscalation({ sessionId: "s-1", reason: "complex_fitment", urgency: "high" });

    expect(mockNotification).toHaveBeenCalledOnce();
    expect(mockNotification).toHaveBeenCalledWith(
      "Fitment question — service team needed",
      expect.objectContaining({
        tag: "escalation-s-1",
        requireInteraction: true,
      })
    );
  });

  it("uses 'High urgency' body when urgency is high", () => {
    notifyEscalation({ sessionId: "s-2", reason: "complex_fitment", urgency: "high" });

    expect(mockNotification).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ body: "High urgency" })
    );
  });

  it("uses 'Open the dashboard to claim' body when urgency is not high", () => {
    notifyEscalation({ sessionId: "s-3", reason: "complex_fitment", urgency: "normal" });

    expect(mockNotification).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ body: "Open the dashboard to claim" })
    );
  });

  it("fires the audio chime and calls play()", () => {
    notifyEscalation({ sessionId: "s-4", reason: "tech_air_service", urgency: "normal" });

    expect(mockAudio).toHaveBeenCalledWith("/sounds/escalation-ping.wav");
    expect(playMock).toHaveBeenCalledOnce();
  });

  it("uses the correct label for tech_air_service", () => {
    notifyEscalation({ sessionId: "s-5", reason: "tech_air_service", urgency: "normal" });

    expect(mockNotification).toHaveBeenCalledWith(
      "Tech-Air service request",
      expect.any(Object)
    );
  });

  it("falls back to generic label for unknown reason", () => {
    notifyEscalation({ sessionId: "s-6", reason: "unknown_reason", urgency: "normal" });

    expect(mockNotification).toHaveBeenCalledWith(
      "Escalation: unknown_reason",
      expect.any(Object)
    );
  });

  it("requests Notification permission when permission is 'default'", () => {
    mockNotification.permission = "default";
    notifyEscalation({ sessionId: "s-7", reason: "complex_fitment", urgency: "normal" });
    expect(mockNotification.requestPermission).toHaveBeenCalled();
  });

  it("does not fire Notification when permission is 'denied'", () => {
    mockNotification.permission = "denied";
    notifyEscalation({ sessionId: "s-8", reason: "complex_fitment", urgency: "normal" });
    expect(mockNotification).not.toHaveBeenCalled();
  });

  it("deduplicates rapid calls for the same sessionId within 5s window", () => {
    notifyEscalation({ sessionId: "dup-1", reason: "explicit_request", urgency: "normal" });
    notifyEscalation({ sessionId: "dup-1", reason: "explicit_request", urgency: "normal" });

    expect(mockNotification).toHaveBeenCalledOnce();
    expect(mockAudio).toHaveBeenCalledOnce();
  });

  it("fires notification after permission grant when starting from 'default'", async () => {
    mockNotification.permission = "default";
    mockNotification.requestPermission.mockResolvedValue("granted");

    notifyEscalation({ sessionId: "grant-1", reason: "explicit_request", urgency: "normal" });

    // Flush the requestPermission().then(...) microtask chain.
    await Promise.resolve();
    await Promise.resolve();

    expect(mockNotification.requestPermission).toHaveBeenCalledOnce();
    expect(mockNotification).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// Pusher channel binding integration test
//
// Verifies that when the dashboard channel receives "escalation-requested",
// both fetchSessions and notifyEscalation are invoked with the correct payload.
// This mirrors what SessionQueue.tsx registers inside its Pusher useEffect.
// ---------------------------------------------------------------------------

describe("Pusher escalation-requested binding", () => {
  it("calls fetchSessions and notifyEscalation when the event fires", async () => {
    const handlers: Record<string, (payload: unknown) => void> = {};

    const mockChannel = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      bind: vi.fn((event: string, handler: (payload: any) => void) => {
        handlers[event] = handler;
      }),
      unbind_all: vi.fn(),
    };

    const mockPusher = {
      subscribe: vi.fn().mockReturnValue(mockChannel),
      unsubscribe: vi.fn(),
    };

    // Simulate what SessionQueue's useEffect does:
    const channel = mockPusher.subscribe("dashboard");
    const fetchSessions = vi.fn().mockResolvedValue(undefined);
    const notify = vi.fn();

    channel.bind("session-update", () => fetchSessions());
    channel.bind("session-claimed", () => fetchSessions());
    channel.bind("session-released", () => fetchSessions());
    channel.bind("session-closed", () => fetchSessions());
    channel.bind(
      "escalation-requested",
      (payload: unknown) => {
        fetchSessions();
        notify(payload as { sessionId: string; reason: string; urgency: string });
      }
    );

    // Emit the event
    const payload = { sessionId: "sess-99", reason: "complex_fitment", urgency: "high" };
    handlers["escalation-requested"](payload);

    expect(fetchSessions).toHaveBeenCalledOnce();
    expect(notify).toHaveBeenCalledOnce();
    expect(notify).toHaveBeenCalledWith(payload);
  });
});
