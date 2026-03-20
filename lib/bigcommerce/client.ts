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

export async function getProductByName(name: string): Promise<BCProduct[]> {
  const results = await bcFetch<BCProduct[]>({
    path: "/catalog/products",
    params: {
      "keyword": name,
      "is_visible": 1,
      "include": "variants,images",
      "limit": 10,
    },
  });
  return results || [];
}

export async function getProductBySKU(sku: string): Promise<BCProduct | null> {
  const results = await bcFetch<BCProduct[]>({
    path: "/catalog/products",
    params: {
      "sku": sku,
      "include": "variants,images",
      "limit": 1,
    },
  });
  return results?.[0] || null;
}

export async function getProductById(id: number): Promise<BCProduct | null> {
  return bcFetch<BCProduct>({
    path: `/catalog/products/${id}`,
    params: { "include": "variants,images" },
  });
}

export async function getProductsByCategory(categoryId: number): Promise<BCProduct[]> {
  const results = await bcFetch<BCProduct[]>({
    path: "/catalog/products",
    params: {
      "categories:in": categoryId,
      "is_visible": 1,
      "include": "variants,images",
      "limit": 20,
    },
  });
  return results || [];
}

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

export async function searchProductsBC(query: string): Promise<BCProduct[]> {
  let results = await getProductByName(query);

  if (results.length === 0) {
    const words = query.split(/\s+/).filter((w) => w.length > 2);
    const sorted = [...words].sort((a, b) => b.length - a.length);
    for (const word of sorted) {
      results = await getProductByName(word);
      if (results.length > 0) break;
    }
  }

  return results.filter((p) => p.is_visible && p.availability !== "disabled");
}

export async function getCategories(): Promise<BCCategory[]> {
  const results = await bcFetch<BCCategory[]>({
    path: "/catalog/categories",
    params: { limit: 50 },
  });
  return results || [];
}

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
        .map((v) => {
          const opts = v.option_values.map((o) => `${o.option_display_name}: ${o.label}`).join(", ");
          const vStock = v.inventory_level > 0 ? `${v.inventory_level} in stock` : "out of stock";
          return `  - ${opts} (${v.sku}) — ${vStock}`;
        })
        .join("\n")
    : "  No variant data available";

  const desc = product.description
    ? product.description.replace(/<[^>]*>/g, "").substring(0, 500)
    : "No description";

  return `**${product.name}**
  SKU: ${product.sku}
  Price: $${price.toFixed(2)}
  Stock: ${stockStatus}
  URL: ${product.custom_url?.url || "N/A"}
  Description: ${desc}
  Variants:
${variantInfo}`;
}
