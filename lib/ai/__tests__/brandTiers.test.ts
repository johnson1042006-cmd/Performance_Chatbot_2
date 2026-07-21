/**
 * Phase A5 brand-tier lookup. Pure functions — no mocking needed.
 */
import { describe, it, expect } from "vitest";
import { brandTierOf, PREMIUM_BRANDS, BUDGET_BRANDS } from "../brandTiers";
import { AI_BEHAVIOR_RULES } from "../rules";

describe("brandTierOf", () => {
  it("classifies premium brands from real catalog-style names", () => {
    expect(brandTierOf("Shoei RF-1400 Helmet")).toBe("premium");
    expect(brandTierOf("Michelin Road 6 Sport Touring Tires")).toBe("premium");
    expect(brandTierOf("2023 Klim Marrakesh Jacket")).toBe("premium");
    expect(brandTierOf("Bell MX-9 Adventure MIPS Helmet")).toBe("premium");
    expect(brandTierOf("REV'IT! Sand 4 H2O Jacket")).toBe("premium");
  });

  it("classifies budget brands", () => {
    expect(brandTierOf("Bilt Techno 3.0 Jacket")).toBe("budget");
    expect(brandTierOf("Fly Racing Kinetic Helmet")).toBe("budget");
    expect(brandTierOf("Highway 21 Gunner Vest")).toBe("budget");
    expect(brandTierOf("Z1R Range Helmet")).toBe("budget");
  });

  it("returns other for mid-range/unknown brands", () => {
    expect(brandTierOf("HJC i10 Helmet")).toBe("other");
    expect(brandTierOf("Sedici Strada 3 Helmet")).toBe("other");
    expect(brandTierOf("Icon Airflite Helmet")).toBe("other");
  });

  it("requires word boundaries — no substring false positives", () => {
    expect(brandTierOf("Campbell Chain Lube")).toBe("other");
    expect(brandTierOf("Butterfly Kickstand Plate")).toBe("other");
  });

  it("handles null/empty input", () => {
    expect(brandTierOf(null)).toBe("other");
    expect(brandTierOf(undefined)).toBe("other");
    expect(brandTierOf("")).toBe("other");
  });

  it("stays in sync with the rules.ts brand_preference prose", () => {
    const rule = AI_BEHAVIOR_RULES.find(
      (r) => r.id === "brand_preference"
    ) ?? AI_BEHAVIOR_RULES.find((r) => r.rule.includes("premium brands"));
    expect(rule).toBeDefined();
    const prose = rule!.rule.toLowerCase();
    // Every single-word canonical brand in our lists must appear in the rule
    // prose (variant spellings like "revit"/"rev it"/"tour master" are
    // spelling aliases, not separate brands).
    const aliases = new Set(["revit", "rev it", "tour master", "fly racing"]);
    for (const b of [...PREMIUM_BRANDS, ...BUDGET_BRANDS]) {
      if (aliases.has(b)) continue;
      expect(prose, `brand "${b}" missing from brand_preference rule`).toContain(b);
    }
  });
});
