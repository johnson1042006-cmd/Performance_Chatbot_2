import Fuse from "fuse.js";
import { expandColorQuery, extractColorFromQuery } from "./colorSynonyms";
import {
  searchProductsBC,
  getProductBySKU,
  getProductsByCategory,
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

const EBIKE_PATTERNS = /\b(e-?bike|ebike|electric\s*(bike|scooter|motorcycle))\b/i;
const EBIKE_SEARCH_TERMS = ["electric", "e-bike", "pedal assist", "ebike"];

export async function searchProducts(query: string): Promise<BCProduct[]> {
  if (!query || query.trim().length === 0) return [];

  const normalizedQuery = query.trim();
  const keywords = extractKeywords(normalizedQuery);

  if (keywords.length === 0) return [];

  // 1. Exact SKU lookup
  const skuMatch = normalizedQuery.match(SKU_PATTERN);
  if (skuMatch) {
    const skuProduct = await getProductBySKU(skuMatch[0]);
    if (skuProduct && skuProduct.is_visible && skuProduct.availability !== "disabled") {
      return [skuProduct];
    }
  }

  // 1b. E-bike special handling: "e-bike" keyword returns toy bikes from BC,
  // so we use multiple targeted sub-queries instead.
  if (EBIKE_PATTERNS.test(normalizedQuery)) {
    const deduped = new Map<number, BCProduct>();
    for (const term of EBIKE_SEARCH_TERMS) {
      const hits = await searchProductsBC(term);
      for (const p of hits) {
        if (!deduped.has(p.id)) deduped.set(p.id, p);
      }
      if (deduped.size >= 10) break;
    }
    const results = [...deduped.values()].filter(
      (p) => p.is_visible && p.availability !== "disabled"
    );
    if (results.length > 0) return results;
  }

  // 2. Full smart search (keyword + brand + name:like + fallbacks)
  // Limit to 6 most important keywords to avoid overwhelming BigCommerce API
  const keywordQuery = keywords.slice(0, 6).join(" ");
  let results = await searchProductsBC(keywordQuery);

  // 3. Color-expanded search if initial results are sparse
  if (results.length < 3) {
    const colorTerms = expandColorQuery(keywordQuery);
    if (colorTerms.length > 1) {
      const seen = new Set(results.map((p) => p.id));
      for (const term of colorTerms.slice(0, 3)) {
        const colorResults = await searchProductsBC(term);
        for (const p of colorResults) {
          if (!seen.has(p.id)) {
            seen.add(p.id);
            results.push(p);
          }
        }
        if (results.length >= 5) break;
      }
    }
  }

  // 4. Category-based alternatives to fill out results
  if (results.length < 3 && results.length > 0) {
    const categoryIds = Array.from(new Set(results.flatMap((p) => p.categories)));
    const seen = new Set(results.map((p) => p.id));
    for (const catId of categoryIds.slice(0, 2)) {
      if (results.length >= 5) break;
      const catProducts = await getProductsByCategory(catId);
      for (const p of catProducts) {
        if (!seen.has(p.id)) {
          seen.add(p.id);
          results.push(p);
        }
        if (results.length >= 8) break;
      }
    }
  }

  // Filter inactive
  results = results.filter(
    (p) => p.is_visible && p.availability !== "disabled"
  );

  // Fuzzy re-rank to put the most relevant results first
  if (results.length > 1) {
    const color = extractColorFromQuery(normalizedQuery);
    const fuse = new Fuse(results, {
      keys: [
        { name: "name", weight: 0.5 },
        { name: "description", weight: 0.25 },
        { name: "sku", weight: 0.25 },
      ],
      threshold: 0.6,
      includeScore: true,
    });

    const searchTerm = color
      ? `${keywordQuery} ${expandColorQuery(color).join(" ")}`
      : keywordQuery;

    const ranked = fuse.search(searchTerm);
    if (ranked.length > 0) {
      return ranked.map((r) => r.item);
    }
  }

  return results;
}

export function extractSKUFromText(text: string): string | null {
  const match = text.match(SKU_PATTERN);
  return match ? match[0] : null;
}
