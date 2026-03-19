import Fuse from "fuse.js";
import { expandColorQuery, extractColorFromQuery } from "./colorSynonyms";
import {
  searchProductsBC,
  getProductBySKU,
  getProductsByCategory,
  type BCProduct,
} from "@/lib/bigcommerce/client";

const SKU_PATTERN = /\b[A-Z0-9]{2,}[-_]?[A-Z0-9]{2,}[-_]?[A-Z0-9]*\b/i;

export async function searchProducts(query: string): Promise<BCProduct[]> {
  if (!query || query.trim().length === 0) return [];

  const normalizedQuery = query.trim();

  // 1. Exact SKU lookup
  const skuMatch = normalizedQuery.match(SKU_PATTERN);
  if (skuMatch) {
    const skuProduct = await getProductBySKU(skuMatch[0]);
    if (skuProduct && skuProduct.is_visible && skuProduct.availability !== "disabled") {
      return [skuProduct];
    }
  }

  // 2. Exact name/keyword search via BC API
  let results = await searchProductsBC(normalizedQuery);

  // 3. Color-expanded search if initial results are sparse
  if (results.length < 3) {
    const colorTerms = expandColorQuery(normalizedQuery);
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

  // 4. Partial keyword search — split query into words and search each
  if (results.length < 3) {
    const words = normalizedQuery.split(/\s+/).filter((w) => w.length > 2);
    for (const word of words) {
      if (results.length >= 3) break;
      const wordResults = await searchProductsBC(word);
      const seen = new Set(results.map((p) => p.id));
      for (const p of wordResults) {
        if (!seen.has(p.id)) {
          seen.add(p.id);
          results.push(p);
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

  // Filter out inactive/invisible products
  results = results.filter(
    (p) => p.is_visible && p.availability !== "disabled"
  );

  // Client-side fuzzy re-rank if we have results
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
      ? `${normalizedQuery} ${expandColorQuery(color).join(" ")}`
      : normalizedQuery;

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
