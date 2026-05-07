import { describe, it, expect } from "vitest";
import { resolveSessionState } from "../sessionState";

describe("resolveSessionState", () => {
  it("transitions idle → active_ai on an AI message", () => {
    expect(resolveSessionState("idle", "ai")).toBe("active_ai");
  });

  it("transitions waiting → active_ai on an AI message (Bug D path)", () => {
    expect(resolveSessionState("waiting", "ai")).toBe("active_ai");
  });

  it("transitions active_human → active_ai on an AI message (R5 re-claim path)", () => {
    expect(resolveSessionState("active_human", "ai")).toBe("active_ai");
  });

  it("leaves active_ai unchanged on a subsequent AI message", () => {
    expect(resolveSessionState("active_ai", "ai")).toBe("active_ai");
  });

  it("transitions waiting → active_human when an agent message arrives", () => {
    expect(resolveSessionState("waiting", "agent")).toBe("active_human");
  });

  it("leaves active_human unchanged when an agent message arrives", () => {
    expect(resolveSessionState("active_human", "agent")).toBe("active_human");
  });
});
