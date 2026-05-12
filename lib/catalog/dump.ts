/**
 * Core catalog-dump logic, extracted from scripts/dump-catalog.ts so it can
 * be called by both the CLI script (npm run dump:catalog) and the nightly
 * cron handler (app/api/cron/catalog-refresh/route.ts).
 *
 * No file I/O, no process.stdout.write — safe for serverless contexts.
 */

import {
  getBrands,
  getCategories,
  type BCProduct,
} from "@/lib/bigcommerce/client";

import {
  classifyBroadCategory,
  classifyBroadSubcategory,
} from "@/lib/catalog/classify";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ProductEntry {
  id: number;
  name: string;
  sku: string | null;
  url: string;
  brand: string | null;
  categories: string[];
  price: number;
  inStock: boolean;
  totalInventory: number;
  variantCount: number;
}

export interface DumpResult {
  generatedAt: string;
  totalProducts: number;
  products: ProductEntry[];
  /** brand → productType → subcategory → product names[] */
  tree: Record<string, Record<string, Record<string, string[]>>>;
  /** productType → sorted brand names[] */
  brandsByCategory: Record<string, string[]>;
}

// ---------------------------------------------------------------------------
// Internal: full-catalog paginator
// ---------------------------------------------------------------------------

const BC_BASE = `https://api.bigcommerce.com/stores/${process.env.BIGCOMMERCE_STORE_HASH}/v3`;

async function fetchAllProducts(): Promise<BCProduct[]> {
  const all: BCProduct[] = [];
  let page = 1;
  const limit = 250;

  while (true) {
    const url = `${BC_BASE}/catalog/products?limit=${limit}&page=${page}&include=variants`;
    const res = await fetch(url, {
      headers: {
        "X-Auth-Token": process.env.BIGCOMMERCE_ACCESS_TOKEN!,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      throw new Error(
        `BC API error on page ${page}: ${res.status} ${res.statusText}`
      );
    }

    const json = await res.json();
    const products: BCProduct[] = json.data ?? [];
    all.push(...products);

    const pagination = json.meta?.pagination;
    const hasMore = pagination
      ? page < pagination.total_pages
      : products.length === limit;
    if (!hasMore) break;
    page++;
  }

  return all;
}

// ---------------------------------------------------------------------------
// Public: dumpCatalog
// ---------------------------------------------------------------------------

/**
 * Fetch the entire BigCommerce catalog, resolve brand/category names, and
 * classify each product into a broad type and subcategory.
 *
 * Returns the same shape as tmp/catalog-dump.json so the result can be passed
 * directly to buildSkeletonFromDump() or serialised to disk by the CLI script.
 */
export async function dumpCatalog(): Promise<DumpResult> {
  const [rawBrands, rawCategories] = await Promise.all([
    getBrands(),
    getCategories(),
  ]);

  const brandById = new Map<number, string>();
  for (const b of rawBrands) brandById.set(b.id, b.name);

  const categoryById = new Map<number, string>();
  for (const c of rawCategories) categoryById.set(c.id, c.name);

  const rawProducts = await fetchAllProducts();

  // -------------------------------------------------------------------------
  // Build flat product list
  // -------------------------------------------------------------------------

  const products: ProductEntry[] = rawProducts.map((p) => {
    const noTracking = p.inventory_tracking === "none";
    const variants = p.variants ?? [];

    let totalInventory: number;
    if (noTracking) {
      totalInventory = -1; // -1 signals "unlimited / not tracked"
    } else if (variants.length > 0) {
      totalInventory = variants.reduce(
        (sum, v) => sum + (v.inventory_level ?? 0),
        0
      );
    } else {
      totalInventory = p.inventory_level ?? 0;
    }

    const inStock = noTracking || totalInventory > 0;
    const url = p.custom_url?.url
      ? `https://performancecycle.com${p.custom_url.url}`
      : "";

    return {
      id: p.id,
      name: p.name,
      sku: p.sku || null,
      url,
      brand: p.brand_id ? (brandById.get(p.brand_id) ?? null) : null,
      categories: (p.categories ?? [])
        .map((id) => categoryById.get(id))
        .filter((n): n is string => !!n),
      price: p.sale_price || p.calculated_price || p.price,
      inStock,
      totalInventory,
      variantCount: variants.length,
    };
  });

  // -------------------------------------------------------------------------
  // Build tree: brand → productType → subcategory → name[]
  // -------------------------------------------------------------------------

  const tree: Record<string, Record<string, Record<string, string[]>>> = {};

  for (let i = 0; i < rawProducts.length; i++) {
    const raw = rawProducts[i];
    const entry = products[i];

    // Category-name-based classification — NOT product name — prevents Bug C
    // (comm products with "Helmet" in the name being misrouted to "helmet").
    const productType = classifyBroadCategory({
      name: entry.name,
      categories: entry.categories,
      brand: entry.brand,
    });
    const subcategory = classifyBroadSubcategory(
      { name: entry.name, categories: entry.categories },
      productType
    );

    const brand = entry.brand ?? "Unknown";

    if (!tree[brand]) tree[brand] = {};
    if (!tree[brand][productType]) tree[brand][productType] = {};
    if (!tree[brand][productType][subcategory])
      tree[brand][productType][subcategory] = [];

    tree[brand][productType][subcategory].push(raw.name);
  }

  // -------------------------------------------------------------------------
  // Build brandsByCategory: productType → sorted brand names[]
  // -------------------------------------------------------------------------

  const brandsByCategoryMap: Record<string, Set<string>> = {};
  for (const [brand, types] of Object.entries(tree)) {
    for (const productType of Object.keys(types)) {
      if (!brandsByCategoryMap[productType])
        brandsByCategoryMap[productType] = new Set();
      brandsByCategoryMap[productType].add(brand);
    }
  }

  const brandsByCategory: Record<string, string[]> = {};
  for (const [key, set] of Object.entries(brandsByCategoryMap)) {
    brandsByCategory[key] = [...set].sort();
  }

  return {
    generatedAt: new Date().toISOString(),
    totalProducts: products.length,
    products,
    tree,
    brandsByCategory,
  };
}
