import { config } from "dotenv";
config({ path: ".env.local" });

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { productColorways } from "../lib/db/schema";

const BC_BASE = `https://api.bigcommerce.com/stores/${process.env.BIGCOMMERCE_STORE_HASH}/v3`;
const BC_TOKEN = process.env.BIGCOMMERCE_ACCESS_TOKEN!;

interface BCCategory { id: number; name: string; parent_id: number }
interface BCBrand { id: number; name: string }
interface BCOptionValue { label: string; option_display_name: string }
interface BCVariant {
  id: number;
  sku: string;
  price: number | null;
  option_values: BCOptionValue[];
}
interface BCProduct {
  id: number;
  name: string;
  sku: string;
  price: number;
  calculated_price: number;
  is_visible: boolean;
  brand_id: number;
  categories: number[];
  custom_url: { url: string };
  variants?: BCVariant[];
}

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

function extractColorway(optionValues: BCOptionValue[]): string {
  for (const ov of optionValues) {
    const dn = ov.option_display_name.toLowerCase();
    if (dn.includes("color") || dn.includes("colour") || dn.includes("graphic") || dn.includes("style") || dn.includes("design")) {
      return ov.label;
    }
  }
  return "";
}

async function seedColorways() {
  console.log("=== Seed Product Colorways ===\n");

  const sql = neon(process.env.DATABASE_URL!);
  const db = drizzle(sql);

  const [allCategories, allBrands] = await Promise.all([
    fetchAllPages<BCCategory>("/catalog/categories").then((cats) => {
      console.log(`  Found ${cats.length} categories`);
      return cats;
    }),
    fetchAllPages<BCBrand>("/catalog/brands").then((brands) => {
      const map = new Map<number, string>();
      for (const b of brands) map.set(b.id, b.name);
      console.log(`  Found ${brands.length} brands`);
      return map;
    }),
  ]);

  const productCategories = allCategories.filter((c) => c.parent_id !== 0);
  console.log(`\nProduct categories: ${productCategories.length}`);

  const seenProductIds = new Set<number>();
  const rows: {
    bcProductId: number;
    productName: string;
    category: string;
    brand: string | null;
    colorway: string;
    colorwayLower: string;
    baseSku: string | null;
    price: string | null;
    url: string | null;
  }[] = [];

  for (const cat of productCategories) {
    console.log(`  Fetching "${cat.name}"...`);
    const products = await fetchAllPages<BCProduct>("/catalog/products", {
      "categories:in": cat.id,
      include: "variants",
    });

    for (const p of products) {
      if (seenProductIds.has(p.id)) continue;
      seenProductIds.add(p.id);

      const brand = allBrands.get(p.brand_id) || null;
      const price = (p.calculated_price || p.price)?.toString() ?? null;
      const url = p.custom_url?.url
        ? `https://performancecycle.com${p.custom_url.url}`
        : null;

      if (!p.variants || p.variants.length === 0) {
        rows.push({
          bcProductId: p.id,
          productName: p.name,
          category: cat.name,
          brand,
          colorway: "N/A",
          colorwayLower: "n/a",
          baseSku: p.sku,
          price,
          url,
        });
        continue;
      }

      const seenColorways = new Set<string>();
      for (const v of p.variants) {
        const colorway = extractColorway(v.option_values) || "N/A";
        const key = colorway.toLowerCase();
        if (seenColorways.has(key)) continue;
        seenColorways.add(key);

        rows.push({
          bcProductId: p.id,
          productName: p.name,
          category: cat.name,
          brand,
          colorway,
          colorwayLower: key,
          baseSku: p.sku,
          price,
          url,
        });
      }
    }
  }

  console.log(`\nTotal unique products: ${seenProductIds.size}`);
  console.log(`Total colorway rows: ${rows.length}`);

  await db.delete(productColorways);
  console.log("Cleared existing product_colorways data");

  const BATCH_SIZE = 500;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    await db.insert(productColorways).values(batch);
    inserted += batch.length;
    console.log(`  Inserted ${inserted}/${rows.length}`);
  }

  console.log(`\nDone. ${inserted} colorway rows seeded.`);
}

seedColorways()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  });
