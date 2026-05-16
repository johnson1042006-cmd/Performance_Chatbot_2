import { describe, it, expect } from "vitest";

// ---------------------------------------------------------------------------
// AlertsConfig — KINDS array (Part 2 cleanup)
// ---------------------------------------------------------------------------

import { KINDS } from "../alertKinds";

// ---------------------------------------------------------------------------
// AlertsBell — FRIENDLY map (Part 2 cleanup)
// ---------------------------------------------------------------------------

import { FRIENDLY } from "../../alertFriendlyNames";

describe("AlertsConfig KINDS", () => {
  it("does not include ticket_sla_breach", () => {
    expect(KINDS.some((k) => k.value === "ticket_sla_breach")).toBe(false);
  });

  it("still contains the three active kinds", () => {
    const values = KINDS.map((k) => k.value);
    expect(values).toContain("queue_depth");
    expect(values).toContain("ai_failure_rate_pct");
    expect(values).toContain("no_agents_online_during_hours");
  });

  it("matches snapshot", () => {
    expect(KINDS).toMatchSnapshot();
  });
});

describe("AlertsBell FRIENDLY", () => {
  it("does not include ticket_sla_breach", () => {
    expect("ticket_sla_breach" in FRIENDLY).toBe(false);
  });

  it("still maps the three active kinds", () => {
    expect(FRIENDLY["queue_depth"]).toBeDefined();
    expect(FRIENDLY["ai_failure_rate_pct"]).toBeDefined();
    expect(FRIENDLY["no_agents_online_during_hours"]).toBeDefined();
  });
});
