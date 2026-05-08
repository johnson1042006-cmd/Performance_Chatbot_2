import { describe, it, expect } from "vitest";
import { tireCatalogUrlForRidingType } from "../tireCatalog";

describe("tireCatalogUrlForRidingType", () => {
  it("maps street to sportbike url", () => {
    expect(tireCatalogUrlForRidingType("Street")).toBe(
      "https://performancecycle.com/tires/sportbike/"
    );
  });

  it("maps adventure to adventure url", () => {
    expect(tireCatalogUrlForRidingType("Adventure")).toBe(
      "https://performancecycle.com/tires/adventure/"
    );
  });

  it("maps dual sport to dual sport url", () => {
    expect(tireCatalogUrlForRidingType("Dual sport")).toBe(
      "https://performancecycle.com/dual-sport/"
    );
  });
});

