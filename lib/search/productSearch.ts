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

function extractKeywords(query: string): string[] {
  return query
    .toLowerCase()
    .replace(/[?!.,;:'"()]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w));
}

/**
 * Fetch full BigCommerce product details for a local catalog match.
 * Uses name:like to find the product, then returns the best match.
 */
async function enrichLocalMatch(match: LocalMatch): Promise<BCProduct | null> {
  try {
    // Use a distinctive portion of the name for the name:like query.
    // Take the first 60 chars to stay within BC API's comfort zone.
    const searchName = match.name.length > 60
      ? match.name.substring(0, 60)
      : match.name;

    const products = await getProductByNameLike(searchName, 5);
    if (products.length === 0) return null;

    // Find the exact match by name (case-insensitive)
    const exact = products.find(
      (p) => p.name.toLowerCase() === match.name.toLowerCase()
    );
    if (exact) return exact;

    // Fall back to closest match
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

  // 2. LOCAL CATALOG SEARCH — fuzzy search across all 5,622 products
  const localMatches = await searchLocalCatalog(normalizedQuery, 10);

  if (localMatches.length > 0) {
    // Enrich top local matches with full BigCommerce data (inventory, variants, images)
    const enrichPromises = localMatches
      .slice(0, 8)
      .map((m) => enrichLocalMatch(m));
    const enriched = await Promise.all(enrichPromises);

    const results = enriched.filter(
      (p): p is BCProduct => p !== null && p.is_visible
    );

    if (results.length > 0) {
      // Local search already returns results in best-match order (ILIKE > FTS > trigram).
      // Enrichment preserves that order. No Fuse re-ranking needed — it only corrupts
      // the ordering by matching conversational words to irrelevant products.
      return results;
    }
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
