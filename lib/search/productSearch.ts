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
  "hi", "hello", "yeah", "yes", "yep", "nope", "okay", "ok",
]);

function extractKeywords(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w));
}

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

  // 2. Search with extracted keywords joined (e.g. "shoei helmets")
  const keywordQuery = keywords.join(" ");
  let results = await searchProductsBC(keywordQuery);

  // 3. If no results, search each keyword individually (longest first for relevance)
  if (results.length === 0) {
    const sorted = [...keywords].sort((a, b) => b.length - a.length);
    for (const word of sorted) {
      results = await searchProductsBC(word);
      if (results.length > 0) break;
    }
  }

  // 4. Color-expanded search if initial results are sparse
  if (results.length < 3) {
    const colorTerms = expandColorQuery(keywordQuery);
    if (colorTerms.length > 1) {
      const colorSearches = colorTerms
        .slice(0, 5)
        .map((term) => searchProductsBC(term));
      const colorResults = await Promise.all(colorSearches);
      const seen = new Set(results.map((p) => p.id));
      for (const batch of colorResults) {
        for (const p of batch) {
          if (!seen.has(p.id)) {
            seen.add(p.id);
            results.push(p);
          }
        }
      }
    }
  }

  // 5. If still not enough, try category-based alternatives
  if (results.length < 3 && results.length > 0) {
    const categoryIds = Array.from(new Set(results.flatMap((p) => p.categories)));
    for (const catId of categoryIds.slice(0, 3)) {
      if (results.length >= 3) break;
      const catProducts = await getProductsByCategory(catId);
      const seen = new Set(results.map((p) => p.id));
      for (const p of catProducts) {
        if (!seen.has(p.id)) {
          seen.add(p.id);
          results.push(p);
        }
        if (results.length >= 6) break;
      }
    }
  }

  results = results.filter(
    (p) => p.is_visible && p.availability !== "disabled"
  );

  // Fuzzy re-rank
  if (results.length > 1) {
    const color = extractColorFromQuery(normalizedQuery);
    const fuse = new Fuse(results, {
      keys: [
        { name: "name", weight: 0.4 },
        { name: "description", weight: 0.3 },
        { name: "sku", weight: 0.2 },
      ],
      threshold: 0.5,
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
