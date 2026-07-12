/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, vi } from "vitest";

// Regression coverage for the color-search behavior fix (Jacob #1). Proves the
// density-collapse case ("green jacket" returned 1 of N before) is fixed by
// color-driven retrieval + pre-truncation color-first selection, and that the
// don't-pad / zero-match-fallback / live-reconciliation rules hold.

const client = {
  searchProductsBC: vi.fn().mockResolvedValue([]),
  getProductBySKU: vi.fn().mockResolvedValue(null),
  getProductByNameLike: vi.fn().mockResolvedValue([]),
  getProductById: vi.fn().mockResolvedValue(null),
  getProductsByCategory: vi.fn().mockResolvedValue([]),
  getProductsByIds: vi.fn().mockResolvedValue([]),
  findCategoryByName: vi.fn().mockResolvedValue(null),
};
vi.mock("@/lib/bigcommerce/client", () => client);

const findColorwayProductIds = vi.fn().mockResolvedValue([]);
vi.mock("../colorwayIndex", () => ({ findColorwayProductIds }));

vi.mock("../localCatalogSearch", () => ({ searchLocalCatalog: vi.fn().mockResolvedValue([]) }));
vi.mock("@/lib/db", () => ({ db: { execute: vi.fn().mockResolvedValue([]) } }));
vi.mock("@/lib/db/schema", () => ({ productColorways: {} }));

// Neutralize subcategory classification (does category-map I/O otherwise).
vi.mock("../subcategory", () => ({
  classifyProductSubcategory: vi.fn(),
  classifyProductSubcategoryWithSource: vi.fn().mockResolvedValue({ value: null, source: "text" }),
  extractSubcategoryRequest: vi.fn().mockReturnValue(null),
  isSupportedProductType: (t: string) =>
    ["helmet", "jacket", "boots", "gloves", "pants", "tire", "suit"].includes(t),
  OFF_STREET_SUBCATEGORIES: new Set<string>(),
}));

type Over = Partial<any>;
function prod(id: number, name: string, brandId: number, colorLabel: string | null, over: Over = {}): any {
  return {
    id, name, sku: `SKU-${id}`, description: "",
    price: 300, sale_price: 0, retail_price: 0, calculated_price: 300,
    inventory_level: 5, inventory_tracking: "product", availability: "available",
    is_visible: true, categories: [1], brand_id: brandId,
    custom_url: { url: `/p/${id}/` }, images: [],
    variants: colorLabel
      ? [{ option_values: [
            { label: colorLabel, option_display_name: "Color" },
            { label: "M", option_display_name: "Size" },
          ] }]
      : [{ option_values: [{ label: "M", option_display_name: "Size" }] }],
    ...over,
  };
}

async function load() {
  const { searchProducts } = await import("../productSearch");
  return searchProducts;
}

beforeEach(() => {
  vi.clearAllMocks();
  client.searchProductsBC.mockResolvedValue([]);
  client.getProductByNameLike.mockResolvedValue([]);
  client.getProductsByCategory.mockResolvedValue([]);
  client.getProductsByIds.mockResolvedValue([]);
  client.findCategoryByName.mockResolvedValue(null);
  findColorwayProductIds.mockResolvedValue([]);
});

