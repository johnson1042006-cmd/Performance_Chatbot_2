import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  extractKeywords,
  extractSKUFromText,
  extractAccessorySubject,
  extractDiscussedProductSubject,
  isLikelyProductFollowUp,
} from "../productSearch";
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

  it("preserves hyphenated model codes as single tokens — rf-1400 stays whole, not split into rf and 1400", () => {
    const kw = extractKeywords("RF-1400 Yagyo");
    expect(kw).toContain("rf-1400");
    expect(kw).not.toContain("rf");
  });

  it("filters 'colorway' as a stop word — never appears in kwTokens", () => {
    expect(extractKeywords("colorway")).not.toContain("colorway");
    expect(extractKeywords("Yagyo colorway")).not.toContain("colorway");
    expect(extractKeywords("Shoei RF-1400 Yagyo colorway helmet")).not.toContain("colorway");
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
// extractAccessorySubject
// ---------------------------------------------------------------------------
describe("extractAccessorySubject", () => {
  it("flags clear accessory queries", () => {
    expect(
      extractAccessorySubject("any accessories for my helmet").isAccessoryQuery
    ).toBe(true);
    expect(
      extractAccessorySubject("what add-ons go with the RF-1400").isAccessoryQuery
    ).toBe(true);
    expect(
      extractAccessorySubject("extras for my Bell helmet").isAccessoryQuery
    ).toBe(true);
  });

  it("does not flag non-accessory queries", () => {
    expect(extractAccessorySubject("show me helmets").isAccessoryQuery).toBe(false);
    expect(extractAccessorySubject("Pinlock for Bell helmet").isAccessoryQuery).toBe(false);
  });

  it("extracts SKU from latest message when present", () => {
    const subject = extractAccessorySubject("accessories for SKU-12345 please");
    expect(subject.isAccessoryQuery).toBe(true);
    expect(subject.sku).toBeTruthy();
  });

  it("prefers SKU over product name when SKU is present in history", () => {
    const history = [
      "what helmets do you have",
      "Here are some options: **Shoei RF-1400** at $599.99 — IN STOCK",
      "tell me more about the second one",
    ];
    const subject = extractAccessorySubject(
      "what accessories do you have for it",
      history
    );
    expect(subject.isAccessoryQuery).toBe(true);
    expect(subject.sku).toBe("RF-1400");
  });

  it("falls back to product name from history when no SKU pattern exists", () => {
    const history = [
      "Here is **Alpinestars Tech Air Plasma Vest**",
    ];
    const subject = extractAccessorySubject(
      "any accessories for that one",
      history
    );
    expect(subject.isAccessoryQuery).toBe(true);
    expect(subject.productName).toBe("Alpinestars Tech Air Plasma Vest");
  });

  it("uses the most recent product name when multiple are mentioned without SKUs", () => {
    const history = [
      "Here is **Alpinestars Plasma Vest**",
      "And also **Alpinestars Stella Bionic Vest**",
    ];
    const subject = extractAccessorySubject(
      "any accessories for that one",
      history
    );
    expect(subject.productName).toBe("Alpinestars Stella Bionic Vest");
  });

  it("returns isAccessoryQuery=true even with no resolvable subject", () => {
    const subject = extractAccessorySubject("what accessories do you have");
    expect(subject.isAccessoryQuery).toBe(true);
    expect(subject.sku).toBeNull();
    expect(subject.productName).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// isLikelyProductFollowUp / extractDiscussedProductSubject
// ---------------------------------------------------------------------------
describe("isLikelyProductFollowUp", () => {
  it("detects size and stock follow-ups", () => {
    expect(isLikelyProductFollowUp("what sizes do you have")).toBe(true);
    expect(isLikelyProductFollowUp("is XL in stock")).toBe(true);
    expect(isLikelyProductFollowUp("tell me more")).toBe(true);
  });

  it("detects strict SKU in message", () => {
    expect(isLikelyProductFollowUp("check ABC-12345 for me")).toBe(true);
  });

  it("returns false for long fresh catalog questions", () => {
    expect(
      isLikelyProductFollowUp(
        "I am looking for the best waterproof touring jacket under 400 dollars for long distance"
      )
    ).toBe(false);
  });

  it("treats refinement queries as follow-ups", () => {
    expect(isLikelyProductFollowUp("show me ones motocross")).toBe(true);
    expect(isLikelyProductFollowUp("the red ones")).toBe(true);
    expect(isLikelyProductFollowUp("any in red")).toBe(true);
    expect(isLikelyProductFollowUp("what about motocross")).toBe(true);
    expect(isLikelyProductFollowUp("in mx")).toBe(true);
    expect(isLikelyProductFollowUp("show me cheaper")).toBe(true);
    expect(isLikelyProductFollowUp("got any in black")).toBe(true);
  });

  it("does not over-match on fresh searches that happen to contain 'one'", () => {
    expect(isLikelyProductFollowUp("one piece suit for track days")).toBe(false);
    expect(
      isLikelyProductFollowUp(
        "i'm looking for a motocross helmet under $500 with mips and a good ventilation system for hot weather"
      )
    ).toBe(false);
  });
});

describe("extractDiscussedProductSubject", () => {
  it("returns SKU from latest when present", () => {
    const assistant: string[] = [];
    expect(extractDiscussedProductSubject("part 05-0100-AB", assistant)).toEqual({
      sku: "05-0100-AB",
      productName: null,
    });
  });

  it("returns null when follow-up pattern but no assistant product yet", () => {
    expect(extractDiscussedProductSubject("what sizes?", [])).toBeNull();
  });

  it("resolves product name from latest assistant bold title", () => {
    const assistant = [
      "Here are some picks:\n\n[**Shoei RF-1400 Full Face**](https://example.com) — $599",
    ];
    expect(extractDiscussedProductSubject("what sizes?", assistant)).toEqual({
      sku: null,
      productName: "Shoei RF-1400 Full Face",
    });
  });

  it("uses the most recent assistant message with a bold title", () => {
    const assistant = [
      "**Bell Qualifier** — $199",
      "**AGV K6 S** — $449",
    ];
    expect(extractDiscussedProductSubject("is the second one in stock?", assistant)).toEqual({
      sku: null,
      productName: "AGV K6 S",
    });
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

  it("surfaces MX helmets for 'alpinestars mx helmets' via type+subcategory path", async () => {
    // "Offroad Helmets" is the real BC category (93 products) — "MX Helmets" never exists.
    const { findCategoryByName, getProductsByCategory } = await import("@/lib/bigcommerce/client");
    const { searchProducts } = await import("../productSearch");

    const offroadCat = { id: 99, name: "Offroad Helmets", parent_id: 0 };
    const mxHelmet = (id: number, name: string) => ({
      id, name, sku: `AS-${id}`,
      description: "Professional motocross helmet designed for off-road riders.",
      price: 499, sale_price: 0, retail_price: 0, calculated_price: 499,
      inventory_level: 5, inventory_tracking: "product",
      availability: "available", is_visible: true,
      categories: [99], brand_id: 1,
      custom_url: { url: `/helmets/${id}/` }, variants: [], images: [],
    });
    const fixtures = [
      mxHelmet(101, "Alpinestars Supertech M10 Deegan Monster"),
      mxHelmet(102, "Alpinestars Supertech M10 Unite"),
      mxHelmet(103, "Alpinestars SM-10 Solid"),
      mxHelmet(104, "Alpinestars S-M7 Core"),
    ];

    (findCategoryByName as ReturnType<typeof vi.fn>).mockImplementation(
      async (name: string) => (name === "Offroad Helmets" ? offroadCat : null)
    );
    (getProductsByCategory as ReturnType<typeof vi.fn>).mockImplementation(
      async (id: number) => (id === 99 ? fixtures : [])
    );

    const result = await searchProducts("alpinestars mx helmets");
    const names = result.products.map((p) => p.name);
    expect(names).toContain("Alpinestars Supertech M10 Deegan Monster");
    expect(names).toContain("Alpinestars Supertech M10 Unite");
    expect(names).toContain("Alpinestars SM-10 Solid");
    expect(names).toContain("Alpinestars S-M7 Core");
  });

  it("surfaces Adventure Boots for 'show me adventure boots'", async () => {
    // BC has no "Adventure Boots" leaf — the code falls back to "Boots" (310 products).
    const { findCategoryByName, getProductsByCategory } = await import("@/lib/bigcommerce/client");
    const { searchProducts } = await import("../productSearch");

    const bootsCat = { id: 88, name: "Boots", parent_id: 0 };
    const boot = (id: number, name: string) => ({
      id, name, sku: `B-${id}`, description: "adventure boots",
      price: 299, sale_price: 0, retail_price: 0, calculated_price: 299,
      inventory_level: 3, inventory_tracking: "product",
      availability: "available", is_visible: true,
      categories: [88], brand_id: 2,
      custom_url: { url: `/boots/${id}/` }, variants: [], images: [],
    });

    (findCategoryByName as ReturnType<typeof vi.fn>).mockImplementation(
      async (name: string) => (name === "Boots" ? bootsCat : null)
    );
    (getProductsByCategory as ReturnType<typeof vi.fn>).mockImplementation(
      async (id: number) =>
        id === 88
          ? [
              boot(201, "Alpinestars Corozal Adventure Drystar Boot"),
              boot(202, "Sidi Adventure 2 Gore Boot"),
            ]
          : []
    );

    const result = await searchProducts("show me adventure boots");
    const names = result.products.map((p) => p.name);
    expect(names).toContain("Alpinestars Corozal Adventure Drystar Boot");
    expect(names).toContain("Sidi Adventure 2 Gore Boot");
  });

  it("surfaces Street Helmets default for 'show me alpinestars helmets' with no subcategory", async () => {
    const { findCategoryByName, getProductsByCategory } = await import("@/lib/bigcommerce/client");
    const { searchProducts } = await import("../productSearch");

    const streetCat = { id: 77, name: "Street Helmets", parent_id: 0 };
    const streetHelmet = (id: number, name: string) => ({
      id, name, sku: `H-${id}`,
      description: "Full face street helmet for sport and touring riders.",
      price: 599, sale_price: 0, retail_price: 0, calculated_price: 599,
      inventory_level: 4, inventory_tracking: "product",
      availability: "available", is_visible: true,
      categories: [77], brand_id: 1,
      custom_url: { url: `/helmets/${id}/` }, variants: [], images: [],
    });
    const fixtures = [
      streetHelmet(301, "Alpinestars Supertech R10 Solid"),
      streetHelmet(302, "Alpinestars Supertech R10 Element"),
    ];

    (findCategoryByName as ReturnType<typeof vi.fn>).mockImplementation(
      async (name: string) => (name === "Street Helmets" ? streetCat : null)
    );
    (getProductsByCategory as ReturnType<typeof vi.fn>).mockImplementation(
      async (id: number) => (id === 77 ? fixtures : [])
    );

    const result = await searchProducts("show me alpinestars helmets");
    const names = result.products.map((p) => p.name);
    expect(names).toContain("Alpinestars Supertech R10 Solid");
    expect(names).toContain("Alpinestars Supertech R10 Element");
  });

  it("'show me street gloves under $80' hard-filters out products > $80", async () => {
    // BC has no "Street Gloves" leaf — the code uses the top-level "Gloves" category (860 products).
    const { findCategoryByName, getProductsByCategory } = await import("@/lib/bigcommerce/client");
    const { searchProducts } = await import("../productSearch");

    const gloveCat = { id: 55, name: "Gloves", parent_id: 0 };
    const makeGlove = (id: number, name: string, price: number) => ({
      id, name, sku: `GL-${id}`,
      description: "Street riding gloves.",
      price, sale_price: 0, retail_price: 0, calculated_price: price,
      inventory_level: 5, inventory_tracking: "product",
      availability: "available", is_visible: true,
      categories: [55], brand_id: 1,
      custom_url: { url: `/gloves/${id}/` }, variants: [], images: [],
    });

    (findCategoryByName as ReturnType<typeof vi.fn>).mockImplementation(
      async (name: string) => (name === "Gloves" ? gloveCat : null)
    );
    (getProductsByCategory as ReturnType<typeof vi.fn>).mockImplementation(
      async (id: number) =>
        id === 55
          ? [
              makeGlove(901, "Alpinestars SP-8 V3 Gloves", 49),
              makeGlove(902, "Alpinestars SP Air Gloves", 149),
            ]
          : []
    );

    const result = await searchProducts("show me street gloves under $80");
    const names = result.products.map((p) => p.name);
    expect(names).toContain("Alpinestars SP-8 V3 Gloves");
    expect(names).not.toContain("Alpinestars SP Air Gloves");
  });

  it("'blue helmet under $500' detects color AND hard-filters products over budget", async () => {
    const { findCategoryByName, getProductsByCategory } = await import("@/lib/bigcommerce/client");
    const { searchProducts } = await import("../productSearch");

    const streetCat = { id: 66, name: "Street Helmets", parent_id: 0 };
    const blueVariant = {
      id: 1,
      option_display_name: "Color",
      label: "Blue",
    };
    const redVariant = {
      id: 2,
      option_display_name: "Color",
      label: "Red",
    };
    const makeHelmet = (
      id: number,
      name: string,
      price: number,
      variantColor: typeof blueVariant | typeof redVariant | null
    ) => ({
      id, name, sku: `H-${id}`,
      description: "Street helmet.",
      price, sale_price: 0, retail_price: 0, calculated_price: price,
      inventory_level: 3, inventory_tracking: "product",
      availability: "available", is_visible: true,
      categories: [66], brand_id: 1,
      custom_url: { url: `/helmets/${id}/` },
      variants: variantColor
        ? [{ id: id * 10, option_values: [variantColor], inventory_level: 3 }]
        : [],
      images: [],
    });

    (findCategoryByName as ReturnType<typeof vi.fn>).mockImplementation(
      async (name: string) => (name === "Street Helmets" ? streetCat : null)
    );
    (getProductsByCategory as ReturnType<typeof vi.fn>).mockImplementation(
      async (id: number) =>
        id === 66
          ? [
              makeHelmet(801, "Shoei RF-1400 Blue", 399, blueVariant),
              makeHelmet(802, "Shoei RF-1400 Red", 399, redVariant),
              makeHelmet(803, "Shoei X-SPR Pro", 799, null),
            ]
          : []
    );

    const result = await searchProducts("blue helmet under $500");
    expect(result.detectedColor).toBe("blue");
    const names = result.products.map((p) => p.name);
    expect(names).toContain("Shoei RF-1400 Blue");
    expect(names).not.toContain("Shoei X-SPR Pro");
  });

  it("'show me race helmets' surfaces products from the Race Helmets BC category", async () => {
    // Regression: Race Helmets is a sibling shelf to Street Helmets (42 products:
    // Arai Corsair X, HJC RPHA 1N, Shoei X-Fourteen etc.).  The full_face
    // subcategory must include "Race Helmets" so these are never invisible.
    const { findCategoryByName, getProductsByCategory } = await import("@/lib/bigcommerce/client");
    const { searchProducts } = await import("../productSearch");

    const raceCat   = { id: 42, name: "Race Helmets",   parent_id: 0 };
    const streetCat = { id: 77, name: "Street Helmets", parent_id: 0 };

    const makeHelmet = (id: number, name: string, catId: number) => ({
      id, name, sku: `RH-${id}`,
      description: "Homologated race helmet for circuit use.",
      price: 849, sale_price: 0, retail_price: 0, calculated_price: 849,
      inventory_level: 2, inventory_tracking: "product",
      availability: "available", is_visible: true,
      categories: [catId], brand_id: 5,
      custom_url: { url: `/helmets/${id}/` }, variants: [], images: [],
    });

    const raceFixtures = [
      makeHelmet(301, "Arai Corsair-X Helmet",         42),
      makeHelmet(302, "HJC RPHA 1N Helmet",            42),
      makeHelmet(303, "Shoei X-Fourteen Helmet",       42),
    ];
    const streetFixtures = [
      makeHelmet(401, "Shoei RF-1400 Street Helmet",   77),
    ];

    (findCategoryByName as ReturnType<typeof vi.fn>).mockImplementation(
      async (name: string) => {
        if (name === "Race Helmets")   return raceCat;
        if (name === "Street Helmets") return streetCat;
        return null;
      }
    );
    (getProductsByCategory as ReturnType<typeof vi.fn>).mockImplementation(
      async (id: number) => {
        if (id === 42) return raceFixtures;
        if (id === 77) return streetFixtures;
        return [];
      }
    );

    const result = await searchProducts("show me race helmets");
    const names = result.products.map((p) => p.name);

    // All three Race Helmets shelf products must appear
    expect(names).toContain("Arai Corsair-X Helmet");
    expect(names).toContain("HJC RPHA 1N Helmet");
    expect(names).toContain("Shoei X-Fourteen Helmet");
  });

  // -------------------------------------------------------------------------
  // Name-match candidate source regression tests
  // -------------------------------------------------------------------------

  it("surfaces Klim Badlands Pro Jacket for 'do you guys have the badlands pro?'", async () => {
    const { getProductByNameLike } = await import("@/lib/bigcommerce/client");
    const { searchProducts } = await import("../productSearch");

    const badlandsJacket = {
      id: 900, name: "Klim Badlands Pro Jacket", sku: "KL-BPJ",
      description: "Adventure touring jacket.",
      price: 549, sale_price: 0, retail_price: 0, calculated_price: 549,
      inventory_level: 3, inventory_tracking: "product",
      availability: "available", is_visible: true,
      categories: [10], brand_id: 5,
      custom_url: { url: "/klim-badlands-pro-jacket/" }, variants: [], images: [],
    };

    (getProductByNameLike as ReturnType<typeof vi.fn>).mockResolvedValue([badlandsJacket]);

    const result = await searchProducts("do you guys have the badlands pro?");
    const names = result.products.map((p) => p.name);
    expect(names).toContain("Klim Badlands Pro Jacket");
  });

  it("surfaces Alpinestars Supertech M10 for 'show me the supertech m10'", async () => {
    const { getProductByNameLike } = await import("@/lib/bigcommerce/client");
    const { searchProducts } = await import("../productSearch");

    const supertechM10 = {
      id: 901, name: "Alpinestars Supertech M10 Helmet", sku: "AS-STM10",
      description: "MX helmet.",
      price: 699, sale_price: 0, retail_price: 0, calculated_price: 699,
      inventory_level: 5, inventory_tracking: "product",
      availability: "available", is_visible: true,
      categories: [11], brand_id: 6,
      custom_url: { url: "/alpinestars-supertech-m10/" }, variants: [], images: [],
    };

    (getProductByNameLike as ReturnType<typeof vi.fn>).mockResolvedValue([supertechM10]);

    const result = await searchProducts("show me the supertech m10");
    const names = result.products.map((p) => p.name);
    expect(names).toContain("Alpinestars Supertech M10 Helmet");
  });

  it("surfaces Arai Ram-X for 'ram-x helmet' even with Street Helmets pool contributing", async () => {
    const { getProductByNameLike, findCategoryByName, getProductsByCategory } = await import("@/lib/bigcommerce/client");
    const { searchProducts } = await import("../productSearch");

    const ramX = {
      id: 902, name: "Arai Ram-X Helmet", sku: "ARAI-RX",
      description: "Full-face street helmet.",
      price: 849, sale_price: 0, retail_price: 0, calculated_price: 849,
      inventory_level: 2, inventory_tracking: "product",
      availability: "available", is_visible: true,
      categories: [20], brand_id: 7,
      custom_url: { url: "/arai-ram-x/" }, variants: [], images: [],
    };
    const otherHelmet = {
      id: 903, name: "Shoei RF-1400 Helmet", sku: "SH-RF14",
      description: "Street helmet.",
      price: 599, sale_price: 0, retail_price: 0, calculated_price: 599,
      inventory_level: 10, inventory_tracking: "product",
      availability: "available", is_visible: true,
      categories: [20], brand_id: 8,
      custom_url: { url: "/shoei-rf-1400/" }, variants: [], images: [],
    };

    const streetCatH = { id: 20, name: "Street Helmets", parent_id: 0 };

    (getProductByNameLike as ReturnType<typeof vi.fn>).mockResolvedValue([ramX]);
    (findCategoryByName as ReturnType<typeof vi.fn>).mockImplementation(
      async (name: string) => (name === "Street Helmets" ? streetCatH : null)
    );
    (getProductsByCategory as ReturnType<typeof vi.fn>).mockImplementation(
      async (id: number) => (id === 20 ? [ramX, otherHelmet] : [])
    );

    const result = await searchProducts("ram-x helmet");
    const names = result.products.map((p) => p.name);
    expect(names).toContain("Arai Ram-X Helmet");
  });

  it("regression: alpinestars mx helmets still surfaces Supertech fixtures, not displaced by name-match noise", async () => {
    const { getProductByNameLike, findCategoryByName, getProductsByCategory } = await import("@/lib/bigcommerce/client");
    const { searchProducts } = await import("../productSearch");

    const motoHelmetsCat = { id: 30, name: "Moto Helmets", parent_id: 0 };
    const alpineCat = { id: 31, name: "Alpinestars", parent_id: 0 };

    const supertech = (id: number, name: string) => ({
      id, name, sku: `AS-${id}`,
      description: "MX helmet.",
      price: 699, sale_price: 0, retail_price: 0, calculated_price: 699,
      inventory_level: 4, inventory_tracking: "product",
      availability: "available", is_visible: true,
      categories: [30, 31], brand_id: 6,
      custom_url: { url: `/alpinestars/${id}/` }, variants: [], images: [],
    });
    const fixtures = [
      supertech(910, "Alpinestars Supertech SM-10 Helmet"),
      supertech(911, "Alpinestars Supertech M10 Helmet"),
      supertech(912, "Alpinestars Supertech S-M7 Helmet"),
    ];

    (getProductByNameLike as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (findCategoryByName as ReturnType<typeof vi.fn>).mockImplementation(
      async (name: string) => {
        if (name === "Moto Helmets") return motoHelmetsCat;
        if (name === "Alpinestars") return alpineCat;
        return null;
      }
    );
    (getProductsByCategory as ReturnType<typeof vi.fn>).mockImplementation(
      async (id: number) => {
        if (id === 30 || id === 31) return fixtures;
        return [];
      }
    );

    const result = await searchProducts("show me alpinestars mx helmets");
    const names = result.products.map((p) => p.name);
    expect(names).toContain("Alpinestars Supertech SM-10 Helmet");
    expect(names).toContain("Alpinestars Supertech M10 Helmet");
    expect(names).toContain("Alpinestars Supertech S-M7 Helmet");
  });

  // -------------------------------------------------------------------------
  // New name-match tests (Layer 1A / 1B coverage)
  // -------------------------------------------------------------------------

  it("'badlands pro' (clean 2-token query) finds Klim Badlands Pro Jacket via full-join name match", async () => {
    const { getProductByNameLike } = await import("@/lib/bigcommerce/client");
    const { searchProducts } = await import("../productSearch");

    const jacket = {
      id: 920, name: "Klim Badlands Pro Jacket", sku: "KL-BPJ2",
      description: "Adventure touring jacket.",
      price: 549, sale_price: 0, retail_price: 0, calculated_price: 549,
      inventory_level: 3, inventory_tracking: "product",
      availability: "available", is_visible: true,
      categories: [10], brand_id: 5,
      custom_url: { url: "/klim-badlands-pro-jacket/" }, variants: [], images: [],
    };

    (getProductByNameLike as ReturnType<typeof vi.fn>).mockResolvedValue([jacket]);

    const result = await searchProducts("badlands pro");
    expect(result.products.map((p) => p.name)).toContain("Klim Badlands Pro Jacket");
  });

  it("'klim badlands pro adventure jacket' finds Klim Badlands Pro Jacket via shorter substring window — full join doesn't match but 'klim badlands pro' does", async () => {
    const { getProductByNameLike } = await import("@/lib/bigcommerce/client");
    const { searchProducts } = await import("../productSearch");

    const jacket = {
      id: 921, name: "Klim Badlands Pro Jacket", sku: "KL-BPJ3",
      description: "Adventure touring jacket.",
      price: 549, sale_price: 0, retail_price: 0, calculated_price: 549,
      inventory_level: 3, inventory_tracking: "product",
      availability: "available", is_visible: true,
      categories: [10], brand_id: 5,
      custom_url: { url: "/klim-badlands-pro-jacket/" }, variants: [], images: [],
    };

    // Full 4-token join "klim badlands pro adventure" returns empty; first-3 "klim badlands pro" returns the jacket.
    (getProductByNameLike as ReturnType<typeof vi.fn>).mockImplementation(
      async (q: string) => {
        if (q === "klim badlands pro adventure") return [];
        if (q.includes("klim badlands pro") || q.includes("badlands pro")) return [jacket];
        return [];
      }
    );

    const result = await searchProducts("klim badlands pro adventure jacket");
    expect(result.products.map((p) => p.name)).toContain("Klim Badlands Pro Jacket");
  });

  it("'corsair x' finds Arai Corsair X via BC keyword search (phrase-synonym collapses to single token 'corsair-x')", async () => {
    const { searchProductsBC } = await import("@/lib/bigcommerce/client");
    const { searchProducts } = await import("../productSearch");

    const corsairX = {
      id: 922, name: "Arai Corsair-X Helmet", sku: "ARAI-CX",
      description: "FIM homologated race helmet.",
      price: 899, sale_price: 0, retail_price: 0, calculated_price: 899,
      inventory_level: 2, inventory_tracking: "product",
      availability: "available", is_visible: true,
      categories: [42], brand_id: 7,
      custom_url: { url: "/arai-corsair-x/" }, variants: [], images: [],
    };

    // "corsair x" → PHRASE_SYNONYMS → "corsair-x" (1 token); IIFE short-circuits
    // to [] for single-token queries. Product is found via searchProductsBC.
    (searchProductsBC as ReturnType<typeof vi.fn>).mockResolvedValue([corsairX]);

    const result = await searchProducts("corsair x");
    expect(result.products.map((p) => p.name)).toContain("Arai Corsair-X Helmet");
  });

  it("'rpha 1n' finds HJC RPHA 1N via raw-kwTokens join fallback in the name-match IIFE", async () => {
    const { getProductByNameLike } = await import("@/lib/bigcommerce/client");
    const { searchProducts } = await import("../productSearch");

    const rpha1n = {
      id: 923, name: "HJC RPHA 1N Helmet", sku: "HJC-RPHA1N",
      description: "FIM homologated road race helmet.",
      price: 849, sale_price: 0, retail_price: 0, calculated_price: 849,
      inventory_level: 4, inventory_tracking: "product",
      availability: "available", is_visible: true,
      categories: [42], brand_id: 8,
      custom_url: { url: "/hjc-rpha-1n/" }, variants: [], images: [],
    };

    // "rpha 1n" → kwTokens ["rpha","1n"]; tokens filtered to >=3 chars = ["rpha"]
    // (length 1 < 2) → IIFE falls back to kwTokens.join(" ") = "rpha 1n".
    (getProductByNameLike as ReturnType<typeof vi.fn>).mockImplementation(
      async (q: string) => (q === "rpha 1n" ? [rpha1n] : [])
    );

    const result = await searchProducts("rpha 1n");
    expect(result.products.map((p) => p.name)).toContain("HJC RPHA 1N Helmet");
  });

  it("last-ditch retry recovers when full pool is empty — 'klim badlands jacket' returns Klim Badlands Pro Jacket via per-token retry", async () => {
    const { getProductByNameLike, searchProductsBC, findCategoryByName } = await import("@/lib/bigcommerce/client");
    const { searchProducts } = await import("../productSearch");

    const jacket = {
      id: 924, name: "Klim Badlands Pro Jacket", sku: "KL-BPJ4",
      description: "Adventure touring jacket.",
      price: 549, sale_price: 0, retail_price: 0, calculated_price: 549,
      inventory_level: 3, inventory_tracking: "product",
      availability: "available", is_visible: true,
      categories: [10], brand_id: 5,
      custom_url: { url: "/klim-badlands-pro-jacket/" }, variants: [], images: [],
    };

    // Ensure all parallel sources return [] so pool is truly empty before retry fires.
    (searchProductsBC as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (findCategoryByName as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    // "klim badlands jacket" → tokens ["klim","badlands","jacket"] (all >=3 chars)
    // Full-join "klim badlands jacket" returns []; first-3 is same; 2-token windows
    // "klim badlands" and "badlands jacket" also return [].
    // Pool is empty → last-ditch retry fires (kwTokens.length === 3 >= 3).
    // Per-token tries: "klim" (4 chars) → [], "badlands" (8 chars) → [jacket].
    (getProductByNameLike as ReturnType<typeof vi.fn>).mockImplementation(
      async (q: string) => (q === "badlands" ? [jacket] : [])
    );

    const result = await searchProducts("klim badlands jacket");
    expect(result.products.map((p) => p.name)).toContain("Klim Badlands Pro Jacket");
  });

  it("regression: 'what jackets do you have' (ambiguous) still ranks street jackets above mx jackets (-50 off-street penalty)", async () => {
    const { findCategoryByName, getProductsByCategory } = await import("@/lib/bigcommerce/client");
    const { searchProducts } = await import("../productSearch");

    const jacketsCat = { id: 50, name: "Jackets", parent_id: 0 };

    const makeJacket = (id: number, name: string, desc: string) => ({
      id, name, sku: `J-${id}`, description: desc,
      price: 299, sale_price: 0, retail_price: 0, calculated_price: 299,
      inventory_level: 5, inventory_tracking: "product",
      availability: "available", is_visible: true,
      categories: [50], brand_id: 1,
      custom_url: { url: `/jackets/${id}/` }, variants: [], images: [],
    });

    const streetJacket = makeJacket(930, "Rev'it Tornado 4 Street Jacket", "Street riding jacket for urban commuters.");
    const mxJacket     = makeJacket(931, "Fox Racing 180 MX Jacket", "Motocross off-road race jacket for dirt riding.");

    (findCategoryByName as ReturnType<typeof vi.fn>).mockImplementation(
      async (name: string) => (name === "Jackets" ? jacketsCat : null)
    );
    (getProductsByCategory as ReturnType<typeof vi.fn>).mockImplementation(
      async (id: number) => (id === 50 ? [mxJacket, streetJacket] : [])
    );

    const result = await searchProducts("what jackets do you have");
    const names = result.products.map((p) => p.name);
    const streetIdx = names.indexOf("Rev'it Tornado 4 Street Jacket");
    const mxIdx     = names.indexOf("Fox Racing 180 MX Jacket");

    expect(streetIdx).toBeGreaterThanOrEqual(0);
    expect(mxIdx).toBeGreaterThanOrEqual(0);
    // Street jacket must rank above MX jacket when the customer gave no subcategory signal.
    expect(streetIdx).toBeLessThan(mxIdx);
  });

  // ---------------------------------------------------------------------------
  // Per-token fallback (nameMatches IIFE) — Yagyo / RF-1400 contamination tests
  // ---------------------------------------------------------------------------

  it("'shoei rf-1400 yagyo colorway helmet' (contaminated) finds Shoei RF-1400 Yagyo via per-token 'yagyo' fallback when all window strategies miss", async () => {
    const { getProductByNameLike, searchProductsBC, findCategoryByName } = await import("@/lib/bigcommerce/client");
    const { searchProducts } = await import("../productSearch");

    const yagyoHelmet = {
      id: 960, name: "Shoei RF-1400 Yagyo Helmet", sku: "SH-RF1400-YG",
      description: "Shoei RF-1400 Yagyo colorway full-face helmet.",
      price: 649, sale_price: 0, retail_price: 0, calculated_price: 649,
      inventory_level: 2, inventory_tracking: "product",
      availability: "available", is_visible: true,
      categories: [20], brand_id: 2,
      custom_url: { url: "/shoei-rf-1400-yagyo/" }, variants: [], images: [],
    };

    // All parallel broad sources return empty so per-token is the only path.
    (searchProductsBC as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (findCategoryByName as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    // Window strategies all return []; only the standalone "yagyo" token hits.
    // "rf-1400" is distinctive too — let it also resolve so either token works.
    (getProductByNameLike as ReturnType<typeof vi.fn>).mockImplementation(
      async (q: string) => {
        if (q === "yagyo" || q === "rf-1400") return [yagyoHelmet];
        return [];
      }
    );

    const result = await searchProducts("Shoei RF-1400 Yagyo colorway helmet");
    expect(result.products.map((p) => p.name)).toContain("Shoei RF-1400 Yagyo Helmet");
  });

  it("'shoei rf-1400 yagyo helmet' (colorway already stripped) still finds Yagyo via per-token when window strategies miss", async () => {
    const { getProductByNameLike, searchProductsBC, findCategoryByName } = await import("@/lib/bigcommerce/client");
    const { searchProducts } = await import("../productSearch");

    const yagyoHelmet = {
      id: 961, name: "Shoei RF-1400 Yagyo Helmet", sku: "SH-RF1400-YG2",
      description: "Shoei RF-1400 Yagyo colorway full-face helmet.",
      price: 649, sale_price: 0, retail_price: 0, calculated_price: 649,
      inventory_level: 2, inventory_tracking: "product",
      availability: "available", is_visible: true,
      categories: [20], brand_id: 2,
      custom_url: { url: "/shoei-rf-1400-yagyo/" }, variants: [], images: [],
    };

    (searchProductsBC as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (findCategoryByName as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    // Simulate the case where window strategies all return empty but
    // the individual "yagyo" token matches the product name directly.
    (getProductByNameLike as ReturnType<typeof vi.fn>).mockImplementation(
      async (q: string) => (q === "yagyo" || q === "rf-1400" ? [yagyoHelmet] : [])
    );

    const result = await searchProducts("shoei rf-1400 yagyo helmet");
    expect(result.products.map((p) => p.name)).toContain("Shoei RF-1400 Yagyo Helmet");
  });

  it("'klim badlands pro adventure jacket' finds Badlands Pro via window or per-token fallback (regression)", async () => {
    const { getProductByNameLike, searchProductsBC, findCategoryByName } = await import("@/lib/bigcommerce/client");
    const { searchProducts } = await import("../productSearch");

    const badlandsJacket = {
      id: 962, name: "Klim Badlands Pro Jacket", sku: "KL-BPJ5",
      description: "Adventure touring jacket.",
      price: 549, sale_price: 0, retail_price: 0, calculated_price: 549,
      inventory_level: 3, inventory_tracking: "product",
      availability: "available", is_visible: true,
      categories: [10], brand_id: 5,
      custom_url: { url: "/klim-badlands-pro-jacket/" }, variants: [], images: [],
    };

    (searchProductsBC as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (findCategoryByName as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    // 2-token window "badlands pro" or per-token "badlands" / "pro" should catch it.
    (getProductByNameLike as ReturnType<typeof vi.fn>).mockImplementation(
      async (q: string) => {
        if (q.includes("badlands pro") || q === "badlands") return [badlandsJacket];
        return [];
      }
    );

    const result = await searchProducts("klim badlands pro adventure jacket");
    expect(result.products.map((p) => p.name)).toContain("Klim Badlands Pro Jacket");
  });

  it("brand-only token 'klim' is excluded from per-token distinctive lookup — any getProductByNameLike('klim') call must be the brand-source fallback (limit=30), not the per-token pass (limit=10)", async () => {
    const { getProductByNameLike, searchProductsBC, findCategoryByName } = await import("@/lib/bigcommerce/client");
    const { searchProducts } = await import("../productSearch");

    (searchProductsBC as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (findCategoryByName as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (getProductByNameLike as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    await searchProducts("klim jacket");

    // "klim" is in KNOWN_BRANDS_SET and "jacket" is in TYPE_TOKEN_SET — "klim"
    // should not appear in per-token (limit=10) calls. The brand-source fallback
    // (3b) may legitimately call getProductByNameLike("klim", 30) when klim has
    // no dedicated BC category shelf. Verify the limit distinguishes the two paths.
    const klimCalls = (getProductByNameLike as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c: unknown[]) => c[0] === "klim"
    );
    klimCalls.forEach((c: unknown[]) => {
      expect([30, 50]).toContain(c[1]); // 30 = 3b brand fallback, 50 = 3c brand+type fetch, 10 = per-token (disallowed)
    });
  });

  it("per-token queries are capped at 4 even when many distinctive tokens exist", async () => {
    const { getProductByNameLike, searchProductsBC, findCategoryByName } = await import("@/lib/bigcommerce/client");
    const { searchProducts } = await import("../productSearch");

    // Return a dummy product from BC keyword search so pool.length > 0, which
    // prevents the last-ditch retry from firing. This isolates the nameMatches
    // per-token pass (capped at 4) from the last-ditch retry (separate path).
    const dummy = {
      id: 999, name: "Generic Gear", sku: "GEN-001",
      description: "Generic gear product.", price: 99,
      sale_price: 0, retail_price: 0, calculated_price: 99,
      inventory_level: 5, inventory_tracking: "product",
      availability: "available", is_visible: true,
      categories: [1], brand_id: 1,
      custom_url: { url: "/generic/" }, variants: [], images: [],
    };
    (searchProductsBC as ReturnType<typeof vi.fn>).mockResolvedValue([dummy]);
    (findCategoryByName as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    // All name-like queries return [] so window strategies exhaust and per-token fires.
    (getProductByNameLike as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    // 8 distinctive tokens (none are brands or type words) — per-token pass
    // should fire at most 4 individual getProductByNameLike calls.
    await searchProducts("yagyo badlands corsair supertech rpha phantera interceptor ventura");

    const perTokenCandidates = ["yagyo", "badlands", "corsair", "supertech", "rpha", "phantera", "interceptor", "ventura"];
    const singleTokenCalls = (getProductByNameLike as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c: unknown[]) => perTokenCandidates.includes(c[0] as string)
    );
    expect(singleTokenCalls.length).toBeLessThanOrEqual(4);
  });
});

// ---------------------------------------------------------------------------
// searchProducts — broad product types (comm / brake / sprocket)
// ---------------------------------------------------------------------------
describe("searchProducts — broad product types", () => {
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

  it("surfaces Comm Systems products for 'what bluetooth communicators do you have'", async () => {
    const { findCategoryByName, getProductsByCategory } = await import("@/lib/bigcommerce/client");
    const { searchProducts } = await import("../productSearch");

    const commCat = { id: 55, name: "Comm Systems", parent_id: 0 };
    const commProduct = (id: number, name: string) => ({
      id, name, sku: `CS-${id}`, description: "Bluetooth motorcycle communication system.",
      price: 299, sale_price: 0, retail_price: 0, calculated_price: 299,
      inventory_level: 8, inventory_tracking: "product",
      availability: "available", is_visible: true,
      categories: [55], brand_id: 10,
      custom_url: { url: `/comm/${id}/` }, variants: [], images: [],
    });
    const fixtures = [
      commProduct(501, "Cardo Packtalk Edge"),
      commProduct(502, "Sena 50S Motorcycle Bluetooth Communication System"),
    ];

    (findCategoryByName as ReturnType<typeof vi.fn>).mockImplementation(
      async (name: string) => (name === "Comm Systems" ? commCat : null)
    );
    (getProductsByCategory as ReturnType<typeof vi.fn>).mockImplementation(
      async (id: number) => (id === 55 ? fixtures : [])
    );

    const result = await searchProducts("what bluetooth communicators do you have");
    const names = result.products.map((p) => p.name);
    expect(names).toContain("Cardo Packtalk Edge");
    expect(names).toContain("Sena 50S Motorcycle Bluetooth Communication System");
  });

  it("surfaces Brake Pads products (model-number SKUs) for 'do you have ebc brake pads'", async () => {
    const { findCategoryByName, getProductsByCategory } = await import("@/lib/bigcommerce/client");
    const { searchProducts } = await import("../productSearch");

    const brakeCat = { id: 66, name: "Brake Pads/Brake Shoes", parent_id: 0 };
    const brakeProduct = (id: number, name: string) => ({
      id, name, sku: name, description: "Sintered brake pad compound.",
      price: 29, sale_price: 0, retail_price: 0, calculated_price: 29,
      inventory_level: 12, inventory_tracking: "product",
      availability: "available", is_visible: true,
      categories: [66], brand_id: 20,
      custom_url: { url: `/brake/${id}/` }, variants: [], images: [],
    });
    const fixtures = [
      brakeProduct(601, "EBC FA600HH"),
      brakeProduct(602, "EBC FA229HH"),
    ];

    (findCategoryByName as ReturnType<typeof vi.fn>).mockImplementation(
      async (name: string) => (name === "Brake Pads/Brake Shoes" ? brakeCat : null)
    );
    (getProductsByCategory as ReturnType<typeof vi.fn>).mockImplementation(
      async (id: number) => (id === 66 ? fixtures : [])
    );

    const result = await searchProducts("do you have ebc brake pads");
    const names = result.products.map((p) => p.name);
    expect(names).toContain("EBC FA600HH");
    expect(names).toContain("EBC FA229HH");
  });

  it("surfaces Sprockets products for 'show me sprockets'", async () => {
    const { findCategoryByName, getProductsByCategory } = await import("@/lib/bigcommerce/client");
    const { searchProducts } = await import("../productSearch");

    const sprocketCat = { id: 77, name: "Sprockets", parent_id: 0 };
    const sprocketProduct = (id: number, name: string) => ({
      id, name, sku: `SP-${id}`, description: "Hardened steel sprocket.",
      price: 49, sale_price: 0, retail_price: 0, calculated_price: 49,
      inventory_level: 6, inventory_tracking: "product",
      availability: "available", is_visible: true,
      categories: [77], brand_id: 30,
      custom_url: { url: `/sprockets/${id}/` }, variants: [], images: [],
    });
    const fixtures = [
      sprocketProduct(701, "Renthal 520 Rear Sprocket 48T"),
      sprocketProduct(702, "Sunstar 520 Front Sprocket 13T"),
    ];

    (findCategoryByName as ReturnType<typeof vi.fn>).mockImplementation(
      async (name: string) => (name === "Sprockets" ? sprocketCat : null)
    );
    (getProductsByCategory as ReturnType<typeof vi.fn>).mockImplementation(
      async (id: number) => (id === 77 ? fixtures : [])
    );

    const result = await searchProducts("show me sprockets");
    const names = result.products.map((p) => p.name);
    expect(names).toContain("Renthal 520 Rear Sprocket 48T");
    expect(names).toContain("Sunstar 520 Front Sprocket 13T");
  });
});

// ---------------------------------------------------------------------------
// searchProducts — snow subcategory (Layer 4)
// ---------------------------------------------------------------------------
describe("searchProducts — snow subcategory", () => {
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

  const makeProduct = (
    id: number, name: string, sku: string, catId: number, desc = ""
  ) => ({
    id, name, sku,
    description: desc,
    price: 299, sale_price: 0, retail_price: 0, calculated_price: 299,
    inventory_level: 5, inventory_tracking: "product",
    availability: "available", is_visible: true,
    categories: [catId], brand_id: 10,
    custom_url: { url: `/${sku.toLowerCase()}/` }, variants: [], images: [],
  });

  it("'do you have jackets for snowmobiling' returns Snow Jackets", async () => {
    const { findCategoryByName, getProductsByCategory } = await import("@/lib/bigcommerce/client");
    const { searchProducts } = await import("../productSearch");

    const snowJacketsCat = { id: 200, name: "Snow Jackets", parent_id: 0 };
    const fixtures = [
      makeProduct(2001, "Klim Latitude Jacket", "KL-LAT", 200, "Snowmobile jacket."),
      makeProduct(2002, "509 Range Insulated Jacket", "509-RNG", 200, "Snowmobile jacket."),
    ];

    (findCategoryByName as ReturnType<typeof vi.fn>).mockImplementation(
      async (name: string) => (name === "Snow Jackets" ? snowJacketsCat : null)
    );
    (getProductsByCategory as ReturnType<typeof vi.fn>).mockImplementation(
      async (id: number) => (id === 200 ? fixtures : [])
    );

    const result = await searchProducts("do you have jackets for snowmobiling");
    const names = result.products.map((p) => p.name);
    expect(names).toContain("Klim Latitude Jacket");
    expect(names).toContain("509 Range Insulated Jacket");
  });

  it("'snowmobile boots' returns Snow Boots", async () => {
    const { findCategoryByName, getProductsByCategory } = await import("@/lib/bigcommerce/client");
    const { searchProducts } = await import("../productSearch");

    const snowBootsCat = { id: 201, name: "Snow Boots", parent_id: 0 };
    const fixtures = [
      makeProduct(2010, "Klim Adrenaline GTX Boot", "KL-AGB", 201, "Snowmobile boot."),
      makeProduct(2011, "509 Raid Boot", "509-RAID", 201, "Snowmobile boot."),
    ];

    (findCategoryByName as ReturnType<typeof vi.fn>).mockImplementation(
      async (name: string) => (name === "Snow Boots" ? snowBootsCat : null)
    );
    (getProductsByCategory as ReturnType<typeof vi.fn>).mockImplementation(
      async (id: number) => (id === 201 ? fixtures : [])
    );

    const result = await searchProducts("snowmobile boots");
    const names = result.products.map((p) => p.name);
    expect(names).toContain("Klim Adrenaline GTX Boot");
    expect(names).toContain("509 Raid Boot");
  });

  it("'snowmobiling pants' returns Snow Pants/Bibs", async () => {
    const { findCategoryByName, getProductsByCategory } = await import("@/lib/bigcommerce/client");
    const { searchProducts } = await import("../productSearch");

    const snowPantsCat = { id: 202, name: "Snow Pants/Bibs", parent_id: 0 };
    const fixtures = [
      makeProduct(2020, "Klim Togwotee Pant", "KL-TOG", 202, "Snowmobile pant."),
      makeProduct(2021, "FXR Excursion Bib", "FXR-EXC", 202, "Snowmobile bib."),
    ];

    (findCategoryByName as ReturnType<typeof vi.fn>).mockImplementation(
      async (name: string) => (name === "Snow Pants/Bibs" ? snowPantsCat : null)
    );
    (getProductsByCategory as ReturnType<typeof vi.fn>).mockImplementation(
      async (id: number) => (id === 202 ? fixtures : [])
    );

    const result = await searchProducts("snowmobiling pants");
    const names = result.products.map((p) => p.name);
    expect(names).toContain("Klim Togwotee Pant");
    expect(names).toContain("FXR Excursion Bib");
  });

  it("'do you carry snow helmets' returns Snow Helmets", async () => {
    const { findCategoryByName, getProductsByCategory } = await import("@/lib/bigcommerce/client");
    const { searchProducts } = await import("../productSearch");

    const snowHelmetsCat = { id: 203, name: "Snow Helmets", parent_id: 0 };
    const fixtures = [
      makeProduct(2030, "Klim F5 Koroyd Helmet", "KL-F5K", 203, "Snowmobile helmet."),
      makeProduct(2031, "509 Delta V Ignite Helmet", "509-DVI", 203, "Snowmobile helmet."),
    ];

    (findCategoryByName as ReturnType<typeof vi.fn>).mockImplementation(
      async (name: string) => (name === "Snow Helmets" ? snowHelmetsCat : null)
    );
    (getProductsByCategory as ReturnType<typeof vi.fn>).mockImplementation(
      async (id: number) => (id === 203 ? fixtures : [])
    );

    const result = await searchProducts("do you carry snow helmets");
    const names = result.products.map((p) => p.name);
    expect(names).toContain("Klim F5 Koroyd Helmet");
    expect(names).toContain("509 Delta V Ignite Helmet");
  });

  it("'winter riding jacket' (NOT snow) returns adventure/street jackets — winter riding is not snowmobile gear", async () => {
    const { findCategoryByName, getProductsByCategory } = await import("@/lib/bigcommerce/client");
    const { searchProducts } = await import("../productSearch");

    const jacketsCat = { id: 210, name: "Jackets", parent_id: 0 };
    const snowJacketsCat = { id: 211, name: "Snow Jackets", parent_id: 0 };

    const streetJacket = makeProduct(2040, "Klim Latitude Street Jacket", "KL-LATS", 210, "Waterproof street touring jacket.");
    const snowJacket   = makeProduct(2041, "Klim Altitude Snowmobile Jacket", "KL-ALTSNOW", 211, "Snowmobile jacket for sled riders.");

    (findCategoryByName as ReturnType<typeof vi.fn>).mockImplementation(
      async (name: string) => {
        if (name === "Jackets") return jacketsCat;
        if (name === "Snow Jackets") return snowJacketsCat;
        return null;
      }
    );
    (getProductsByCategory as ReturnType<typeof vi.fn>).mockImplementation(
      async (id: number) => {
        if (id === 210) return [streetJacket];
        if (id === 211) return [snowJacket];
        return [];
      }
    );

    // "winter riding jacket" — "winter" alone should NOT trigger the snow subcategory
    // (snow EXPLICIT_RULES requires "snow", "snowmobile", "snowmobiling", "sled" or "sledding").
    // The query has no productType "jacket" extracted from "winter riding jacket"...
    // Actually "winter riding jacket" → productType = "jacket". subRequest = null (no snow keyword).
    // So it falls back to street-default and the "Jackets" top-level category is used.
    const result = await searchProducts("winter riding jacket");
    const names = result.products.map((p) => p.name);
    // The snow jacket should NOT appear because "Snow Jackets" is not queried
    // when the snow subcategory is not triggered.
    expect(names).toContain("Klim Latitude Street Jacket");
    expect(names).not.toContain("Klim Altitude Snowmobile Jacket");
  });

  it("'show me jackets' (ambiguous) ranks snow jackets BELOW street jackets (-50 off-street penalty)", async () => {
    const { findCategoryByName, getProductsByCategory } = await import("@/lib/bigcommerce/client");
    const { searchProducts } = await import("../productSearch");

    const jacketsCat = { id: 220, name: "Jackets", parent_id: 0 };

    const streetJacket = makeProduct(2050, "Rev'it Tornado 4 Street Jacket", "RV-T4", 220,
      "Street motorcycle jacket for urban and touring use.");
    const snowJacket   = makeProduct(2051, "Klim Latitude Snow Jacket", "KL-LATSNOW", 220,
      "Snowmobile jacket designed for sled riders in cold conditions.");

    (findCategoryByName as ReturnType<typeof vi.fn>).mockImplementation(
      async (name: string) => (name === "Jackets" ? jacketsCat : null)
    );
    (getProductsByCategory as ReturnType<typeof vi.fn>).mockImplementation(
      async (id: number) => (id === 220 ? [snowJacket, streetJacket] : [])
    );

    const result = await searchProducts("show me jackets");
    const names = result.products.map((p) => p.name);
    const streetIdx = names.indexOf("Rev'it Tornado 4 Street Jacket");
    const snowIdx   = names.indexOf("Klim Latitude Snow Jacket");

    expect(streetIdx).toBeGreaterThanOrEqual(0);
    expect(snowIdx).toBeGreaterThanOrEqual(0);
    // Snow is in OFF_STREET_SUBCATEGORIES → -50 penalty → ranks below street.
    expect(streetIdx).toBeLessThan(snowIdx);
  });
});

// ---------------------------------------------------------------------------
// searchProducts — racing subcategory + brand diversification (Layer 5)
// ---------------------------------------------------------------------------
describe("searchProducts — racing helmets + brand diversification", () => {
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

  const makeHelmet = (id: number, name: string, brandId: number, catId: number, desc = "") => ({
    id, name, sku: `H-${id}`, description: desc,
    price: 799, sale_price: 0, retail_price: 0, calculated_price: 799,
    inventory_level: 3, inventory_tracking: "product",
    availability: "available", is_visible: true,
    categories: [catId], brand_id: brandId,
    custom_url: { url: `/${name.toLowerCase().replace(/\s+/g, "-")}/` }, variants: [], images: [],
  });

  it("'what helmets do you guys carry for racing' fetches Race Helmets and returns diverse brands", async () => {
    const { findCategoryByName, getProductsByCategory } = await import("@/lib/bigcommerce/client");
    const { searchProducts } = await import("../productSearch");

    const raceCat = { id: 42, name: "Race Helmets", parent_id: 0 };

    const ARAI = 1, SHOEI = 2, HJC = 3, ALPINESTARS = 4, KYT = 5;
    const fixtures = [
      makeHelmet(3001, "Arai Corsair-X Helmet",          ARAI,        42, "FIM homologated race helmet."),
      makeHelmet(3002, "Shoei X-15 Helmet",              SHOEI,       42, "FIM homologated race helmet."),
      makeHelmet(3003, "HJC RPHA 1N Helmet",             HJC,         42, "FIM race helmet."),
      makeHelmet(3004, "Alpinestars Supertech R10 Helmet", ALPINESTARS, 42, "FIM homologated race helmet."),
      makeHelmet(3005, "KYT KX-1 Race GP Helmet",        KYT,         42, "Race GP helmet."),
      makeHelmet(3006, "KYT NZ-Race Helmet",             KYT,         42, "Track day race helmet."),
    ];

    (findCategoryByName as ReturnType<typeof vi.fn>).mockImplementation(
      async (name: string) => (name === "Race Helmets" ? raceCat : null)
    );
    (getProductsByCategory as ReturnType<typeof vi.fn>).mockImplementation(
      async (id: number) => (id === 42 ? fixtures : [])
    );

    const result = await searchProducts("what helmets do you guys carry for racing");
    const names = result.products.map((p) => p.name);

    // Race helmets category must be fetched and mixed brands must appear.
    expect(names.some((n) => n.includes("Arai") || n.includes("Shoei") || n.includes("HJC") || n.includes("Alpinestars"))).toBe(true);
    // No single brand exceeds 3 slots (diversification cap).
    const kytCount = names.filter((n) => n.includes("KYT")).length;
    expect(kytCount).toBeLessThanOrEqual(3);
  });

  it("brand diversification — pool dominated by one brand, no brand specified → max 3 per brand in top 12", async () => {
    const { findCategoryByName, getProductsByCategory } = await import("@/lib/bigcommerce/client");
    const { searchProducts } = await import("../productSearch");

    const raceCat = { id: 43, name: "Race Helmets", parent_id: 0 };

    const KYT = 10, ARAI = 11, SHOEI = 12;
    const fixtures = [
      // 5 KYT helmets first (would dominate without diversification)
      makeHelmet(3010, "KYT KX-1 Race GP",       KYT,  43, "race helmet"),
      makeHelmet(3011, "KYT NZ-Race",            KYT,  43, "race helmet"),
      makeHelmet(3012, "KYT KX-1 Race GP Blue",  KYT,  43, "race helmet"),
      makeHelmet(3013, "KYT KX-1 Race GP Red",   KYT,  43, "race helmet"),
      makeHelmet(3014, "KYT NZ-Race White",      KYT,  43, "race helmet"),
      // 5 Arai
      makeHelmet(3015, "Arai Corsair-X A",       ARAI, 43, "race helmet"),
      makeHelmet(3016, "Arai Corsair-X B",       ARAI, 43, "race helmet"),
      makeHelmet(3017, "Arai Corsair-X C",       ARAI, 43, "race helmet"),
      makeHelmet(3018, "Arai Corsair-X D",       ARAI, 43, "race helmet"),
      makeHelmet(3019, "Arai Corsair-X E",       ARAI, 43, "race helmet"),
      // 2 Shoei
      makeHelmet(3020, "Shoei X-15 A",           SHOEI, 43, "race helmet"),
      makeHelmet(3021, "Shoei X-15 B",           SHOEI, 43, "race helmet"),
    ];

    (findCategoryByName as ReturnType<typeof vi.fn>).mockImplementation(
      async (name: string) => (name === "Race Helmets" ? raceCat : null)
    );
    (getProductsByCategory as ReturnType<typeof vi.fn>).mockImplementation(
      async (id: number) => (id === 43 ? fixtures : [])
    );

    const result = await searchProducts("show me race helmets");
    const brandIds = result.products.map((p) => p.brand_id);

    // No brand should occupy more than 3 of the top 12 slots.
    const counts = new Map<number, number>();
    for (const b of brandIds) {
      counts.set(b!, (counts.get(b!) ?? 0) + 1);
    }
    Array.from(counts.values()).forEach((count) => {
      expect(count).toBeLessThanOrEqual(3);
    });
    // All three brands should be represented.
    expect(counts.has(KYT)).toBe(true);
    expect(counts.has(ARAI)).toBe(true);
    expect(counts.has(SHOEI)).toBe(true);
  });

  it("brand specified — 'show me KYT racing helmets' should NOT cap KYT", async () => {
    const { findCategoryByName, getProductsByCategory } = await import("@/lib/bigcommerce/client");
    const { searchProducts } = await import("../productSearch");

    const raceCat = { id: 44, name: "Race Helmets", parent_id: 0 };
    const kytCat  = { id: 45, name: "KYT",          parent_id: 0 };

    const KYT = 20;
    const fixtures = [
      makeHelmet(3030, "KYT KX-1 Race GP A", KYT, 44, "race helmet"),
      makeHelmet(3031, "KYT KX-1 Race GP B", KYT, 44, "race helmet"),
      makeHelmet(3032, "KYT KX-1 Race GP C", KYT, 44, "race helmet"),
      makeHelmet(3033, "KYT NZ-Race A",      KYT, 44, "race helmet"),
      makeHelmet(3034, "KYT NZ-Race B",      KYT, 44, "race helmet"),
    ];

    (findCategoryByName as ReturnType<typeof vi.fn>).mockImplementation(
      async (name: string) => {
        if (name === "Race Helmets") return raceCat;
        if (name === "kyt") return kytCat;
        return null;
      }
    );
    (getProductsByCategory as ReturnType<typeof vi.fn>).mockImplementation(
      async (id: number) => ([44, 45].includes(id) ? fixtures : [])
    );

    const result = await searchProducts("show me KYT racing helmets");
    const kytCount = result.products.filter((p) => p.brand_id === KYT).length;
    // Brand was specified → no cap → all 5 KYT helmets should appear.
    expect(kytCount).toBe(5);
  });

  it("regression: 'full face helmets' returns Street Helmets, NOT Race Helmets", async () => {
    const { findCategoryByName, getProductsByCategory } = await import("@/lib/bigcommerce/client");
    const { searchProducts } = await import("../productSearch");

    const streetCat = { id: 50, name: "Street Helmets", parent_id: 0 };
    const raceCat   = { id: 51, name: "Race Helmets",   parent_id: 0 };

    const streetHelmet = makeHelmet(3040, "Shoei RF-1400 Street Helmet", 1, 50, "Full face street helmet.");
    const raceHelmet   = makeHelmet(3041, "Arai Corsair-X Race Helmet",  2, 51, "FIM race helmet.");

    (findCategoryByName as ReturnType<typeof vi.fn>).mockImplementation(
      async (name: string) => {
        if (name === "Street Helmets") return streetCat;
        if (name === "Race Helmets")   return raceCat;
        return null;
      }
    );
    (getProductsByCategory as ReturnType<typeof vi.fn>).mockImplementation(
      async (id: number) => {
        if (id === 50) return [streetHelmet];
        if (id === 51) return [raceHelmet];
        return [];
      }
    );

    const result = await searchProducts("full face helmets");
    const names = result.products.map((p) => p.name);

    // full_face subRequest → only "Street Helmets" category fetched.
    expect(names).toContain("Shoei RF-1400 Street Helmet");
    expect(names).not.toContain("Arai Corsair-X Race Helmet");
  });

  it("regression: 'show me helmets' (ambiguous) ranks Street Helmets above Race Helmets (racing in OFF_STREET → -50 demote)", async () => {
    const { findCategoryByName, getProductsByCategory } = await import("@/lib/bigcommerce/client");
    const { searchProducts } = await import("../productSearch");

    const streetCat = { id: 60, name: "Street Helmets", parent_id: 0 };
    // No subRequest → default categories for helmet are ["Street Helmets","Race Helmets"]
    const raceCat   = { id: 61, name: "Race Helmets",   parent_id: 0 };

    const streetHelmet = makeHelmet(3050, "Bell Race Star Flex DLX", 5, 60, "Full face street sport helmet.");
    const raceHelmet   = makeHelmet(3051, "KYT KX-1 Race GP",        6, 61, "FIM race helmet.");

    (findCategoryByName as ReturnType<typeof vi.fn>).mockImplementation(
      async (name: string) => {
        if (name === "Street Helmets") return streetCat;
        if (name === "Race Helmets")   return raceCat;
        return null;
      }
    );
    (getProductsByCategory as ReturnType<typeof vi.fn>).mockImplementation(
      async (id: number) => {
        if (id === 60) return [streetHelmet];
        if (id === 61) return [raceHelmet];
        return [];
      }
    );

    const result = await searchProducts("show me helmets");
    const names = result.products.map((p) => p.name);
    const streetIdx = names.indexOf("Bell Race Star Flex DLX");
    const raceIdx   = names.indexOf("KYT KX-1 Race GP");

    expect(streetIdx).toBeGreaterThanOrEqual(0);
    expect(raceIdx).toBeGreaterThanOrEqual(0);
    // racing is in OFF_STREET_SUBCATEGORIES → -50 penalty → below street.
    expect(streetIdx).toBeLessThan(raceIdx);
  });

  it("regression: 'do you have alpinestars MX helmets' still surfaces Supertech SM-10/M10/S-M7 — brand specified so no diversification cap", async () => {
    const { findCategoryByName, getProductsByCategory } = await import("@/lib/bigcommerce/client");
    const { searchProducts } = await import("../productSearch");

    const motoHelmetsCat = { id: 30, name: "Moto Helmets",     parent_id: 0 };
    const alpineCat      = { id: 31, name: "Alpinestars",      parent_id: 0 };

    const ALPINESTARS = 6;
    const fixtures = [
      makeHelmet(3060, "Alpinestars Supertech SM-10 Helmet", ALPINESTARS, 30, "MX helmet."),
      makeHelmet(3061, "Alpinestars Supertech M10 Helmet",   ALPINESTARS, 30, "MX helmet."),
      makeHelmet(3062, "Alpinestars Supertech S-M7 Helmet",  ALPINESTARS, 30, "MX helmet."),
    ];

    (findCategoryByName as ReturnType<typeof vi.fn>).mockImplementation(
      async (name: string) => {
        if (name === "Moto Helmets") return motoHelmetsCat;
        if (name === "alpinestars")  return alpineCat;
        return null;
      }
    );
    (getProductsByCategory as ReturnType<typeof vi.fn>).mockImplementation(
      async (id: number) => ([30, 31].includes(id) ? fixtures : [])
    );

    const result = await searchProducts("do you have alpinestars MX helmets");
    const names = result.products.map((p) => p.name);

    // Brand was specified → no cap → all 3 Alpinestars helmets must appear.
    expect(names).toContain("Alpinestars Supertech SM-10 Helmet");
    expect(names).toContain("Alpinestars Supertech M10 Helmet");
    expect(names).toContain("Alpinestars Supertech S-M7 Helmet");
  });
});
