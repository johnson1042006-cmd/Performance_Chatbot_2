function getBaseUrl() {
  return `https://api.bigcommerce.com/stores/${process.env.BIGCOMMERCE_STORE_HASH}/v3`;
}

function getV2BaseUrl() {
  return `https://api.bigcommerce.com/stores/${process.env.BIGCOMMERCE_STORE_HASH}/v2`;
}

interface BCRequestOptions {
  path: string;
  params?: Record<string, string | number>;
}

/**
 * Wrap a fetch-returning thunk so any throw or non-OK response collapses to
 * `null`. Used by both the v3 and v2 BigCommerce fetchers — every public
 * fetcher in this module returns `T | null`, never throws, so callers can
 * branch on the absence value without try/catch noise at every call site.
 */
async function safeFetch<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (error) {
    console.error("BigCommerce safeFetch error:", error);
    return null;
  }
}

async function bcFetch<T>(options: BCRequestOptions): Promise<T | null> {
  return safeFetch<T>(async () => {
    const url = new URL(`${getBaseUrl()}${options.path}`);
    if (options.params) {
      for (const [key, value] of Object.entries(options.params)) {
        url.searchParams.set(key, String(value));
      }
    }

    const res = await fetch(url.toString(), {
      headers: {
        "X-Auth-Token": process.env.BIGCOMMERCE_ACCESS_TOKEN!,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      next: { revalidate: 60 },
    });

    if (!res.ok) {
      console.error(`BigCommerce v3 API error: ${res.status} ${res.statusText} for ${options.path}`);
      // safeFetch returns null when this throws.
      throw new Error(`bc_v3_${res.status}`);
    }

    const json = await res.json();
    return json.data as T;
  });
}

/**
 * BC v2 fetcher. Differences from v3:
 *  - Different base path (.../v2 vs .../v3).
 *  - Response body IS the array/object directly (no `{ data }` envelope).
 *  - 204 No Content is a normal response when a collection is empty
 *    (e.g. `/orders/{id}/shipments` for an order with no shipments yet) —
 *    we surface that as `null` so callers can `?? []`.
 *  - 30-second Next.js cache hint (vs v3's 60s) — order data changes faster
 *    than catalog data, but caching at all keeps a customer who reloads
 *    the same lookup from re-hitting BC.
 */
async function bcFetchV2<T>(options: BCRequestOptions): Promise<T | null> {
  return safeFetch<T>(async () => {
    const url = new URL(`${getV2BaseUrl()}${options.path}`);
    if (options.params) {
      for (const [key, value] of Object.entries(options.params)) {
        url.searchParams.set(key, String(value));
      }
    }

    const res = await fetch(url.toString(), {
      headers: {
        "X-Auth-Token": process.env.BIGCOMMERCE_ACCESS_TOKEN!,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      next: { revalidate: 30 },
    });

    if (res.status === 204) return null as unknown as T;

    if (!res.ok) {
      console.error(`BigCommerce v2 API error: ${res.status} ${res.statusText} for ${options.path}`);
      throw new Error(`bc_v2_${res.status}`);
    }

    return (await res.json()) as T;
  });
}

export interface BCProduct {
  id: number;
  name: string;
  sku: string;
  description: string;
  price: number;
  sale_price: number;
  retail_price: number;
  calculated_price: number;
  inventory_level: number;
  inventory_tracking: string;
  availability: string;
  is_visible: boolean;
  categories: number[];
  brand_id: number;
  custom_url: { url: string };
  images?: BCImage[];
  variants?: BCVariant[];
}

export interface BCImage {
  id: number;
  url_standard: string;
  url_thumbnail: string;
  description: string;
  is_thumbnail: boolean;
}

export interface BCVariant {
  id: number;
  product_id: number;
  sku: string;
  price: number | null;
  sale_price: number | null;
  inventory_level: number;
  option_values: { label: string; option_display_name: string }[];
}

export interface BCCategory {
  id: number;
  name: string;
  description: string;
  parent_id: number;
}

export interface BCBrand {
  id: number;
  name: string;
}

// --- Core product fetchers ---

export async function getProductByKeyword(keyword: string, limit = 25): Promise<BCProduct[]> {
  const results = await bcFetch<BCProduct[]>({
    path: "/catalog/products",
    params: {
      keyword,
      is_visible: 1,
      include: "variants,images",
      limit,
    },
  });
  return results || [];
}

export async function getProductByNameLike(name: string, limit = 25): Promise<BCProduct[]> {
  const results = await bcFetch<BCProduct[]>({
    path: "/catalog/products",
    params: {
      "name:like": name,
      is_visible: 1,
      include: "variants,images",
      limit,
    },
  });
  return results || [];
}

export async function getProductBySKU(sku: string): Promise<BCProduct | null> {
  const results = await bcFetch<BCProduct[]>({
    path: "/catalog/products",
    params: {
      sku,
      include: "variants,images",
      limit: 1,
    },
  });
  return results?.[0] || null;
}

export async function getProductById(id: number): Promise<BCProduct | null> {
  return bcFetch<BCProduct>({
    path: `/catalog/products/${id}`,
    params: { include: "variants,images" },
  });
}

export async function getProductsByCategory(categoryId: number, limit = 25): Promise<BCProduct[]> {
  const results = await bcFetch<BCProduct[]>({
    path: "/catalog/products",
    params: {
      "categories:in": categoryId,
      is_visible: 1,
      include: "variants,images",
      limit,
    },
  });
  return results || [];
}

/**
 * Batch-fetch products by id (BC v3 `id:in`). Used to pull live data for the
 * color-index candidates in one request. Capped at 250 (BC's page max); callers
 * (findColorwayProductIds) cap well below that.
 */
export async function getProductsByIds(ids: number[]): Promise<BCProduct[]> {
  if (ids.length === 0) return [];
  const results = await bcFetch<BCProduct[]>({
    path: "/catalog/products",
    params: {
      "id:in": ids.slice(0, 250).join(","),
      is_visible: 1,
      include: "variants,images",
      limit: Math.min(250, ids.length),
    },
  });
  return results || [];
}

export async function getProductsByBrand(brandId: number, limit = 25): Promise<BCProduct[]> {
  const results = await bcFetch<BCProduct[]>({
    path: "/catalog/products",
    params: {
      brand_id: brandId,
      is_visible: 1,
      include: "variants,images",
      limit,
    },
  });
  return results || [];
}

// --- Brand search ---

export async function getBrands(): Promise<BCBrand[]> {
  const allBrands: BCBrand[] = [];
  let page = 1;
  const limit = 250;
  while (true) {
    const results = await bcFetch<BCBrand[]>({
      path: "/catalog/brands",
      params: { limit, page },
    });
    if (!results || results.length === 0) break;
    allBrands.push(...results);
    if (results.length < limit) break;
    page++;
  }
  return allBrands;
}

let _brandCache: BCBrand[] | null = null;
let _brandCacheTime = 0;
const BRAND_CACHE_TTL = 5 * 60 * 1000;

async function getCachedBrands(): Promise<BCBrand[]> {
  if (_brandCache && Date.now() - _brandCacheTime < BRAND_CACHE_TTL) {
    return _brandCache;
  }
  _brandCache = await getBrands();
  _brandCacheTime = Date.now();
  return _brandCache;
}

export async function findBrandByName(name: string): Promise<BCBrand | null> {
  const brands = await getCachedBrands();
  const lower = name.toLowerCase();
  return brands.find((b) => b.name.toLowerCase() === lower)
    || brands.find((b) => b.name.toLowerCase().includes(lower))
    || brands.find((b) => lower.includes(b.name.toLowerCase()))
    || null;
}

// --- Inventory ---

export async function checkInventory(productId: number): Promise<{
  inStock: boolean;
  quantity: number;
  status: "in_stock" | "low_stock" | "out_of_stock";
}> {
  const product = await getProductById(productId);
  if (!product) {
    return { inStock: false, quantity: 0, status: "out_of_stock" };
  }

  const qty = product.inventory_level;
  const noTracking = product.inventory_tracking === "none";
  let status: "in_stock" | "low_stock" | "out_of_stock";
  if (noTracking) status = "in_stock";
  else if (qty <= 0) status = "out_of_stock";
  else if (qty <= 5) status = "low_stock";
  else status = "in_stock";

  return { inStock: noTracking || qty > 0, quantity: noTracking ? -1 : qty, status };
}

export async function getProductVariants(productId: number): Promise<BCVariant[]> {
  const results = await bcFetch<BCVariant[]>({
    path: `/catalog/products/${productId}/variants`,
    params: { limit: 50 },
  });
  return results || [];
}

// --- Combined smart search ---

export async function searchProductsBC(query: string): Promise<BCProduct[]> {
  const deduped = new Map<number, BCProduct>();

  function addResults(products: BCProduct[]) {
    for (const p of products) {
      if (p.is_visible && p.availability !== "disabled" && !deduped.has(p.id)) {
        deduped.set(p.id, p);
      }
    }
  }

  // 1. Keyword search (searches name + description + sku)
  const keywordResults = await getProductByKeyword(query);
  addResults(keywordResults);

  // 2. Known-model name:like lookup — direct match for model tokens that
  //    BigCommerce keyword indexing may not surface (e.g. "x-fifteen", "s-r7").
  const KNOWN_MODELS = [
    "x-15", "s-r7", "corsair-x", "nz-race",
    "rf-1400", "rf-sr", "contour-x", "quantum-x", "kx-1", "r2r",
  ];
  const queryLower = query.toLowerCase();
  for (const model of KNOWN_MODELS) {
    if (queryLower.includes(model)) {
      const modelResults = await getProductByNameLike(model);
      addResults(modelResults);
    }
  }

  // 3. Brand search — collect ALL brand matches, then search each (cap at 3).
  //    Previously broke after the first brand, missing queries with two brands.
  const words = query.split(/\s+/);
  const detectedBrands: BCBrand[] = [];
  for (const word of words) {
    if (word.length < 2) continue;
    const brand = await findBrandByName(word);
    if (brand && !detectedBrands.find((b) => b.id === brand.id)) {
      detectedBrands.push(brand);
    }
  }

  const brandWordsLower = new Set(
    words
      .filter((w) => w.length >= 2)
      .filter((w) => detectedBrands.some((b) => b.name.toLowerCase() === w.toLowerCase()))
      .map((w) => w.toLowerCase())
  );

  for (const brand of detectedBrands.slice(0, 3)) {
    const otherWords = words.filter((w) => !brandWordsLower.has(w.toLowerCase())).join(" ");
    if (otherWords.length > 0) {
      const brandKeyword = await getProductByKeyword(otherWords);
      const brandFiltered = brandKeyword.filter((p) => p.brand_id === brand.id);
      if (brandFiltered.length > 0) {
        addResults(brandFiltered);
      } else {
        addResults(await getProductsByBrand(brand.id));
      }
    } else {
      addResults(await getProductsByBrand(brand.id));
    }
  }

  // 4. name:like fallback if keyword search missed things
  if (deduped.size < 3) {
    const nameLike = await getProductByNameLike(query);
    addResults(nameLike);
  }

  // 5. Single-word fallback (longest first) — also fires when we have <3 results
  if (deduped.size < 3 && words.length > 1) {
    const sorted = [...words].filter((w) => w.length > 2).sort((a, b) => b.length - a.length);
    for (const word of sorted) {
      const wordResults = await getProductByKeyword(word);
      addResults(wordResults);
      if (deduped.size >= 3) break;
    }
  }

  return Array.from(deduped.values());
}

export async function getCategories(): Promise<BCCategory[]> {
  const allCategories: BCCategory[] = [];
  let page = 1;
  const limit = 250;
  while (true) {
    const results = await bcFetch<BCCategory[]>({
      path: "/catalog/categories",
      params: { limit, page },
    });
    if (!results || results.length === 0) break;
    allCategories.push(...results);
    if (results.length < limit) break;
    page++;
  }
  return allCategories;
}

let _categoryCache: BCCategory[] | null = null;
let _categoryCacheTime = 0;
const CATEGORY_CACHE_TTL = 5 * 60 * 1000;

async function getCachedCategories(): Promise<BCCategory[]> {
  if (_categoryCache && Date.now() - _categoryCacheTime < CATEGORY_CACHE_TTL) {
    return _categoryCache;
  }
  _categoryCache = await getCategories();
  _categoryCacheTime = Date.now();
  return _categoryCache;
}

export async function findCategoryByName(name: string): Promise<BCCategory | null> {
  const categories = await getCachedCategories();
  const lower = name.toLowerCase();
  return (
    categories.find((c) => c.name.toLowerCase() === lower) ||
    categories.find((c) => c.name.toLowerCase().includes(lower)) ||
    null
  );
}

// --- Aliases for backward compat ---

export const getProductByName = getProductByKeyword;

// --- Formatting ---

export function formatProductForPrompt(product: BCProduct): string {
  const price = product.sale_price || product.calculated_price || product.price;
  // inventory_tracking "none" means the store doesn't track stock — always available
  const noTracking = product.inventory_tracking === "none";
  let stockStatus: string;
  if (noTracking) {
    stockStatus = "IN STOCK";
  } else if (product.inventory_level <= 0) {
    stockStatus = "OUT OF STOCK";
  } else if (product.inventory_level <= 5) {
    stockStatus = `LOW STOCK (${product.inventory_level} left)`;
  } else {
    stockStatus = `IN STOCK (${product.inventory_level} available)`;
  }

  const variants = product.variants || [];
  const variantInfo = variants.length > 0
    ? variants
        .slice(0, 15)
        .map((v) => {
          const opts = v.option_values.map((o) => `${o.option_display_name}: ${o.label}`).join(", ");
          const vStock = noTracking
            ? "in stock"
            : v.inventory_level > 0 ? `${v.inventory_level} in stock` : "out of stock";
          return `  - ${opts} (${v.sku}) — ${vStock}`;
        })
        .join("\n")
    : "  No variant data available";

  const rawDesc = product.description
    ? product.description.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim()
    : "";
  const desc = rawDesc ? rawDesc.substring(0, 800) : "No description";

  const url = product.custom_url?.url
    ? `https://performancecycle.com${product.custom_url.url}`
    : null;
  const titleLine = url
    ? `[**${product.name}**](${url})`
    : `**${product.name}**`;

  return `${titleLine}
    SKU: ${product.sku}
    Price: $${price.toFixed(2)}
    Stock: ${stockStatus}
    URL: ${url || "N/A"}
    Description: ${desc}
    Variants:
${variantInfo}`;
}

// ─── Orders (BC v2) ────────────────────────────────────────────────────────
//
// BC's order API only lives on v2. The status_id field is an integer; the
// human label is mapped client-side via BC_ORDER_STATUS so a customer-facing
// summary doesn't depend on BC's `status` string (which is the same English
// label, but more brittle to typo'd casing if BC ever localizes).

export interface BCOrderAddress {
  first_name: string;
  last_name: string;
  street_1?: string;
  street_2?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
  email?: string;
  phone?: string;
}

export interface BCOrderProduct {
  id: number;
  product_id: number;
  order_id: number;
  name: string;
  sku?: string;
  quantity: number;
  // Prices come back as strings (e.g. "59.95") on v2.
  price_inc_tax: string;
  price_ex_tax?: string;
  total_inc_tax?: string;
}

export interface BCOrder {
  id: number;
  status: string;
  status_id: number;
  date_created: string;
  total_inc_tax: string;
  currency_code: string;
  items_total: number;
  items_shipped: number;
  payment_method: string;
  customer_id: number;
  billing_address: BCOrderAddress;
  // The /orders endpoint does NOT inline products — they're fetched
  // separately from /orders/{id}/products. Field is optional so callers
  // know to fetch them when needed.
  products?: BCOrderProduct[];
}

export interface BCShipment {
  id: number;
  order_id: number;
  tracking_number: string | null;
  tracking_carrier: string | null;
  tracking_link?: string | null;
  date_created: string;
  shipping_method: string;
  shipping_provider?: string;
  items?: Array<{
    order_product_id: number;
    product_id: number;
    quantity: number;
  }>;
}

/**
 * BC order status_id → human label. Source: BigCommerce REST API v2
 * `/orders` documentation. Keep this map exact; the AI summary message
 * shows the value verbatim.
 */
export const BC_ORDER_STATUS: Record<number, string> = {
  0: "Incomplete",
  1: "Pending",
  2: "Shipped",
  3: "Partially Shipped",
  4: "Refunded",
  5: "Cancelled",
  6: "Declined",
  7: "Awaiting Payment",
  8: "Awaiting Pickup",
  9: "Awaiting Shipment",
  10: "Completed",
  11: "Awaiting Fulfillment",
  12: "Manual Verification Required",
  13: "Disputed",
  14: "Partially Refunded",
};

/**
 * Look up a single order by customer email AND order id. Uses BC's
 * `/orders?email=&min_id=&max_id=` pattern so we only ever return a match
 * if the email on file matches what the customer typed — preventing one
 * customer from peeking at another's order by guessing an order number.
 *
 * Returns `null` for not-found, malformed BC response, or BC errors.
 */
export async function getOrderByEmailAndOrderId(
  email: string,
  orderId: number
): Promise<BCOrder | null> {
  const arr = await bcFetchV2<BCOrder[]>({
    path: "/orders",
    params: { email, min_id: orderId, max_id: orderId },
  });
  if (!Array.isArray(arr) || arr.length === 0) return null;
  // BC returns the array filtered by the min/max range — taking [0] is safe
  // because min_id === max_id ensures at most one match.
  return arr[0];
}

/**
 * Fetch shipments for an order. Returns `[]` (not null) when there are no
 * shipments yet — that's the common case for orders still in
 * "Awaiting Fulfillment" / "Awaiting Shipment".
 */
export async function getOrderShipments(orderId: number): Promise<BCShipment[]> {
  const arr = await bcFetchV2<BCShipment[]>({
    path: `/orders/${orderId}/shipments`,
  });
  return Array.isArray(arr) ? arr : [];
}
