/**
 * Regression guard for session-state constants.
 *
 * Ensures STALE_MINUTES stays at 10 so the stale sweep never again
 * closes sessions while customers are naturally browsing linked products
 * between chat messages.
 */

import { describe, it, expect } from "vitest";
import { STALE_MINUTES } from "../state";

describe("STALE_MINUTES", () => {
  it("is 10 — wide enough for customers to browse linked products and return", () => {
    expect(STALE_MINUTES).toBe(10);
  });
});
