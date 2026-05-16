import { describe, it, expect } from "vitest";

// ---------------------------------------------------------------------------
// BotSettings — Part 1 cleanup verification
// ---------------------------------------------------------------------------

import { DEFAULT_SETTINGS } from "../botSettingsDefaults";

describe("BotSettings DEFAULT_SETTINGS", () => {
  it("does not contain autoTicketOnEscalation", () => {
    expect("autoTicketOnEscalation" in DEFAULT_SETTINGS).toBe(false);
  });

  it("does not contain autoTicketEmailEnabled", () => {
    expect("autoTicketEmailEnabled" in DEFAULT_SETTINGS).toBe(false);
  });

  it("does not contain slaWindowsHours", () => {
    expect("slaWindowsHours" in DEFAULT_SETTINGS).toBe(false);
  });

  it("retains the expected five active fields", () => {
    const keys = Object.keys(DEFAULT_SETTINGS).sort();
    expect(keys).toEqual(
      [
        "aiEnabled",
        "autoOpenOnFirstVisit",
        "fallbackTimerSeconds",
        "historyRetentionMonths",
        "hotkeysEnabled",
      ].sort()
    );
  });
});
