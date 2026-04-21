import { describe, it, expect, vi, beforeEach } from "vitest";
import { extractKeywords, extractSKUFromText } from "../productSearch";
import {
  extractColorFromQuery,
  expandColorQuery,
  colorSynonymMap,
} from "../colorSynonyms";

// ---------------------------------------------------------------------------
// extractKeywords
// ---------------------------------------------------------------------------
describe("extractKeywords", () => {
  it("removes stop words", () => {
    const kw = extractKeywords("I am looking for a good helmet please");
    expect(kw).not.toContain("i");
    expect(kw).not.toContain("am");
    expect(kw).not.toContain("looking");
    expect(kw).not.toContain("for");
    expect(kw).not.toContain("good");
    expect(kw).toContain("helmet");
  });

  it("keeps pure numeric tokens", () => {
    const kw = extractKeywords("size 520 chain");
    expect(kw).toContain("520");
  });

  it("keeps compound number-symbol tokens (e.g. 80/100-21)", () => {
    const kw = extractKeywords("tube 80/100-21");
    expect(kw.some((w) => w.includes("80"))).toBe(true);
  });

  it("applies phrase synonyms (brain bucket -> helmet)", () => {
    const kw = extractKeywords("I want a brain bucket");
    expect(kw).toContain("helmet");
  });

  it("applies phrase synonyms (rain suit -> rain gear waterproof)", () => {
    const kw = extractKeywords("need a rain suit");
    expect(kw.join(" ")).toContain("rain");
    expect(kw.join(" ")).toContain("waterproof");
  });

  it("applies phrase synonyms (dirt bike -> dirtbike offroad mx)", () => {
    const kw = extractKeywords("dirt bike boots");
    expect(kw.some((w) => ["dirtbike", "offroad", "mx"].includes(w))).toBe(true);
  });

  it("applies phrase synonyms (exhaust system -> exhaust pipe muffler)", () => {
    const kw = extractKeywords("exhaust system for harley");
    expect(kw).toContain("exhaust");
    expect(kw.some((w) => ["pipe", "muffler"].includes(w))).toBe(true);
  });

  it("expands query synonyms (kid -> youth)", () => {
    const kw = extractKeywords("kid helmet");
    expect(kw).toContain("youth");
  });

  it("expands query synonyms (kids -> youth)", () => {
    const kw = extractKeywords("kids gloves");
    expect(kw).toContain("youth");
  });

  it("expands query synonyms (womens -> women)", () => {
    const kw = extractKeywords("womens jacket");
    expect(kw).toContain("women");
  });

  it("expands query synonyms (lid -> helmet)", () => {
    const kw = extractKeywords("lid for street riding");
    expect(kw).toContain("helmet");
  });

  it("expands query synonyms (pipe -> exhaust)", () => {
    const kw = extractKeywords("pipe for harley");
    expect(kw).toContain("exhaust");
  });

  it("expands query synonyms (revit -> rev'it)", () => {
    const kw = extractKeywords("revit jacket");
    expect(kw).toContain("rev'it");
  });

  it("expands query synonyms (visor -> shield)", () => {
    const kw = extractKeywords("visor for shoei");
    expect(kw).toContain("shield");
  });

  it("strips punctuation", () => {
    const kw = extractKeywords("what's the best helmet?!");
    expect(kw.every((w) => !/[?!.,;:'"()]/.test(w))).toBe(true);
  });

  it("filters single-character words (non-numeric)", () => {
    const kw = extractKeywords("a b c helmet");
    expect(kw).toEqual(["helmet"]);
  });

  it("returns empty for all-stop-word queries", () => {
    const kw = extractKeywords("I am looking for something");
    expect(kw.length).toBe(0);
  });

  it("handles empty string", () => {
    expect(extractKeywords("")).toEqual([]);
  });

  it("handles hi-vis phrase synonym", () => {
    const kw = extractKeywords("hi-vis vest");
    expect(kw.join(" ")).toContain("visibility");
  });

  it("preserves brand names like alpinestars", () => {
    const kw = extractKeywords("alpinestars gloves");
    expect(kw).toContain("alpinestars");
    expect(kw).toContain("gloves");
  });

  it("preserves product model identifiers", () => {
    const kw = extractKeywords("shoei rf-1400");
    expect(kw).toContain("shoei");
    expect(kw).toContain("rf-1400");
  });
});

// ---------------------------------------------------------------------------
// extractColorFromQuery
// ---------------------------------------------------------------------------
describe("extractColorFromQuery", () => {
  it("detects primary colors", () => {
    expect(extractColorFromQuery("black helmet")).toBe("black");
    expect(extractColorFromQuery("red jacket")).toBe("red");
    expect(extractColorFromQuery("blue boots")).toBe("blue");
    expect(extractColorFromQuery("white gloves")).toBe("white");
    expect(extractColorFromQuery("green jersey")).toBe("green");
  });

  it("detects synonym colors and maps to primary", () => {
    expect(extractColorFromQuery("crimson jacket")).toBe("red");
    expect(extractColorFromQuery("olive vest")).toBe("green");
    expect(extractColorFromQuery("rose gloves")).toBe("pink");
  });

  it("charcoal maps to black (checked first in iteration)", () => {
    const result = extractColorFromQuery("charcoal helmet");
    expect(["black", "grey"]).toContain(result);
  });

  it("navy maps to blue", () => {
    expect(extractColorFromQuery("navy helmet")).toBe("blue");
  });

  it("ivory maps to white", () => {
    expect(extractColorFromQuery("ivory boots")).toBe("white");
  });

  it("detects multi-word color synonyms", () => {
    expect(extractColorFromQuery("matte black helmet")).toBe("black");
    expect(extractColorFromQuery("hot pink gloves")).toBe("pink");
  });

  it("returns null when no color present", () => {
    expect(extractColorFromQuery("alpinestars jacket")).toBeNull();
    expect(extractColorFromQuery("shoei rf-1400")).toBeNull();
    expect(extractColorFromQuery("brake pads")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(extractColorFromQuery("")).toBeNull();
  });

  it("handles hi-viz as yellow", () => {
    expect(extractColorFromQuery("hi-viz vest")).toBe("yellow");
  });

  it("handles metallic color names", () => {
    expect(extractColorFromQuery("gunmetal helmet")).toBe("grey");
    expect(extractColorFromQuery("bronze boots")).toBe("brown");
  });
});

// ---------------------------------------------------------------------------
// expandColorQuery
// ---------------------------------------------------------------------------
describe("expandColorQuery", () => {
  it("expands primary color to include synonyms", () => {
    const expanded = expandColorQuery("black");
    expect(expanded).toContain("black");
    expect(expanded).toContain("matte black");
    expect(expanded).toContain("stealth");
    expect(expanded).toContain("onyx");
  });

  it("expands synonym to include primary and siblings", () => {
    const expanded = expandColorQuery("navy");
    expect(expanded).toContain("navy");
    expect(expanded).toContain("blue");
    expect(expanded).toContain("cobalt");
  });

  it("returns at least the input color", () => {
    const expanded = expandColorQuery("unknown_color");
    expect(expanded).toContain("unknown_color");
    expect(expanded.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// colorSynonymMap integrity
// ---------------------------------------------------------------------------
describe("colorSynonymMap", () => {
  it("has all expected primary colors", () => {
    const expected = [
      "black", "white", "blue", "red", "green", "orange",
      "yellow", "grey", "pink", "purple", "brown",
    ];
    for (const color of expected) {
      expect(colorSynonymMap).toHaveProperty(color);
    }
  });

  it("each primary has at least 3 synonyms", () => {
    for (const [, synonyms] of Object.entries(colorSynonymMap)) {
      expect(synonyms.length).toBeGreaterThanOrEqual(3);
    }
  });
});

// ---------------------------------------------------------------------------
// SKU_PATTERN / extractSKUFromText
//
// NOTE: The current SKU_PATTERN is very broad (/\b[A-Z0-9]{2,}[-_]?[A-Z0-9]{2,}[-_]?[A-Z0-9]*\b/i)
// and matches many common English words (4+ alpha chars). This is a known
// issue — the pattern is designed to be permissive so it catches real SKUs,
// but it generates false positives on normal text.
// ---------------------------------------------------------------------------
describe("extractSKUFromText", () => {
  it("matches patterns that look like product codes", () => {
    // Real SKU-like patterns with dashes/underscores
    expect(extractSKUFromText("check out 05-0100")).toBeTruthy();
  });

  it("returns null for very short strings", () => {
    expect(extractSKUFromText("hi")).toBeNull();
    expect(extractSKUFromText("")).toBeNull();
  });

  it("returns a match for typical product queries", () => {
    // The SKU regex is broad — it matches alphanumeric tokens of 4+ chars.
    // This is by design: it's a permissive first-pass that is then verified
    // via BigCommerce lookup. Real queries like "looking for RF1400" will
    // trigger a SKU lookup.
    const result = extractSKUFromText("looking for RF1400");
    expect(result).toBeTruthy();
  });

  it("SKU pattern matches real SKU formats used by the store", () => {
    // Typical motorcycle parts SKUs
    expect(extractSKUFromText("SKU: 0101-1234")).toBeTruthy();
    expect(extractSKUFromText("part number ABC123")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// searchProducts (with mocked dependencies)
// ---------------------------------------------------------------------------
describe("searchProducts", () => {
  vi.mock("@/lib/bigcommerce/client", () => ({
    searchProductsBC: vi.fn().mockResolvedValue([]),
    getProductBySKU: vi.fn().mockResolvedValue(null),
    getProductByNameLike: vi.fn().mockResolvedValue([]),
    getProductById: vi.fn().mockResolvedValue(null),
    getProductsByCategory: vi.fn().mockResolvedValue([]),
    findCategoryByName: vi.fn().mockResolvedValue(null),
  }));

  vi.mock("./localCatalogSearch", () => ({
    searchLocalCatalog: vi.fn().mockResolvedValue([]),
  }));

  vi.mock("@/lib/db", () => ({
    db: { execute: vi.fn().mockResolvedValue([]) },
  }));

  vi.mock("@/lib/db/schema", () => ({
    productColorways: {},
  }));

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty for empty query", async () => {
    const { searchProducts } = await import("../productSearch");
    const result = await searchProducts("");
    expect(result.products).toEqual([]);
    expect(result.detectedColor).toBeNull();
  });

  it("returns empty for whitespace-only query", async () => {
    const { searchProducts } = await import("../productSearch");
    const result = await searchProducts("   ");
    expect(result.products).toEqual([]);
    expect(result.detectedColor).toBeNull();
  });

  it("attempts SKU lookup when query contains SKU pattern", async () => {
    const { getProductBySKU } = await import("@/lib/bigcommerce/client");
    const { searchProducts } = await import("../productSearch");

    const mockProduct = {
      id: 1, name: "Test Product", sku: "ABC-123", description: "",
      price: 99, sale_price: 0, retail_price: 0, calculated_price: 99,
      inventory_level: 5, inventory_tracking: "product",
      availability: "available", is_visible: true, categories: [],
      brand_id: 1, custom_url: { url: "/test/" }, variants: [], images: [],
    };

    (getProductBySKU as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockProduct);

    const result = await searchProducts("ABC-123");
    expect(getProductBySKU).toHaveBeenCalled();
    expect(result.products).toHaveLength(1);
    expect(result.products[0].name).toBe("Test Product");
  });

  it("skips invisible products from SKU lookup", async () => {
    const { getProductBySKU } = await import("@/lib/bigcommerce/client");
    const { searchProducts } = await import("../productSearch");

    (getProductBySKU as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: 1, name: "Hidden", sku: "ABC-123", is_visible: false,
      availability: "available", inventory_level: 0,
    });

    const result = await searchProducts("ABC-123");
    expect(result.products).toHaveLength(0);
  });

  it("returns disabled products from SKU lookup (surfaced as in-store-only)", async () => {
    const { getProductBySKU } = await import("@/lib/bigcommerce/client");
    const { searchProducts } = await import("../productSearch");

    (getProductBySKU as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: 1, name: "Disabled", sku: "ABC-123", is_visible: true,
      availability: "disabled", inventory_level: 0,
    });

    const result = await searchProducts("ABC-123");
    expect(result.products).toHaveLength(1);
    expect(result.products[0].availability).toBe("disabled");
  });

  it("detects color in query and sets detectedColor", async () => {
    const { searchProducts } = await import("../productSearch");
    const result = await searchProducts("black helmets");
    expect(result.detectedColor).toBe("black");
  });

  it("runs parallel search sources for keyword queries", async () => {
    const bc = await import("@/lib/bigcommerce/client");
    const { searchProducts } = await import("../productSearch");

    await searchProducts("shoei helmet");

    expect(bc.searchProductsBC).toHaveBeenCalled();
  });

  it("deduplicates products by id across sources", async () => {
    const bc = await import("@/lib/bigcommerce/client");
    const { searchProducts } = await import("../productSearch");

    const product = {
      id: 42, name: "Helmet X", sku: "HX-1", description: "",
      price: 199, sale_price: 0, retail_price: 0, calculated_price: 199,
      inventory_level: 10, inventory_tracking: "product",
      availability: "available", is_visible: true, categories: [1],
      brand_id: 1, custom_url: { url: "/helmet-x/" }, variants: [], images: [],
    };

    (bc.searchProductsBC as ReturnType<typeof vi.fn>).mockResolvedValueOnce([product, product]);

    const result = await searchProducts("helmet");
    const ids = result.products.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("filters out invisible products but keeps disabled (in-store-only) products", async () => {
    const bc = await import("@/lib/bigcommerce/client");
    const { searchProducts } = await import("../productSearch");

    const visible = {
      id: 1, name: "Good", sku: "G-1", is_visible: true,
      availability: "available", inventory_level: 5, inventory_tracking: "product",
      description: "", price: 99, sale_price: 0, retail_price: 0,
      calculated_price: 99, categories: [], brand_id: 1,
      custom_url: { url: "/g/" }, variants: [], images: [],
    };
    const hidden = { ...visible, id: 2, name: "Hidden", is_visible: false };
    const disabled = { ...visible, id: 3, name: "Disabled", availability: "disabled" };

    (bc.searchProductsBC as ReturnType<typeof vi.fn>).mockResolvedValueOnce([visible, hidden, disabled]);

    const result = await searchProducts("helmet");
    const names = result.products.map((p) => p.name).sort();
    expect(names).toEqual(["Disabled", "Good"]);
    expect(result.products.find((p) => p.name === "Hidden")).toBeUndefined();
  });
});
