/**
 * Regression tests for lib/catalog/classify.ts.
 *
 * The authoritative signal is always the BC category name, never the product
 * name.  Bug C (Cardo / SENA comm products classified as helmets) is the
 * primary regression guarded here.
 */

import { describe, it, expect } from "vitest";
import {
  classifyBroadCategory,
  classifyBroadSubcategory,
} from "../classify";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function product(
  name: string,
  categories: string[],
  brand?: string
) {
  return { name, categories, brand };
}

// ---------------------------------------------------------------------------
// classifyBroadCategory
// ---------------------------------------------------------------------------

describe("classifyBroadCategory", () => {
  it("Bug_C: Cardo Freecom 2nd Helmet Audio Kit → comm not helmet", () => {
    // The word "Helmet" appears in the product name — name-based matching
    // was the root cause of Bug C.  Category wins.
    const result = classifyBroadCategory(
      product(
        "Cardo Freecom 2nd Helmet Audio Kit",
        ["Street", "Cardo", "Electronics", "Cardo Speakers", "Comm Systems"]
      )
    );
    expect(result).toBe("comm");
  });

  it("Sena 30K HD Communication System → comm", () => {
    const result = classifyBroadCategory(
      product(
        "Sena 30K HD Communication System",
        ["Street", "Electronics", "Sena", "Comm Systems"]
      )
    );
    expect(result).toBe("comm");
  });

  it("Alpinestars Supertech SM-10 Solid Helmet → helmet", () => {
    const result = classifyBroadCategory(
      product(
        "Alpinestars Supertech SM-10 Solid Helmet",
        ["Moto", "MX Helmets", "Helmets"]
      )
    );
    expect(result).toBe("helmet");
  });

  it("EBC Brake Pads → brake", () => {
    const result = classifyBroadCategory(
      product("EBC HH Sintered Brake Pads", ["Street", "Brakes", "Brake Pads/Brake Shoes"])
    );
    expect(result).toBe("brake");
  });

  it("Renthal sprocket → sprocket", () => {
    const result = classifyBroadCategory(
      product("Renthal 428 Front Sprocket", ["MX", "Drive", "Sprockets"])
    );
    expect(result).toBe("sprocket");
  });

  it("Motorex chain lube → chemical (NOT chain)", () => {
    const result = classifyBroadCategory(
      product("Motorex Chain Lube 622 Road", ["Maintenance", "Lubes", "Chain Lube"])
    );
    expect(result).toBe("chemical");
  });

  it("Klim heated jacket → heated (NOT jacket — heated takes precedence)", () => {
    const result = classifyBroadCategory(
      product("Klim Resistance Heated Jacket", ["Heated Gear", "Jackets"])
    );
    expect(result).toBe("heated");
  });

  it("T-shirt with no riding-gear ancestor → casual", () => {
    const result = classifyBroadCategory(
      product("Brand Logo T-Shirt", ["Casual", "T-Shirts", "Apparel"])
    );
    expect(result).toBe("casual");
  });

  // ---------------------------------------------------------------------------
  // Additional coverage
  // ---------------------------------------------------------------------------

  it("Electronics alone (without Comm Systems) → comm", () => {
    expect(
      classifyBroadCategory(product("Bluetooth Device", ["Electronics"]))
    ).toBe("comm");
  });

  it("Chain Lube before Chains — order guard", () => {
    // Has both Chain Lube and Chains; Chain Lube must win
    expect(
      classifyBroadCategory(
        product("Lube", ["Chains", "Chain Lube"])
      )
    ).toBe("chemical");
  });

  it("Chain → chain", () => {
    expect(
      classifyBroadCategory(product("DID 520 Chain", ["Drive", "Chains"]))
    ).toBe("chain");
  });

  it("Casual inside Riding Gear → not casual (falls through)", () => {
    // Should NOT be casual because Jackets is present (riding-gear root)
    const result = classifyBroadCategory(
      product("Casual Riding Tee", ["Casual", "Jackets", "Riding Gear"])
    );
    expect(result).not.toBe("casual");
  });

  it("E-bike by brand → e_bike", () => {
    expect(
      classifyBroadCategory(
        product("BRLN Balance Bike", ["Kids", "Balance Bikes"], "Stacyc")
      )
    ).toBe("e_bike");
  });

  it("Parts catch-all → parts", () => {
    expect(
      classifyBroadCategory(product("Mystery Widget", ["Parts"]))
    ).toBe("parts");
  });

  it("Accessories catch-all → accessory", () => {
    expect(
      classifyBroadCategory(product("Mystery Widget", ["Accessories"]))
    ).toBe("accessory");
  });

  it("No matching category → other", () => {
    expect(
      classifyBroadCategory(product("Unknown Thing", ["Whatever"]))
    ).toBe("other");
  });
});

// ---------------------------------------------------------------------------
// classifyBroadSubcategory
// ---------------------------------------------------------------------------

describe("classifyBroadSubcategory", () => {
  it("Alpinestars Supertech SM-10 → helmet, subcategory mx", () => {
    const p = product("Alpinestars Supertech SM-10 Solid MX Helmet", ["Moto", "MX Helmets", "Helmets"]);
    const sub = classifyBroadSubcategory(p, "helmet");
    expect(sub).toBe("mx");
  });

  it("comm: freecom audio kit → intercom subcategory (freecom keyword wins over audio)", () => {
    // "Freecom" appears in the intercom keyword list, so intercom fires first
    // even though the name also contains "Audio".
    const p = product("Cardo Freecom 2nd Helmet Audio Kit", ["Comm Systems"]);
    expect(classifyBroadSubcategory(p, "comm")).toBe("intercom");
  });

  it("comm: speaker-only product → audio subcategory", () => {
    const p = product("Cardo Speaker Kit", ["Comm Systems"]);
    expect(classifyBroadSubcategory(p, "comm")).toBe("audio");
  });

  it("comm: packtalk → intercom subcategory", () => {
    const p = product("Cardo PackTalk Bold Duo", ["Comm Systems"]);
    expect(classifyBroadSubcategory(p, "comm")).toBe("intercom");
  });

  it("comm: general fallback", () => {
    const p = product("Sena SMH5 Bluetooth", ["Comm Systems"]);
    expect(classifyBroadSubcategory(p, "comm")).toBe("general");
  });

  it("pack: tank bag", () => {
    const p = product("Kriega OS-6 Tank Bag", ["Luggage"]);
    expect(classifyBroadSubcategory(p, "pack")).toBe("tank");
  });

  it("pack: saddle bag", () => {
    const p = product("Nelson-Rigg Saddlebag Set", ["Saddlebags"]);
    expect(classifyBroadSubcategory(p, "pack")).toBe("saddle");
  });

  it("protection: knee", () => {
    const p = product("Alpinestars Knee Brace", ["Knee Braces"]);
    expect(classifyBroadSubcategory(p, "protection")).toBe("knee");
  });

  it("non-delegated type → general", () => {
    expect(classifyBroadSubcategory(product("EBC Brake Pads", []), "brake")).toBe("general");
    expect(classifyBroadSubcategory(product("Renthal Sprocket", []), "sprocket")).toBe("general");
    expect(classifyBroadSubcategory(product("Motorex Chain Lube", []), "chemical")).toBe("general");
  });
});
