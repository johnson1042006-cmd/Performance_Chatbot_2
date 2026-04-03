import { config } from "dotenv";
config({ path: ".env.local" });

import * as XLSX from "xlsx";
import * as path from "path";

const BC_BASE = `https://api.bigcommerce.com/stores/${process.env.BIGCOMMERCE_STORE_HASH}/v3`;
const BC_TOKEN = process.env.BIGCOMMERCE_ACCESS_TOKEN!;

interface BCCategory {
  id: number;
  name: string;
  parent_id: number;
}

interface BCBrand {
  id: number;
  name: string;
}

interface BCOptionValue {
  label: string;
  option_display_name: string;
}

interface BCVariant {
  id: number;
  sku: string;
  price: number | null;
  sale_price: number | null;
  inventory_level: number;
  option_values: BCOptionValue[];
}

interface BCProduct {
  id: number;
  name: string;
  sku: string;
  price: number;
  sale_price: number;
  calculated_price: number;
  inventory_level: number;
  inventory_tracking: string;
  is_visible: boolean;
  availability: string;
  brand_id: number;
  categories: number[];
  custom_url: { url: string };
  variants?: BCVariant[];
}

async function bcGet<T>(endpoint: string, params: Record<string, string | number> = {}): Promise<T | null> {
  const url = new URL(`${BC_BASE}${endpoint}`);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, String(v));
  }

  const res = await fetch(url.toString(), {
    headers: {
      "X-Auth-Token": BC_TOKEN,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    console.error(`  API error ${res.status} for ${endpoint}`);
    return null;
  }

  const json = await res.json();
  return json.data as T;
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
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, String(v));
    }
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("page", String(page));

    const res = await fetch(url.toString(), {
      headers: {
        "X-Auth-Token": BC_TOKEN,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      console.error(`  API error ${res.status} on page ${page} for ${endpoint}`);
      break;
    }

    const json = await res.json();
    const items: T[] = json.data || [];
    all.push(...items);

    const pagination = json.meta?.pagination;
    const totalPages = pagination?.total_pages ?? 1;
    if (page >= totalPages || items.length === 0) break;
    page++;
  }

  return all;
}

async function fetchAllCategories(): Promise<BCCategory[]> {
  console.log("Fetching categories...");
  const cats = await fetchAllPages<BCCategory>("/catalog/categories");
  console.log(`  Found ${cats.length} total categories`);
  return cats;
}

async function fetchAllBrands(): Promise<Map<number, string>> {
  console.log("Fetching brands...");
  const brands = await fetchAllPages<BCBrand>("/catalog/brands");
  const map = new Map<number, string>();
  for (const b of brands) map.set(b.id, b.name);
  console.log(`  Found ${brands.length} brands`);
  return map;
}

async function fetchProductsByCategory(categoryId: number): Promise<BCProduct[]> {
  return fetchAllPages<BCProduct>("/catalog/products", {
    "categories:in": categoryId,
    include: "variants",
  });
}

function getStockStatus(level: number, tracking: string): string {
  if (tracking === "none") return "In Stock";
  if (level <= 0) return "Out of Stock";
  if (level <= 5) return "Low Stock";
  return "In Stock";
}

interface ExcelRow {
  Category: string;
  Brand: string;
  "Product Name": string;
  "Base SKU": string;
  "Colorway / Graphic": string;
  Size: string;
  "Variant SKU": string;
  Price: string;
  "Sale Price": string;
  Inventory: number | string;
  "Stock Status": string;
  URL: string;
  Visible: string;
}

function extractOptionValue(optionValues: BCOptionValue[], ...displayNames: string[]): string {
  for (const ov of optionValues) {
    const dn = ov.option_display_name.toLowerCase();
    for (const name of displayNames) {
      if (dn.includes(name)) return ov.label;
    }
  }
  return "";
}

