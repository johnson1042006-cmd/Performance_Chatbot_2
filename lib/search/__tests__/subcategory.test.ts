/**
 * Subcategory classification + intent detection tests.
 *
 * The classifier has two paths: BC-category-driven (preferred) and
 * text-driven (fallback). Tests here focus on the text fallback, the request
 * intent extractor, and the bias function — these are the deterministic
 * behaviors. The BC-category path is exercised end-to-end by the Playwright
 * suite where real category IDs are available.
 */

import { describe, it, expect } from "vitest";
import {
  classifyProductSubcategoryByText,
  extractSubcategoryRequest,
  biasBySubcategory,
  isSupportedProductType,
  STREET_DEFAULT,
  STREET_FALLBACK_PHRASE,
  type SubcategoryValue,
} from "../subcategory";
import { type BCProduct } from "@/lib/bigcommerce/client";

function fakeProduct(name: string, description = ""): BCProduct {
  return {
    id: 1,
    name,
    sku: "TEST",
    description,
    price: 100,
    sale_price: 0,
    retail_price: 0,
    calculated_price: 100,
    inventory_level: 5,
    inventory_tracking: "product",
    availability: "available",
    is_visible: true,
    categories: [],
    brand_id: 0,
    custom_url: { url: "/test/" },
    variants: [],
    images: [],
  };
}

// ---------------------------------------------------------------------------
// classifyProductSubcategoryByText (text fallback)
// ---------------------------------------------------------------------------

describe("classifyProductSubcategoryByText - helmets", () => {
  it("classifies open face helmets", () => {
    expect(
      classifyProductSubcategoryByText(
        fakeProduct("Bell Custom 500 Open Face Helmet"),
        "helmet"
      )
    ).toBe("open_face");
  });

  it("classifies modular helmets", () => {
    expect(
      classifyProductSubcategoryByText(
        fakeProduct("Schuberth C5 Modular Helmet"),
        "helmet"
      )
    ).toBe("modular");
  });

  it("classifies half helmets", () => {
    expect(
      classifyProductSubcategoryByText(
        fakeProduct("Daytona Skull Cap Half Helmet"),
        "helmet"
      )
    ).toBe("half");
  });

  it("classifies adventure helmets", () => {
    expect(
      classifyProductSubcategoryByText(
        fakeProduct("Klim Krios Pro Adventure Helmet"),
        "helmet"
      )
    ).toBe("adventure");
  });

  it("classifies MX helmets", () => {
    expect(
      classifyProductSubcategoryByText(
        fakeProduct("Fox V3 RS MX Helmet"),
        "helmet"
      )
    ).toBe("mx");
  });

  it("defaults ambiguous helmets to full_face (street default)", () => {
    expect(
      classifyProductSubcategoryByText(
        fakeProduct("Shoei RF-1400"),
        "helmet"
      )
    ).toBe("full_face");
  });

  it("classifies products with full face in name", () => {
    expect(
      classifyProductSubcategoryByText(
        fakeProduct("AGV K6 S Full Face Helmet"),
        "helmet"
      )
    ).toBe("full_face");
  });
});

describe("classifyProductSubcategoryByText - jackets", () => {
  it("classifies MX jerseys as mx", () => {
    expect(
      classifyProductSubcategoryByText(
        fakeProduct("Fox 360 MX Jersey"),
        "jacket"
      )
    ).toBe("mx");
  });

  it("classifies adventure jackets", () => {
    expect(
      classifyProductSubcategoryByText(
        fakeProduct("Klim Carlsbad ADV Jacket"),
        "jacket"
      )
    ).toBe("adventure");
  });

  it("classifies leather/cruiser jackets", () => {
    expect(
      classifyProductSubcategoryByText(
        fakeProduct("Roland Sands Ronin Leather Jacket"),
        "jacket"
      )
    ).toBe("cruiser");
  });

  it("defaults ambiguous jackets to street", () => {
    expect(
      classifyProductSubcategoryByText(
        fakeProduct("Alpinestars T-GP Plus R V3"),
        "jacket"
      )
    ).toBe("street");
  });
});

