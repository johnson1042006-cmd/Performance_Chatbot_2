import Fuse from "fuse.js";
import { searchLocalCatalog, type LocalMatch } from "./localCatalogSearch";
import {
  searchProductsBC,
  getProductBySKU,
  getProductByNameLike,
  getProductById,
  getProductsByCategory,
  findCategoryByName,
  type BCProduct,
} from "@/lib/bigcommerce/client";
import {
  extractColorFromQuery,
  expandColorQuery,
  colorSynonymMap,
} from "./colorSynonyms";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

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
  "whats", "good", "great", "nice", "decent", "solid", "quality", "really",
  "pretty", "kind", "type", "pair", "one", "two", "ones", "new", "old",
  "big", "small", "little", "gonna", "wanna", "gotta", "maybe", "probably",
  "someone", "anything", "everything", "lot", "lots", "bit", "sure", "well",
]);

const PHRASE_SYNONYMS: [RegExp, string][] = [
  [/brain bucket/gi, "helmet"],
  [/rain suit/gi, "rain gear waterproof"],
  [/\brain gear\b/gi, "rain waterproof"],
  [/dirt bike plastics/gi, "fender number plate side panel"],
  [/dirtbike plastics/gi, "fender number plate side panel"],
  [/\bdirt\s+bike\b/gi, "dirtbike offroad mx"],
  [/\bhi[\s-]?vis\b/gi, "high visibility fluorescent"],
  [/\bhivis\b/gi, "high visibility fluorescent"],
  [/\bexhaust system/gi, "exhaust pipe muffler"],
  [/\bexhaust systems/gi, "exhaust pipe muffler"],
];

const QUERY_SYNONYMS: Record<string, string> = {
  kid: "youth", kids: "youth", children: "youth", child: "youth",
  womens: "women", mens: "men",
  motocross: "mx", dirtbike: "dirt", offroad: "mx",
  lid: "helmet", lids: "helmet",
  pipe: "exhaust", pipes: "exhaust",
  revit: "rev'it",
  firstgeer: "firstgear",
  plastics: "fender",
  panniers: "pannier",
  cans: "exhaust",
  mirror: "mirrors", mirrors: "mirror",
  sprockets: "sprocket",
  visor: "shield",
  shield: "visor",
};

const ALL_COLOR_WORDS: Set<string> = (() => {
  const s = new Set<string>();
  for (const [primary, synonyms] of Object.entries(colorSynonymMap)) {
    s.add(primary);
    for (const syn of synonyms) {
      if (!syn.includes(" ")) s.add(syn);
    }
  }
  return s;
})();

function productHasColor(product: BCProduct, expandedColors: Set<string>): boolean {
  if (!product.variants || product.variants.length === 0) return true;

  return product.variants.some((v) =>
    v.option_values.some((ov) => {
      const displayName = ov.option_display_name.toLowerCase();
      if (!displayName.includes("color") && !displayName.includes("colour"))
        return false;
      const label = ov.label.toLowerCase();
      for (const c of Array.from(expandedColors)) {
        if (label === c || label.includes(c) || c.includes(label)) return true;
      }
      return false;
    })
  );
}

function boostColorMatches(products: BCProduct[], color: string): BCProduct[] {
  const expanded = new Set(expandColorQuery(color).map((c) => c.toLowerCase()));

  const matching: BCProduct[] = [];
  const rest: BCProduct[] = [];

  for (const p of products) {
    if (productHasColor(p, expanded)) {
      matching.push(p);
    } else {
      rest.push(p);
    }
  }

  return [...matching, ...rest];
}