async function exportHelmets() {
  console.log("=== Helmet Index Export ===\n");

  const [allCategories, brandMap] = await Promise.all([
    fetchAllCategories(),
    fetchAllBrands(),
  ]);

  const helmetCategories = allCategories.filter((c) =>
    c.name.toLowerCase().includes("helmet")
  );

  if (helmetCategories.length === 0) {
    console.error("No helmet categories found!");
    process.exit(1);
  }

  console.log(`\nHelmet categories found (${helmetCategories.length}):`);
  for (const c of helmetCategories) {
    console.log(`  - [${c.id}] ${c.name}`);
  }

  const seenProductIds = new Set<number>();
  const rows: ExcelRow[] = [];

  for (const cat of helmetCategories) {
    console.log(`\nFetching products for "${cat.name}"...`);
    const products = await fetchProductsByCategory(cat.id);
    console.log(`  ${products.length} products`);

    for (const p of products) {
      if (seenProductIds.has(p.id)) continue;
      seenProductIds.add(p.id);

      const brand = brandMap.get(p.brand_id) || "Unknown";
      const price = (p.calculated_price || p.price).toFixed(2);
      const salePrice = p.sale_price > 0 ? p.sale_price.toFixed(2) : "";
      const url = p.custom_url?.url
        ? `https://performancecycle.com${p.custom_url.url}`
        : "";

      const categoryName = cat.name;

      if (!p.variants || p.variants.length === 0) {
        rows.push({
          Category: categoryName,
          Brand: brand,
          "Product Name": p.name,
          "Base SKU": p.sku,
          "Colorway / Graphic": "N/A",
          Size: "N/A",
          "Variant SKU": p.sku,
          Price: price,
          "Sale Price": salePrice,
          Inventory: p.inventory_tracking === "none" ? "Not Tracked" : p.inventory_level,
          "Stock Status": getStockStatus(p.inventory_level, p.inventory_tracking),
          URL: url,
          Visible: p.is_visible ? "Yes" : "No",
        });
        continue;
      }

      for (const v of p.variants) {
        const colorway = extractOptionValue(v.option_values, "color", "colour", "graphic", "style", "design");
        const size = extractOptionValue(v.option_values, "size");
        const vPrice = v.price != null ? v.price.toFixed(2) : price;
        const vSalePrice = v.sale_price != null && v.sale_price > 0 ? v.sale_price.toFixed(2) : salePrice;

        rows.push({
          Category: categoryName,
          Brand: brand,
          "Product Name": p.name,
          "Base SKU": p.sku,
          "Colorway / Graphic": colorway || "N/A",
          Size: size || "N/A",
          "Variant SKU": v.sku || p.sku,
          Price: vPrice,
          "Sale Price": vSalePrice,
          Inventory: p.inventory_tracking === "none" ? "Not Tracked" : v.inventory_level,
          "Stock Status": getStockStatus(v.inventory_level, p.inventory_tracking),
          URL: url,
          Visible: p.is_visible ? "Yes" : "No",
        });
      }
    }
  }

  console.log(`\n--- Summary ---`);
  console.log(`Total unique products: ${seenProductIds.size}`);
  console.log(`Total rows (variants): ${rows.length}`);

  const ws = XLSX.utils.json_to_sheet(rows);

  const colWidths: Record<string, number> = {
    Category: 20,
    Brand: 18,
    "Product Name": 45,
    "Base SKU": 16,
    "Colorway / Graphic": 30,
    Size: 10,
    "Variant SKU": 18,
    Price: 10,
    "Sale Price": 10,
    Inventory: 10,
    "Stock Status": 14,
    URL: 55,
    Visible: 8,
  };
  ws["!cols"] = Object.values(colWidths).map((w) => ({ wch: w }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Helmets");

  const outPath = path.resolve(__dirname, "../helmets-index.xlsx");
  XLSX.writeFile(wb, outPath);
  console.log(`\nExported to: ${outPath}`);
}

exportHelmets()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Export failed:", err);
    process.exit(1);
  });
