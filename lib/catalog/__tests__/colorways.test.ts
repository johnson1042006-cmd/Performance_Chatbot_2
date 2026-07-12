import { describe, it, expect } from "vitest";
import { buildColorwayRows } from "../colorways";
import type { BCProduct } from "@/lib/bigcommerce/client";

const brandById = new Map<number, string>([[10, "Shoei"]]);
const categoryById = new Map<number, string>([[5, "Street Helmets"]]);

function product(over: Partial<BCProduct>): BCProduct {
  return {
    id: 1,
    name: "Test Helmet",
    sku: "SKU-1",
    description: "",
    price: 100,
    sale_price: 0,
    retail_price: 0,
    calculated_price: 100,
    inventory_level: 5,
    inventory_tracking: "product",
    availability: "available",
    is_visible: true,
    categories: [5],
    brand_id: 10,
    custom_url: { url: "/p/1/" },
    variants: [],
    ...over,
  } as BCProduct;
}

describe("buildColorwayRows", () => {
  it("emits one row per distinct colorway, resolving brand/category", () => {
    const rows = buildColorwayRows(
      [
        product({
          id: 12280,
          name: "Shoei RF-1400 Helmet",
          variants: [
            { option_values: [{ label: "Matte Blue", option_display_name: "Color" }, { label: "M", option_display_name: "Size" }] },
            { option_values: [{ label: "Matte Blue", option_display_name: "Color" }, { label: "L", option_display_name: "Size" }] },
            { option_values: [{ label: "Gloss Black", option_display_name: "Color" }, { label: "M", option_display_name: "Size" }] },
          ],
        } as Partial<BCProduct>),
      ],
      brandById,
      categoryById
    );
    // Two distinct colorways (Matte Blue deduped across sizes).
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.colorway).sort()).toEqual(["Gloss Black", "Matte Blue"]);
    expect(rows[0].brand).toBe("Shoei");
    expect(rows[0].category).toBe("Street Helmets");
    expect(rows[0].colorwayLower).toBe(rows[0].colorway.toLowerCase());
    expect(rows[0].url).toBe("https://performancecycle.com/p/1/");
  });

  it("emits a single N/A row for a product with no variants", () => {
    const rows = buildColorwayRows([product({ id: 2, variants: [] })], brandById, categoryById);
    expect(rows).toHaveLength(1);
    expect(rows[0].colorway).toBe("N/A");
    expect(rows[0].colorwayLower).toBe("n/a");
  });

  it("emits N/A when variants have no identifiable color option (size only)", () => {
    const rows = buildColorwayRows(
      [product({ id: 3, variants: [{ option_values: [{ label: "M", option_display_name: "Size" }] }] } as Partial<BCProduct>)],
      brandById,
      categoryById
    );
    expect(rows.map((r) => r.colorway)).toEqual(["N/A"]);
  });

  it("excludes non-visible products", () => {
    const rows = buildColorwayRows([product({ id: 4, is_visible: false })], brandById, categoryById);
    expect(rows).toHaveLength(0);
  });

  it("dedupes repeated product ids and falls back to Uncategorized/null brand", () => {
    const p = product({ id: 5, brand_id: 999, categories: [999], variants: [] });
    const rows = buildColorwayRows([p, p], brandById, categoryById);
    expect(rows).toHaveLength(1);
    expect(rows[0].brand).toBeNull();
    expect(rows[0].category).toBe("Uncategorized");
  });
});
