import { describe, it, expect } from "vitest";
import { AI_BEHAVIOR_RULES } from "../rules";

describe("no_hallucinate_products rule", () => {
  it("exists in AI_BEHAVIOR_RULES", () => {
    const ids = AI_BEHAVIOR_RULES.map((r) => r.id);
    expect(ids).toContain("no_hallucinate_products");
  });

  it("all three no_hallucinate_* rules are present", () => {
    const ids = AI_BEHAVIOR_RULES.map((r) => r.id);
    expect(ids).toContain("no_hallucinate_contact");
    expect(ids).toContain("no_hallucinate_features");
    expect(ids).toContain("no_hallucinate_products");
  });

  it("no_hallucinate_products sits within 2 positions of the other no_hallucinate_* rules", () => {
    const ids = AI_BEHAVIOR_RULES.map((r) => r.id);
    const idxProducts = ids.indexOf("no_hallucinate_products");
    const idxContact = ids.indexOf("no_hallucinate_contact");
    const idxFeatures = ids.indexOf("no_hallucinate_features");

    expect(Math.abs(idxProducts - idxContact)).toBeLessThanOrEqual(2);
    expect(Math.abs(idxProducts - idxFeatures)).toBeLessThanOrEqual(2);
  });

  it("rule text references the catalog as the authoritative source", () => {
    const rule = AI_BEHAVIOR_RULES.find((r) => r.id === "no_hallucinate_products");
    expect(rule).toBeDefined();
    expect(rule!.rule).toContain("Performance Cycle's catalog");
    expect(rule!.rule).toContain("training data");
  });

  it("rule text explicitly forbids fabricating product names", () => {
    const rule = AI_BEHAVIOR_RULES.find((r) => r.id === "no_hallucinate_products");
    expect(rule).toBeDefined();
    expect(rule!.rule).toContain("NEVER fabricate");
  });

  it("rule text requires products to appear verbatim in prompt sections", () => {
    const rule = AI_BEHAVIOR_RULES.find((r) => r.id === "no_hallucinate_products");
    expect(rule).toBeDefined();
    expect(rule!.rule).toContain("verbatim");
    expect(rule!.rule).toContain("RELEVANT PRODUCTS");
  });

  it("rule text covers cross-category model number reuse", () => {
    const rule = AI_BEHAVIOR_RULES.find((r) => r.id === "no_hallucinate_products");
    expect(rule).toBeDefined();
    expect(rule!.rule).toContain("NEVER combine model numbers across product categories");
  });
});

describe("tech_air_service_routing rule", () => {
  it("tech_air_service_routing rule links to the PC service page", () => {
    const rule = AI_BEHAVIOR_RULES.find((r) => r.id === "tech_air_service_routing");
    expect(rule).toBeDefined();
    expect(rule!.rule).toContain("https://performancecycle.com/tech-air-service/");
  });
});

describe("catalog_confirms_availability rule", () => {
  it("exists in AI_BEHAVIOR_RULES", () => {
    const ids = AI_BEHAVIOR_RULES.map((r) => r.id);
    expect(ids).toContain("catalog_confirms_availability");
  });

  it("forbids telling customer to call 303-744-2011 for shopping queries", () => {
    const rule = AI_BEHAVIOR_RULES.find((r) => r.id === "catalog_confirms_availability");
    expect(rule).toBeDefined();
    expect(rule!.rule).toContain("NEVER tell the customer to call 303-744-2011");
  });

  it("rule text opens with affirmation, not search-miss framing", () => {
    const rule = AI_BEHAVIOR_RULES.find((r) => r.id === "catalog_confirms_availability");
    expect(rule).toBeDefined();
    expect(rule!.rule).toContain("OPEN by AFFIRMING availability");
  });

  it("no_call_store rule covers STORE CATALOG shopping queries", () => {
    const rule = AI_BEHAVIOR_RULES.find((r) => r.id === "no_call_store");
    expect(rule).toBeDefined();
    expect(rule!.rule).toContain(
      "SHOPPING questions about a brand/category combo confirmed by STORE CATALOG"
    );
  });
});
