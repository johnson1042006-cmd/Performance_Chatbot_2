import { describe, it, expect } from "vitest";
import { rewriteStoreHours, CANONICAL_STORE_HOURS } from "../storeHours";

describe("rewriteStoreHours", () => {
  it("rewrites the reported bug (wrong Saturday range) to canonical", () => {
    expect(rewriteStoreHours("Saturday 9 AM–5 PM")).toBe(CANONICAL_STORE_HOURS);
  });

  it("rewrites bare ranges, day ranges, and closed-day statements", () => {
    expect(rewriteStoreHours("We're open Sat 9–5")).toBe(CANONICAL_STORE_HOURS);
    expect(rewriteStoreHours("Hours are Sat–Fri 9 to 6")).toBe(CANONICAL_STORE_HOURS);
    expect(rewriteStoreHours("We're closed Sundays")).toBe(CANONICAL_STORE_HOURS);
  });

  it("rewrites a no-weekday open span (rule 2)", () => {
    expect(rewriteStoreHours("We're open 9 AM to 6 PM")).toBe(CANONICAL_STORE_HOURS);
  });

  it("collapses a per-day bullet list into one canonical line", () => {
    const input = [
      "Here are our hours:",
      "- Monday: 9 AM–6 PM",
      "- Saturday: 9 AM–6 PM",
      "- Sunday: Closed",
    ].join("\n");
    expect(rewriteStoreHours(input)).toBe(
      "Here are our hours:\n" + CANONICAL_STORE_HOURS
    );
  });

  it("is idempotent on the canonical string", () => {
    expect(rewriteStoreHours(CANONICAL_STORE_HOURS)).toBe(CANONICAL_STORE_HOURS);
  });

  it("leaves legitimate non-hours time mentions untouched", () => {
    for (const s of [
      "That repair takes about 1 hour.",
      "Most orders ship in 2–3 days.",
      "Canister replacements ship back within 24-48 hours.",
      "Come watch the Saturday track day at 9 AM.",
      "Your order is open, placed at 9 AM.",
    ]) {
      expect(rewriteStoreHours(s)).toBe(s);
    }
  });

  it("does NOT rewrite holiday/date closure statements", () => {
    expect(rewriteStoreHours("We're closed Monday for the holiday")).toBe(
      "We're closed Monday for the holiday"
    );
    expect(rewriteStoreHours("Closed July 4th for Independence Day")).toBe(
      "Closed July 4th for Independence Day"
    );
  });
});
