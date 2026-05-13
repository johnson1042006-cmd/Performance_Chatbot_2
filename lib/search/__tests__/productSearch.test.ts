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
