const BASE_URL = `https://api.bigcommerce.com/stores/${process.env.BIGCOMMERCE_STORE_HASH}/v3`;

interface BCRequestOptions {
  path: string;
  params?: Record<string, string | number>;
}

async function bcFetch<T>(options: BCRequestOptions): Promise<T | null> {
  const url = new URL(`${BASE_URL}${options.path}`);
  if (options.params) {
    for (const [key, value] of Object.entries(options.params)) {
      url.searchParams.set(key, String(value));
    }
  }

  try {
    const res = await fetch(url.toString(), {
      headers: {
        "X-Auth-Token": process.env.BIGCOMMERCE_ACCESS_TOKEN!,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      next: { revalidate: 60 },
    });

    if (!res.ok) {
      console.error(`BigCommerce API error: ${res.status} ${res.statusText} for ${options.path}`);
      return null;
    }

    const json = await res.json();
    return json.data as T;
  } catch (error) {
    console.error("BigCommerce fetch error:", error);
    return null;
  }
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
  let status: "in_stock" | "low_stock" | "out_of_stock";
  if (qty <= 0) status = "out_of_stock";
  else if (qty <= 5) status = "low_stock";
  else status = "in_stock";

  return { inStock: qty > 0, quantity: qty, status };
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

  // 2. Brand search — check if any word in the query matches a brand
  const words = query.split(/\s+/);
  for (const word of words) {
    if (word.length < 2) continue;
    const brand = await findBrandByName(word);
    if (brand) {
      const otherWords = words.filter((w) => w.toLowerCase() !== word.toLowerCase()).join(" ");
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
      break;
    }
  }

  // 3. name:like fallback if keyword search missed things
  if (deduped.size < 3) {
    const nameLike = await getProductByNameLike(query);
    addResults(nameLike);
  }

  // 4. Single-word fallback (longest first)
  if (deduped.size === 0 && words.length > 1) {
    const sorted = [...words].filter((w) => w.length > 2).sort((a, b) => b.length - a.length);
    for (const word of sorted) {
      const wordResults = await getProductByKeyword(word);
      addResults(wordResults);
      if (deduped.size > 0) break;
    }
  }

  return Array.from(deduped.values());
}

export async function getCategories(): Promise<BCCategory[]> {
  const results = await bcFetch<BCCategory[]>({
    path: "/catalog/categories",
    params: { limit: 50 },
  });
  return results || [];
}

// --- Aliases for backward compat ---

export const getProductByName = getProductByKeyword;

// --- Formatting ---

export function formatProductForPrompt(product: BCProduct): string {
  const price = product.sale_price || product.calculated_price || product.price;
  const stockStatus =
    product.inventory_level <= 0
      ? "OUT OF STOCK"
      : product.inventory_level <= 5
      ? `LOW STOCK (${product.inventory_level} left)`
      : `IN STOCK (${product.inventory_level} available)`;

  const variants = product.variants || [];
  const variantInfo = variants.length > 0
    ? variants
        .slice(0, 15)
        .map((v) => {
          const opts = v.option_values.map((o) => `${o.option_display_name}: ${o.label}`).join(", ");
          const vStock = v.inventory_level > 0 ? `${v.inventory_level} in stock` : "out of stock";
          return `  - ${opts} (${v.sku}) — ${vStock}`;
        })
        .join("\n")
    : "  No variant data available";

  const desc = product.description
    ? product.description.replace(/<[^>]*>/g, "").substring(0, 300)
    : "No description";

  return `**${product.name}**
  SKU: ${product.sku}
  Price: $${price.toFixed(2)}
  Stock: ${stockStatus}
  URL: https://performancecycle.com${product.custom_url?.url || `/${product.name.toLowerCase().replace(/&/g, "-").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")}/`}
  Description: ${desc}
  Variants:
${variantInfo}`;
}
