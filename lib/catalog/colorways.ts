/**
 * Build + persist product_colorways rows from BigCommerce product data.
 *
 * buildColorwayRows is PURE (no env, no db) so it can run in the cron, the seed
 * script (which loads dotenv at runtime), and unit tests without import-time
 * side effects. Color-option identification is shared with the live search path
 * via lib/search/colorOptions, so the index and the runtime matcher agree.
 */
import { db } from "@/lib/db";
import { productColorways } from "@/lib/db/schema";
import type { BCProduct } from "@/lib/bigcommerce/client";
import {
  identifyColorOptionNames,
  colorLabelForVariant,
} from "@/lib/search/colorOptions";

export interface ColorwayRow {
  bcProductId: number;
  productName: string;
  category: string;
  brand: string | null;
  colorway: string;
  colorwayLower: string;
  baseSku: string | null;
  price: string | null;
  url: string | null;
}

/**
 * One row per (product, distinct colorway). Products with no variants — or no
 * identifiable color option — get a single "N/A" row so the product is still
 * represented. Visible products only, matching the live search pool.
 */
export function buildColorwayRows(
  products: BCProduct[],
  brandById: Map<number, string>,
  categoryById: Map<number, string>
): ColorwayRow[] {
  const rows: ColorwayRow[] = [];
  const seenProductIds = new Set<number>();

  for (const p of products) {
    if (!p.is_visible) continue;
    if (seenProductIds.has(p.id)) continue;
    seenProductIds.add(p.id);

    const brand = p.brand_id ? brandById.get(p.brand_id) ?? null : null;
    const category =
      (p.categories ?? [])
        .map((id) => categoryById.get(id))
        .find((n): n is string => !!n) ?? "Uncategorized";
    const price = (p.calculated_price || p.price)?.toString() ?? null;
    const url = p.custom_url?.url
      ? `https://performancecycle.com${p.custom_url.url}`
      : null;
    const base = {
      bcProductId: p.id,
      productName: p.name,
      category,
      brand,
      baseSku: p.sku || null,
      price,
      url,
    };

    const variants = p.variants ?? [];
    if (variants.length === 0) {
      rows.push({ ...base, colorway: "N/A", colorwayLower: "n/a" });
      continue;
    }

    const colorOptionNames = identifyColorOptionNames(variants);
    const seen = new Set<string>();
    for (const v of variants) {
      const colorway =
        colorLabelForVariant(v.option_values ?? [], colorOptionNames) || "N/A";
      const key = colorway.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({ ...base, colorway, colorwayLower: key });
    }
  }

  return rows;
}

/** Replace product_colorways with a fresh set of rows (delete-then-batch-insert). */
export async function rebuildProductColorways(rows: ColorwayRow[]): Promise<number> {
  await db.delete(productColorways);
  const BATCH = 500;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    await db.insert(productColorways).values(rows.slice(i, i + BATCH));
    inserted += Math.min(BATCH, rows.length - i);
  }
  return inserted;
}
