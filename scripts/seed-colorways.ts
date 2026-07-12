import { config } from "dotenv";
config({ path: ".env.local" });

import {
  buildColorwayRows,
  rebuildProductColorways,
} from "../lib/catalog/colorways";
import type { BCProduct } from "../lib/bigcommerce/client";

const BC_BASE = `https://api.bigcommerce.com/stores/${process.env.BIGCOMMERCE_STORE_HASH}/v3`;
const BC_TOKEN = process.env.BIGCOMMERCE_ACCESS_TOKEN!;

interface BCCategory { id: number; name: string; parent_id: number }
interface BCBrand { id: number; name: string }

async function fetchAllPages<T>(
  endpoint: string,
  params: Record<string, string | number> = {},
  limit = 250
): Promise<T[]> {
  const all: T[] = [];
  let page = 1;
  while (true) {
    const url = new URL(`${BC_BASE}${endpoint}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("page", String(page));

    const res = await fetch(url.toString(), {
      headers: { "X-Auth-Token": BC_TOKEN, "Content-Type": "application/json", Accept: "application/json" },
    });
    if (!res.ok) { console.error(`  API error ${res.status} on page ${page} for ${endpoint}`); break; }

    const json = await res.json();
    const items: T[] = json.data || [];
    all.push(...items);

    const totalPages = json.meta?.pagination?.total_pages ?? 1;
    if (page >= totalPages || items.length === 0) break;
    page++;
  }
  return all;
}

/**
 * Rebuild product_colorways from the full BigCommerce catalog. Row-building
 * (color-option identification) is shared with the catalog-refresh cron via
 * lib/catalog/colorways.buildColorwayRows so the two never drift.
 */
async function seedColorways() {
  console.log("=== Seed Product Colorways ===\n");

  const [categories, brands] = await Promise.all([
    fetchAllPages<BCCategory>("/catalog/categories"),
    fetchAllPages<BCBrand>("/catalog/brands"),
  ]);
  const categoryById = new Map<number, string>();
  for (const c of categories) categoryById.set(c.id, c.name);
  const brandById = new Map<number, string>();
  for (const b of brands) brandById.set(b.id, b.name);
  console.log(`  ${categories.length} categories, ${brands.length} brands`);

  const products = await fetchAllPages<BCProduct>("/catalog/products", {
    include: "variants",
  });
  console.log(`  ${products.length} products fetched`);

  const rows = buildColorwayRows(products, brandById, categoryById);
  console.log(`  ${rows.length} colorway rows built`);

  const inserted = await rebuildProductColorways(rows);
  console.log(`\nDone. ${inserted} colorway rows seeded.`);
}

seedColorways()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  });