describe("classifyProductSubcategoryByText - boots/gloves/pants/tires", () => {
  it("classifies MX boots", () => {
    expect(
      classifyProductSubcategoryByText(
        fakeProduct("Alpinestars Tech 10 MX Boots"),
        "boots"
      )
    ).toBe("mx");
  });

  it("classifies winter gloves", () => {
    expect(
      classifyProductSubcategoryByText(
        fakeProduct("Klim Quantum Heated Winter Gloves"),
        "gloves"
      )
    ).toBe("winter");
  });

  it("classifies dirt tires", () => {
    expect(
      classifyProductSubcategoryByText(
        fakeProduct("Dunlop Geomax MX33 Dirt Tire"),
        "tire"
      )
    ).toBe("dirt");
  });

  it("classifies sport-touring tires", () => {
    expect(
      classifyProductSubcategoryByText(
        fakeProduct("Michelin Road 6 Sport Touring Tire"),
        "tire"
      )
    ).toBe("sport_touring");
  });

  it("defaults ambiguous tires to sport_touring (street default)", () => {
    expect(
      classifyProductSubcategoryByText(
        fakeProduct("Some Tire"),
        "tire"
      )
    ).toBe("sport_touring");
  });
});

// ---------------------------------------------------------------------------
// extractSubcategoryRequest
// ---------------------------------------------------------------------------

describe("extractSubcategoryRequest - explicit asks", () => {
  it("detects open face helmet request", () => {
    const r = extractSubcategoryRequest("show me open face helmets", "helmet");
    expect(r).toEqual({ explicit: true, value: "open_face" });
  });

  it("detects modular helmet request", () => {
    const r = extractSubcategoryRequest("modular helmets for touring", "helmet");
    expect(r).toEqual({ explicit: true, value: "modular" });
  });

  it("detects half helmet request", () => {
    const r = extractSubcategoryRequest("any half helmets", "helmet");
    expect(r).toEqual({ explicit: true, value: "half" });
  });

  it("detects MX helmet request", () => {
    const r = extractSubcategoryRequest("MX helmet under $500", "helmet");
    expect(r).toEqual({ explicit: true, value: "mx" });
  });

  it("detects adventure helmet request", () => {
    const r = extractSubcategoryRequest("adventure helmet recs", "helmet");
    expect(r).toEqual({ explicit: true, value: "adventure" });
  });

  it("detects full face explicit request", () => {
    const r = extractSubcategoryRequest("I want a full face helmet", "helmet");
    expect(r).toEqual({ explicit: true, value: "full_face" });
  });

  it("detects MX jersey request as mx jacket", () => {
    const r = extractSubcategoryRequest("MX jersey for my kid", "jacket");
    expect(r).toEqual({ explicit: true, value: "mx" });
  });

  it("detects winter gloves request", () => {
    const r = extractSubcategoryRequest("winter gloves please", "gloves");
    expect(r).toEqual({ explicit: true, value: "winter" });
  });
});

describe("extractSubcategoryRequest - ambiguous (returns null)", () => {
  it("returns null for plain helmet query", () => {
    expect(extractSubcategoryRequest("I need a helmet", "helmet")).toBeNull();
  });

  it("returns null for brand-only helmet query", () => {
    expect(extractSubcategoryRequest("Shoei helmets", "helmet")).toBeNull();
  });

  it("returns null for plain jacket query", () => {
    expect(extractSubcategoryRequest("I need a jacket", "jacket")).toBeNull();
  });

  it("returns null for plain gloves query", () => {
    expect(extractSubcategoryRequest("summer gloves", "gloves")).toBeNull();
  });

  it("returns null when productType is null", () => {
    expect(extractSubcategoryRequest("anything", null)).toBeNull();
  });
});

describe("extractSubcategoryRequest - any indicator", () => {
  it("returns any for 'show me all helmets'", () => {
    const r = extractSubcategoryRequest("show me all helmets", "helmet");
    expect(r).toEqual({ explicit: false, value: "any" });
  });

  it("returns any for 'every jacket you carry'", () => {
    const r = extractSubcategoryRequest("every jacket you carry", "jacket");
    expect(r).toEqual({ explicit: false, value: "any" });
  });
});

// ---------------------------------------------------------------------------
// biasBySubcategory
// ---------------------------------------------------------------------------

interface TaggedProduct {
  id: number;
  _subcategory?: SubcategoryValue | null;
}

