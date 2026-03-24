import Fuse from "fuse.js";
import { searchLocalCatalog, type LocalMatch } from "./localCatalogSearch";
import {
  searchProductsBC,
  getProductBySKU,
  getProductByNameLike,
  type BCProduct,
} from "@/lib/bigcommerce/client";

const SKU_PATTERN = /\b[A-Z0-9]{2,}[-_]?[A-Z0-9]{2,}[-_]?[A-Z0-9]*\b/i;

const STOP_WORDS = new Set([
  "i", "me", "my", "we", "our", "you", "your", "it", "its", "the", "a", "an",
  "is", "are", "was", "were", "be", "been", "am", "do", "does", "did", "have",
  "has", "had", "can", "could", "will", "would", "shall", "should", "may",
  "might", "must", "need", "dare", "to", "of", "in", "for", "on", "with",
  "at", "by", "from", "as", "into", "about", "like", "through", "after",
  "over", "between", "out", "up", "down", "off", "then", "than", "too",
  "very", "just", "so", "not", "no", "nor", "and", "but", "or", "if",
  "that", "this", "these", "those", "what", "which", "who", "whom", "how",
  "all", "each", "every", "any", "some", "such", "only", "also", "both",
  "here", "there", "when", "where", "why", "see", "show", "get", "got",
  "want", "looking", "look", "find", "please", "thanks", "thank", "hey",
  "hi", "hello", "yeah", "yes", "yep", "nope", "okay", "ok", "much",
  "many", "still", "right", "thing", "things", "come", "something",
  "carry", "sell", "available", "stock", "interested", "recommend",
  "suggest", "prefer", "budget", "price", "cost", "cheap", "expensive",
  "affordable", "best", "popular", "favorite", "options", "selection",
  "range", "need", "buy", "purchase", "order", "shop", "store", "guys",
  "motorcycle", "bike", "riding", "rider", "ride",
]);

export function extractKeywords(query: string): string[] {
  return query
    .toLowerCase()
    .replace(/[?!.,;:'"()]/g, "")
    .split(/\s+/)
    .filter((w) => {
      if (STOP_WORDS.has(w)) return false;
      if (/^\d+$/.test(w)) return true; // keep numbers like "5", "1200"
      return w.length > 1;
    });
}

/**
 * Fetch full BigCommerce product details for a local catalog match.
 * Tries multiple strategies: full name, then first 3 words.
 */
async function enrichLocalMatch(match: LocalMatch): Promise<BCProduct | null> {
  try {
    const nameLower = match.name.toLowerCase();

    const searchName = match.name.length > 60
      ? match.name.substring(0, 60)
      : match.name;

    let products = await getProductByNameLike(searchName, 10);

    if (products.length === 0) {
      const words = match.name.split(/\s+/);
      if (words.length > 2) {
        const shortName = words.slice(0, 3).join(" ");
        products = await getProductByNameLike(shortName, 10);
      }
    }

    if (products.length === 0) return null;

    const exact = products.find(
      (p) => p.name.toLowerCase() === nameLower
    );
    if (exact) return exact;

    const fuse = new Fuse(products, {
      keys: ["name"],
      threshold: 0.4,
      includeScore: true,
    });
    const ranked = fuse.search(match.name);
    return ranked.length > 0 ? ranked[0].item : products[0];
  } catch {
    return null;
  }
}

export async function searchProducts(query: string): Promise<BCProduct[]> {
  if (!query || query.trim().length === 0) return [];

  const normalizedQuery = query.trim();
  const keywords = extractKeywords(normalizedQuery);

  if (keywords.length === 0) return [];

  // 1. Exact SKU lookup (fastest path)
  const skuMatch = normalizedQuery.match(SKU_PATTERN);
  if (skuMatch) {
    const skuProduct = await getProductBySKU(skuMatch[0]);
    if (skuProduct && skuProduct.is_visible && skuProduct.availability !== "disabled") {
      return [skuProduct];
    }
  }

  // 2. LOCAL CATALOG SEARCH — fuzzy search across all products
  const keywordsForLocal = keywords.join(" ");
  const localMatches = await searchLocalCatalog(keywordsForLocal, 10);

  if (localMatches.length > 0) {
    const enrichPromises = localMatches
      .slice(0, 8)
      .map((m) => enrichLocalMatch(m));
    const enriched = await Promise.all(enrichPromises);

    const results = enriched.filter(
      (p): p is BCProduct => p !== null && p.is_visible
    );

    if (results.length > 0) {
      return results;
    }

    // Enrichment failed — use stored URLs from local catalog as fallback
    const fallbackResults: BCProduct[] = localMatches.slice(0, 5).map((m) => ({
      id: 0,
      name: m.name,
      sku: "",
      price: m.price ? parseFloat(m.price) : 0,
      sale_price: 0,
      retail_price: 0,
      calculated_price: m.price ? parseFloat(m.price) : 0,
      description: "",
      is_visible: true,
      availability: "available" as const,
      inventory_level: -1,
      inventory_tracking: "none" as const,
      categories: [],
      brand_id: 0,
      variants: [],
      images: [],
      custom_url: { url: m.url || "", is_customized: false },
    }));
    if (fallbackResults.length > 0) return fallbackResults;
  }

  // 3. FALLBACK: BigCommerce API direct search (in case local catalog is stale)
  const keywordQuery = keywords.slice(0, 6).join(" ");
  const bcResults = await searchProductsBC(keywordQuery);

  return bcResults.filter((p) => p.is_visible);
}

export function extractSKUFromText(text: string): string | null {
  const match = text.match(SKU_PATTERN);
  return match ? match[0] : null;
}