export function extractKeywords(query: string): string[] {
  let processed = query.toLowerCase();
  for (const [pattern, replacement] of PHRASE_SYNONYMS) {
    processed = processed.replace(pattern, replacement);
  }

  const words = processed
    .replace(/[?!.,;:'"()]/g, "")
    .split(/\s+/)
    .filter((w) => {
      if (STOP_WORDS.has(w)) return false;
      if (/^\d+$/.test(w)) return true;
      return w.length > 1;
    });

  const expanded: string[] = [];
  for (const w of words) {
    expanded.push(w);
    if (QUERY_SYNONYMS[w]) expanded.push(QUERY_SYNONYMS[w]);
  }
  return expanded;
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

const CATEGORY_SYNONYMS: Record<string, string[]> = {
  mx: ["moto"],
  motocross: ["moto"],
  dirt: ["moto", "offroad"],
  offroad: ["moto"],
  "dual sport": ["adventure", "dual sport"],
  "dual-sport": ["adventure", "dual sport"],
  adv: ["adventure"],
  "full face": ["street", "full face", "race"],
  "open face": ["open face"],
  modular: ["modular"],
  flip: ["modular"],
  snow: ["snow"],
  kids: ["kids"],
  youth: ["kids"],
};

function expandCategoryTerms(keywords: string[]): string[] {
  const expanded = new Set<string>();
  for (const kw of keywords) {
    expanded.add(kw);
    const synonyms = CATEGORY_SYNONYMS[kw.toLowerCase()];
    if (synonyms) {
      for (const s of synonyms) expanded.add(s);
    }
  }
  // Also try two-word combinations for multi-word synonyms
  for (let i = 0; i < keywords.length - 1; i++) {
    const pair = `${keywords[i]} ${keywords[i + 1]}`.toLowerCase();
    const synonyms = CATEGORY_SYNONYMS[pair];
    if (synonyms) {
      for (const s of synonyms) expanded.add(s);
    }
  }
  return Array.from(expanded);
}

async function searchByCategory(keywords: string[]): Promise<BCProduct[]> {
  const expandedTerms = expandCategoryTerms(keywords);

  const phrases = [
    expandedTerms.join(" "),
    ...expandedTerms.filter((w) => w.length > 2),
  ];

  for (const phrase of phrases) {
    try {
      const cat = await findCategoryByName(phrase);
      if (cat) {
        return getProductsByCategory(cat.id, 50);
      }
    } catch {
      /* continue */
    }
  }
  return [];
}

async function searchByColorway(
  color: string,
  keywords: string[]
): Promise<BCProduct[]> {
  try {
    const colorTerms = expandColorQuery(color);

    const colorConditions = colorTerms.map(
      (c) => sql`colorway_lower LIKE ${`%${c.toLowerCase()}%`}`
    );
    const colorWhere = colorConditions.reduce(
      (acc, cond) => sql`${acc} OR ${cond}`
    );

    const expandedCatTerms = expandCategoryTerms(keywords);
    const catKeywords = expandedCatTerms.filter(
      (w) => w.length > 1 && !ALL_COLOR_WORDS.has(w.toLowerCase())
    );

    let query;
    if (catKeywords.length > 0) {
      const catConditions = catKeywords.map(
        (w) => sql`(category ILIKE ${`%${w}%`} OR product_name ILIKE ${`%${w}%`})`
      );
      const catWhere = catConditions.reduce(
        (acc, cond) => sql`${acc} OR ${cond}`
      );
      query = sql`SELECT DISTINCT bc_product_id FROM product_colorways WHERE (${colorWhere}) AND (${catWhere}) LIMIT 15`;
    } else {
      query = sql`SELECT DISTINCT bc_product_id FROM product_colorways WHERE (${colorWhere}) LIMIT 15`;
    }

    const rows = await db.execute(query);
    const ids: number[] = [];
    const rawRows = Array.isArray(rows) ? rows : ((rows as unknown as { rows: { bc_product_id: number }[] }).rows || []);
    for (const r of rawRows) {
      const id = (r as { bc_product_id: number }).bc_product_id;
      if (id) ids.push(id);
    }

    if (ids.length === 0) return [];

    const products = await Promise.all(
      ids.map((id) => getProductById(id).catch(() => null))
    );
    return products.filter((p): p is BCProduct => p !== null && p.is_visible);
  } catch (e) {
    console.error("Colorway search error:", e);
    return [];
  }
}

export async function searchProducts(
  query: string
): Promise<{ products: BCProduct[]; detectedColor: string | null }> {
  if (!query || query.trim().length === 0)
    return { products: [], detectedColor: null };

  const normalizedQuery = query.trim();

  const detectedColor = extractColorFromQuery(normalizedQuery);

  const allKeywords = extractKeywords(normalizedQuery);
  let keywords = detectedColor
    ? allKeywords.filter((kw) => !ALL_COLOR_WORDS.has(kw.toLowerCase()))
    : allKeywords;
  if (keywords.length === 0) keywords = allKeywords;
  if (keywords.length === 0) return { products: [], detectedColor };

  const applyColor = (results: BCProduct[]) =>
    detectedColor && results.length > 0
      ? boostColorMatches(results, detectedColor)
      : results;

  // 1. Exact SKU lookup (fastest path)
  const skuMatch = normalizedQuery.match(SKU_PATTERN);
  if (skuMatch) {
    const skuProduct = await getProductBySKU(skuMatch[0]);
    if (skuProduct && skuProduct.is_visible && skuProduct.availability !== "disabled") {
      return { products: [skuProduct], detectedColor };
    }
  }

  // 2. Run ALL search sources in parallel — local catalog, BC keyword, category, and colorway index
  const keywordsForLocal = keywords.join(" ");
  const keywordQuery = keywords.slice(0, 6).join(" ");

  const [localMatches, bcKeywordResults, categoryResults, colorwayResults] = await Promise.all([
    searchLocalCatalog(keywordsForLocal, 10).catch(() => [] as LocalMatch[]),
    searchProductsBC(keywordQuery).catch(() => [] as BCProduct[]),
    searchByCategory(keywords).catch(() => [] as BCProduct[]),
    detectedColor
      ? searchByColorway(detectedColor, keywords).catch(() => [] as BCProduct[])
      : Promise.resolve([] as BCProduct[]),
  ]);

  const deduped = new Map<number, BCProduct>();
  function addProducts(products: BCProduct[]) {
    for (const p of products) {
      if (p.is_visible && p.availability !== "disabled" && !deduped.has(p.id)) {
        deduped.set(p.id, p);
      }
    }
  }

  // Colorway index results are highest priority for color+type queries
  addProducts(colorwayResults);

  // Category results are the most relevant for type-based queries like "street helmets"
  addProducts(categoryResults);

  // BC keyword results search descriptions, so they catch category terms too
  addProducts(bcKeywordResults);

  // Enrich local catalog matches with full BC data
  if (localMatches.length > 0) {
    const enrichPromises = localMatches
      .slice(0, 12)
      .map((m) => enrichLocalMatch(m));
    const enriched = await Promise.all(enrichPromises);
    const localProducts = enriched.filter(
      (p): p is BCProduct => p !== null && p.is_visible
    );
    addProducts(localProducts);

    // If enrichment failed for all, add raw local catalog entries
    if (localProducts.length === 0 && deduped.size === 0) {
      const fallback: BCProduct[] = localMatches.slice(0, 10).map((m) => ({
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
      const results = applyColor(fallback);
      return { products: results, detectedColor };
    }
  }

  let results = Array.from(deduped.values());

  // If still too few results, retry with the full natural-language query
  if (results.length < 3 && keywordQuery !== normalizedQuery) {
    const rawResults = await searchProductsBC(normalizedQuery).catch(() => []);
    addProducts(rawResults);
    results = Array.from(deduped.values());
  }

  return { products: applyColor(results), detectedColor };
}

export function extractSKUFromText(text: string): string | null {
  const match = text.match(SKU_PATTERN);
  return match ? match[0] : null;
}