describe("biasBySubcategory", () => {
  it("hard-filters when explicit subcategory requested", () => {
    const products: TaggedProduct[] = [
      { id: 1, _subcategory: "open_face" },
      { id: 2, _subcategory: "full_face" },
      { id: 3, _subcategory: "open_face" },
    ];
    const result = biasBySubcategory(products, "helmet", {
      explicit: true,
      value: "open_face",
    });
    expect(result.map((p) => p.id)).toEqual([1, 3]);
  });

  it("falls back to all products when explicit filter would yield zero", () => {
    const products: TaggedProduct[] = [
      { id: 1, _subcategory: "full_face" },
      { id: 2, _subcategory: "full_face" },
    ];
    const result = biasBySubcategory(products, "helmet", {
      explicit: true,
      value: "modular",
    });
    expect(result.map((p) => p.id)).toEqual([1, 2]);
  });

  it("promotes street default and demotes off-street when ambiguous", () => {
    const products: TaggedProduct[] = [
      { id: 1, _subcategory: "open_face" },
      { id: 2, _subcategory: "mx" },
      { id: 3, _subcategory: "full_face" },
      { id: 4, _subcategory: "modular" },
      { id: 5, _subcategory: "full_face" },
    ];
    const result = biasBySubcategory(products, "helmet", null);
    const ids = result.map((p) => p.id);
    expect(ids[0]).toBe(3);
    expect(ids[1]).toBe(5);
    expect(ids.slice(-3).sort()).toEqual([1, 2, 4]);
  });

  it("preserves order with 'any' request", () => {
    const products: TaggedProduct[] = [
      { id: 1, _subcategory: "open_face" },
      { id: 2, _subcategory: "full_face" },
      { id: 3, _subcategory: "modular" },
    ];
    const result = biasBySubcategory(products, "helmet", {
      explicit: false,
      value: "any",
    });
    expect(result.map((p) => p.id)).toEqual([1, 2, 3]);
  });

  it("handles empty product lists", () => {
    expect(biasBySubcategory([], "helmet", null)).toEqual([]);
  });

  it("biases jackets to street default", () => {
    const products: TaggedProduct[] = [
      { id: 1, _subcategory: "mx" },
      { id: 2, _subcategory: "street" },
      { id: 3, _subcategory: "adventure" },
      { id: 4, _subcategory: "street" },
    ];
    const result = biasBySubcategory(products, "jacket", null);
    expect(result.slice(0, 2).map((p) => p._subcategory)).toEqual([
      "street",
      "street",
    ]);
  });

  it("biases tires to sport_touring default", () => {
    const products: TaggedProduct[] = [
      { id: 1, _subcategory: "dirt" },
      { id: 2, _subcategory: "sport_touring" },
      { id: 3, _subcategory: "sport" },
    ];
    const result = biasBySubcategory(products, "tire", null);
    expect(result[0]._subcategory).toBe("sport_touring");
  });
});

// ---------------------------------------------------------------------------
// Type guards and constants
// ---------------------------------------------------------------------------

describe("isSupportedProductType", () => {
  it("returns true for supported types", () => {
    expect(isSupportedProductType("helmet")).toBe(true);
    expect(isSupportedProductType("jacket")).toBe(true);
    expect(isSupportedProductType("boots")).toBe(true);
    expect(isSupportedProductType("gloves")).toBe(true);
    expect(isSupportedProductType("pants")).toBe(true);
    expect(isSupportedProductType("tire")).toBe(true);
  });

  it("returns false for unsupported types", () => {
    expect(isSupportedProductType("vest")).toBe(false);
    expect(isSupportedProductType("airbag")).toBe(false);
    expect(isSupportedProductType("communication")).toBe(false);
    expect(isSupportedProductType(null)).toBe(false);
    expect(isSupportedProductType("unknown")).toBe(false);
  });
});

describe("STREET_DEFAULT and STREET_FALLBACK_PHRASE", () => {
  it("street defaults are sensible for a street motorcycle shop", () => {
    expect(STREET_DEFAULT.helmet).toBe("full_face");
    expect(STREET_DEFAULT.jacket).toBe("street");
    expect(STREET_DEFAULT.boots).toBe("street");
    expect(STREET_DEFAULT.gloves).toBe("street");
    expect(STREET_DEFAULT.pants).toBe("street");
    expect(STREET_DEFAULT.tire).toBe("sport_touring");
  });

  it("fallback phrases match street defaults", () => {
    expect(STREET_FALLBACK_PHRASE.helmet).toContain("full face");
    expect(STREET_FALLBACK_PHRASE.jacket).toContain("street");
    expect(STREET_FALLBACK_PHRASE.tire).toContain("sport touring");
  });
});