describe("color-driven retrieval — density collapse fix", () => {
  it("returns ALL color-matching jackets from the index, not just the one that survived scoring", async () => {
    // The category source returns non-green filler jackets (what the old
    // pipeline scored & truncated); the color index supplies the green ones.
    client.findCategoryByName.mockResolvedValue({ id: 1, name: "Jackets", parent_id: 0 });
    client.getProductsByCategory.mockResolvedValue([
      prod(900, "Black Textile Jacket", 1, "Black"),
      prod(901, "Grey Mesh Jacket", 2, "Grey"),
    ]);
    const greenJackets = [
      prod(801, "Fox Ridgeway Jacket", 11, "Olive Green"),
      prod(802, "Klim Carlsbad Jacket", 12, "Oil Green"),
      prod(803, "REV'IT Neptune Jacket", 13, "Black/Dark Green"),
      prod(804, "Alpinestars Chrome Jacket", 14, "Black/Green"),
    ];
    findColorwayProductIds.mockResolvedValue([801, 802, 803, 804]);
    client.getProductsByIds.mockResolvedValue(greenJackets);

    const searchProducts = await load();
    const { products, detectedColor } = await searchProducts("green jacket");

    expect(detectedColor).toBe("green");
    // All four greens returned; none of the non-green fillers padded in.
    const names = products.map((p) => p.name).sort();
    expect(names).toEqual([
      "Alpinestars Chrome Jacket",
      "Fox Ridgeway Jacket",
      "Klim Carlsbad Jacket",
      "REV'IT Neptune Jacket",
    ]);
    expect(findColorwayProductIds).toHaveBeenCalledWith(
      "green",
      expect.objectContaining({ typeTerms: expect.any(Array) })
    );
  });

  it("does NOT pad thin color results with off-color fillers", async () => {
    client.findCategoryByName.mockResolvedValue({ id: 1, name: "Jackets", parent_id: 0 });
    client.getProductsByCategory.mockResolvedValue([
      prod(900, "Black Textile Jacket", 1, "Black"),
      prod(901, "Grey Mesh Jacket", 2, "Grey"),
      prod(902, "Red Sport Jacket", 3, "Red"),
    ]);
    findColorwayProductIds.mockResolvedValue([801]);
    client.getProductsByIds.mockResolvedValue([prod(801, "Klim Carlsbad Jacket", 12, "Oil Green")]);

    const searchProducts = await load();
    const { products } = await searchProducts("green jacket");
    expect(products).toHaveLength(1);
    expect(products[0].name).toBe("Klim Carlsbad Jacket");
  });
});

describe("color-driven retrieval — reconciliation & fallback", () => {
  it("drops a stale index candidate whose LIVE variants no longer offer the color", async () => {
    // The index says 801 & 805 are green, but live data for 805 has only black
    // variants (stale colorway row) — it must not appear.
    findColorwayProductIds.mockResolvedValue([801, 805]);
    client.getProductsByIds.mockResolvedValue([
      prod(801, "Fox Ridgeway Jacket", 11, "Olive Green"),
      prod(805, "Stale Jacket", 15, "Black"), // live: no green
    ]);
    const searchProducts = await load();
    const { products } = await searchProducts("green jacket");
    expect(products.map((p) => p.name)).toEqual(["Fox Ridgeway Jacket"]);
  });

  it("falls back to type results (never hard-empty) when nothing offers the color", async () => {
    client.findCategoryByName.mockResolvedValue({ id: 1, name: "Jackets", parent_id: 0 });
    client.getProductsByCategory.mockResolvedValue([
      prod(900, "Black Textile Jacket", 1, "Black"),
      prod(901, "Grey Mesh Jacket", 2, "Grey"),
    ]);
    findColorwayProductIds.mockResolvedValue([]); // no green in the index
    const searchProducts = await load();
    const { products } = await searchProducts("green jacket");
    // No green exists, but we still return jackets rather than an empty list.
    expect(products.length).toBeGreaterThan(0);
    expect(products.every((p) => p.name.toLowerCase().includes("jacket"))).toBe(true);
  });
});

describe("color-driven retrieval — non-regression", () => {
  it("blue helmet still returns blue helmets", async () => {
    const blueHelmets = [
      prod(701, "Shoei RF-1400 Helmet", 21, "Matte Blue"),
      prod(702, "Arai Quantum Helmet", 22, "Blue"),
      prod(703, "AGV K6 Helmet", 23, "Blue/Black"),
    ];
    findColorwayProductIds.mockResolvedValue([701, 702, 703]);
    client.getProductsByIds.mockResolvedValue(blueHelmets);
    const searchProducts = await load();
    const { products, detectedColor } = await searchProducts("blue helmet");
    expect(detectedColor).toBe("blue");
    expect(products.map((p) => p.name).sort()).toEqual([
      "AGV K6 Helmet",
      "Arai Quantum Helmet",
      "Shoei RF-1400 Helmet",
    ]);
  });
});
