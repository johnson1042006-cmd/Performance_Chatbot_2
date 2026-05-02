/**
 * Subcategory classification for product types where ambiguous queries
 * frequently surface the wrong style (helmets, jackets, boots, gloves, pants,
 * tires). The classifier maps a BCProduct to a normalized subcategory using
 * the BigCommerce category tree as the authoritative source, with a robust
 * text-based fallback against the product name and description.
 *
 * Rationale: Performance Cycle is primarily a street motorcycle shop. When a
 * customer says "I need a helmet" or "what jackets do you have" without a use
 * case, we should default to street/road riding products rather than letting
 * MX / dirt / adventure / avalanche items rank purely on text overlap.
 */

import {
  type BCProduct,
  type BCCategory,
} from "@/lib/bigcommerce/client";

import * as bcClient from "@/lib/bigcommerce/client";

export type HelmetStyle =
  | "full_face"
  | "open_face"
  | "modular"
  | "adventure"
  | "mx"
  | "half";

export type JacketStyle =
  | "street"
  | "mx"
  | "adventure"
  | "cruiser"
  | "racing";

export type BootStyle =
  | "street"
  | "mx"
  | "adventure"
  | "racing"
  | "cruiser";

export type GloveStyle =
  | "street"
  | "mx"
  | "adventure"
  | "racing"
  | "winter";

export type PantStyle =
  | "street"
  | "mx"
  | "adventure"
  | "cruiser";

export type TireStyle =
  | "sport"
  | "sport_touring"
  | "cruiser"
  | "adventure"
  | "dirt";

export type SubcategoryValue =
  | HelmetStyle
  | JacketStyle
  | BootStyle
  | GloveStyle
  | PantStyle
  | TireStyle;

export type SupportedProductType =
  | "helmet"
  | "jacket"
  | "boots"
  | "gloves"
  | "pants"
  | "tire";

/**
 * The "default to street" target per product type. When the customer is
 * ambiguous, we promote products whose subcategory matches this target and
 * demote everything else. Set conservatively — these are the styles a typical
 * Performance Cycle customer would expect to see first.
 */
export const STREET_DEFAULT: Record<SupportedProductType, SubcategoryValue> = {
  helmet: "full_face",
  jacket: "street",
  boots: "street",
  gloves: "street",
  pants: "street",
  tire: "sport_touring",
};

/**
 * Subcategories that should be demoted (pushed to the bottom of the list)
 * when the customer hasn't asked for them. Helmets and apparel each have
 * different "off-street" categories — these are the union of all of them.
 */
export const OFF_STREET_SUBCATEGORIES: Set<SubcategoryValue> = new Set<SubcategoryValue>([
  "open_face",
  "modular",
  "half",
  "mx",
  "adventure",
  "dirt",
]);

// ---------------------------------------------------------------------------
// BC category-name → subcategory mapping
// ---------------------------------------------------------------------------
//
// We classify categories by walking the BC category tree from each leaf up to
// the parent_id chain. The first ancestor whose name matches one of our
// recognized "type roots" (Helmets, Jackets, Boots, Gloves, Pants, Tires)
// determines the productType. The leaf or any ancestor below the type root
// then provides the subcategory by name match.
//
// We intentionally keep these regexes narrow and deterministic. If a future
// BC category name doesn't match, the text fallback in classifyByText handles
// it; we also log unrecognized type-root children once at boot for follow-up.

const TYPE_ROOT_NAMES: Record<SupportedProductType, RegExp> = {
  helmet: /^helmets?$/i,
  jacket: /^jackets?$/i,
  boots: /^boots?$/i,
  gloves: /^gloves?$/i,
  pants: /^pants?$/i,
  tire: /^tires?$/i,
};

/**
 * Regex map from category name to subcategory, scoped per productType.
 * Order matters within an array — the first match wins.
 */
const CATEGORY_NAME_RULES: Record<
  SupportedProductType,
  Array<{ pattern: RegExp; value: SubcategoryValue }>
> = {
  helmet: [
    { pattern: /open[\s-]?face/i, value: "open_face" },
    { pattern: /modular|flip[\s-]?up/i, value: "modular" },
    { pattern: /half|beanie|shorty|3\s*\/\s*4|three[\s-]?quarter/i, value: "half" },
    { pattern: /adventure|adv|dual[\s-]?sport/i, value: "adventure" },
    { pattern: /moto|mx|motocross|off[\s-]?road|dirt/i, value: "mx" },
    { pattern: /street|sport|race|track|full[\s-]?face/i, value: "full_face" },
  ],
  jacket: [
    { pattern: /moto|mx|motocross|off[\s-]?road|dirt|jersey/i, value: "mx" },
    { pattern: /adventure|adv|dual[\s-]?sport/i, value: "adventure" },
    { pattern: /cruiser|harley|leather/i, value: "cruiser" },
    { pattern: /race|track|leathers?\b/i, value: "racing" },
    { pattern: /street|sport|touring|textile|mesh|waterproof/i, value: "street" },
  ],
  boots: [
    { pattern: /moto|mx|motocross|off[\s-]?road|dirt/i, value: "mx" },
    { pattern: /adventure|adv|dual[\s-]?sport/i, value: "adventure" },
    { pattern: /cruiser|harley/i, value: "cruiser" },
    { pattern: /race|track/i, value: "racing" },
    { pattern: /street|sport|touring|riding/i, value: "street" },
  ],
  gloves: [
    { pattern: /moto|mx|motocross|off[\s-]?road|dirt/i, value: "mx" },
    { pattern: /adventure|adv|dual[\s-]?sport/i, value: "adventure" },
    { pattern: /heated|winter|cold[\s-]?weather/i, value: "winter" },
    { pattern: /race|track|gauntlet/i, value: "racing" },
    { pattern: /street|sport|touring|summer|riding/i, value: "street" },
  ],
  pants: [
    { pattern: /moto|mx|motocross|off[\s-]?road|dirt/i, value: "mx" },
    { pattern: /adventure|adv|dual[\s-]?sport/i, value: "adventure" },
    { pattern: /cruiser|harley|leather/i, value: "cruiser" },
    { pattern: /street|sport|touring|textile|jeans|riding/i, value: "street" },
  ],
  tire: [
    { pattern: /off[\s-]?road|dirt|knobby|mx|motocross/i, value: "dirt" },
    { pattern: /adventure|adv|dual[\s-]?sport/i, value: "adventure" },
    { pattern: /cruiser|harley/i, value: "cruiser" },
    { pattern: /sport[\s-]?touring|touring/i, value: "sport_touring" },
    { pattern: /sport|race|track/i, value: "sport" },
  ],
};

// ---------------------------------------------------------------------------
// Cache for the BC-category-id → {type, subcategory} map.
// 5 minute TTL mirrors the existing brand/category caches in client.ts.
// ---------------------------------------------------------------------------

interface ClassifiedCategoryEntry {
  productType: SupportedProductType;
  subcategory: SubcategoryValue;
}

let _categoryMap: Map<number, ClassifiedCategoryEntry> | null = null;
let _categoryMapTime = 0;
const CACHE_TTL_MS = 5 * 60 * 1000;

function classifyCategoryName(
  productType: SupportedProductType,
  categoryName: string
): SubcategoryValue | null {
  const rules = CATEGORY_NAME_RULES[productType];
  for (const { pattern, value } of rules) {
    if (pattern.test(categoryName)) return value;
  }
  return null;
}

/**
 * Walk the BC category tree and build a Map<categoryId, {productType, subcategory}>.
 * For each category, find the nearest ancestor (or self) whose name is a type
 * root (Helmets/Jackets/Boots/Gloves/Pants/Tires). The categories at or
 * BELOW that root get classified by name into a subcategory; anything that
 * doesn't match a known subcategory pattern uses the type root's "street default".
 */
async function buildCategoryMap(): Promise<Map<number, ClassifiedCategoryEntry>> {
  const map = new Map<number, ClassifiedCategoryEntry>();

  let categories: BCCategory[];
  try {
    const fn = (bcClient as { getCategories?: () => Promise<BCCategory[]> }).getCategories;
    if (typeof fn !== "function") return map;
    categories = await fn();
  } catch (err) {
    console.error("[subcategory] Failed to load BC categories:", err);
    return map;
  }

  if (!categories || categories.length === 0) return map;

  const byId = new Map<number, BCCategory>();
  for (const c of categories) byId.set(c.id, c);

  function findTypeRoot(catId: number): { productType: SupportedProductType; rootId: number } | null {
    let current: BCCategory | undefined = byId.get(catId);
    let depth = 0;
    while (current && depth < 10) {
      for (const [pt, re] of Object.entries(TYPE_ROOT_NAMES) as [
        SupportedProductType,
        RegExp,
      ][]) {
        if (re.test(current.name)) {
          return { productType: pt, rootId: current.id };
        }
      }
      if (!current.parent_id || current.parent_id === 0) break;
      current = byId.get(current.parent_id);
      depth++;
    }
    return null;
  }

  for (const cat of categories) {
    const root = findTypeRoot(cat.id);
    if (!root) continue;

    // Skip the type root itself. Products whose only BC category is the
    // parent (e.g. just "Helmets") should fall through to the text
    // classifier so we can read the product's name/description rather than
    // assigning every parent-only product the street default.
    if (cat.id === root.rootId) continue;

    let value = classifyCategoryName(root.productType, cat.name);

    if (!value) {
      let parent: BCCategory | undefined = byId.get(cat.parent_id);
      let depth = 0;
      while (parent && parent.id !== root.rootId && depth < 5) {
        const v = classifyCategoryName(root.productType, parent.name);
        if (v) {
          value = v;
          break;
        }
        if (!parent.parent_id || parent.parent_id === 0) break;
        parent = byId.get(parent.parent_id);
        depth++;
      }
    }

    if (!value) continue;

    map.set(cat.id, { productType: root.productType, subcategory: value });
  }

  return map;
}

async function getCategoryMap(): Promise<Map<number, ClassifiedCategoryEntry>> {
  const now = Date.now();
  if (_categoryMap && now - _categoryMapTime < CACHE_TTL_MS) return _categoryMap;
  _categoryMap = await buildCategoryMap();
  _categoryMapTime = now;
  return _categoryMap;
}

// ---------------------------------------------------------------------------
// Text-based fallback for products with no BC category match.
// ---------------------------------------------------------------------------

const TEXT_RULES: Record<
  SupportedProductType,
  Array<{ pattern: RegExp; value: SubcategoryValue }>
> = {
  helmet: [
    { pattern: /\bopen[\s-]?face\b|\b3\s*\/\s*4\b|three[\s-]?quarter/i, value: "open_face" },
    { pattern: /\bmodular\b|\bflip[\s-]?up\b/i, value: "modular" },
    { pattern: /\bhalf[\s-]?helmet\b|\bbeanie\b|\bshorty\b/i, value: "half" },
    { pattern: /\badventure\b|\badv\b|\bdual[\s-]?sport\b/i, value: "adventure" },
    { pattern: /\bmotocross\b|\bmx\b|\boff[\s-]?road\b|\bdirt\b|\bmoto\b/i, value: "mx" },
    { pattern: /\bfull[\s-]?face\b|\brace[\s-]?helmet\b|\bstreet[\s-]?helmet\b|\bsport[\s-]?helmet\b/i, value: "full_face" },
  ],
  jacket: [
    { pattern: /\bjersey\b|\bmx\b|\bmotocross\b|\boff[\s-]?road\b|\bdirt\b/i, value: "mx" },
    { pattern: /\badventure\b|\badv\b|\bdual[\s-]?sport\b/i, value: "adventure" },
    { pattern: /\bleather\b|\bcruiser\b|\bharley\b/i, value: "cruiser" },
    { pattern: /\brace\b|\btrack\b|\bleathers\b/i, value: "racing" },
  ],
  boots: [
    { pattern: /\bmx\b|\bmotocross\b|\boff[\s-]?road\b|\bdirt\b/i, value: "mx" },
    { pattern: /\badventure\b|\badv\b|\bdual[\s-]?sport\b/i, value: "adventure" },
    { pattern: /\brace\b|\btrack\b/i, value: "racing" },
    { pattern: /\bcruiser\b|\bharley\b|\bengineer\b/i, value: "cruiser" },
  ],
  gloves: [
    { pattern: /\bmx\b|\bmotocross\b|\boff[\s-]?road\b|\bdirt\b/i, value: "mx" },
    { pattern: /\badventure\b|\badv\b|\bdual[\s-]?sport\b/i, value: "adventure" },
    { pattern: /\bheated\b|\bwinter\b|\bcold[\s-]?weather\b/i, value: "winter" },
    { pattern: /\brace\b|\btrack\b|\bgauntlet\b/i, value: "racing" },
  ],
  pants: [
    { pattern: /\bmx\b|\bmotocross\b|\boff[\s-]?road\b|\bdirt\b/i, value: "mx" },
    { pattern: /\badventure\b|\badv\b|\bdual[\s-]?sport\b/i, value: "adventure" },
    { pattern: /\bleather[\s-]?pants?\b|\bcruiser\b/i, value: "cruiser" },
  ],
  tire: [
    { pattern: /\bknobby\b|\bdirt\b|\bmotocross\b|\bmx\b|\boff[\s-]?road\b/i, value: "dirt" },
    { pattern: /\badventure\b|\badv\b|\bdual[\s-]?sport\b/i, value: "adventure" },
    { pattern: /\bcruiser\b|\bharley\b/i, value: "cruiser" },
    { pattern: /\bsport[\s-]?touring\b|\btouring\b/i, value: "sport_touring" },
    { pattern: /\bsport\b|\brace\b|\btrack\b/i, value: "sport" },
  ],
};

function classifyByText(
  productType: SupportedProductType,
  product: BCProduct
): SubcategoryValue {
  const haystack = `${product.name} ${(product.description || "").replace(/<[^>]+>/g, " ").substring(0, 800)}`;
  for (const { pattern, value } of TEXT_RULES[productType]) {
    if (pattern.test(haystack)) return value;
  }
  return STREET_DEFAULT[productType];
}

/**
 * Classify a product into its subcategory for the given productType.
 * Tries BC category map first, falls back to text.
 */
export async function classifyProductSubcategory(
  product: BCProduct,
  productType: SupportedProductType
): Promise<SubcategoryValue> {
  if (product.categories && product.categories.length > 0) {
    const map = await getCategoryMap();
    for (const catId of product.categories) {
      const entry = map.get(catId);
      if (entry && entry.productType === productType) {
        return entry.subcategory;
      }
    }
  }
  return classifyByText(productType, product);
}

/**
 * Synchronous text-only classification, used in unit tests and when the BC
 * category map isn't available.
 */
export function classifyProductSubcategoryByText(
  product: BCProduct,
  productType: SupportedProductType
): SubcategoryValue {
  return classifyByText(productType, product);
}

// ---------------------------------------------------------------------------
// Query intent: did the customer ask for a specific subcategory?
// ---------------------------------------------------------------------------
//
// Returns:
//   { explicit: true,  value: <subcategory> }  → hard-filter to this subcategory
//   { explicit: false, value: "any" }          → show all subcategories
//   null                                       → ambiguous, apply STREET_DEFAULT bias

export type SubcategoryRequest =
  | { explicit: true; value: SubcategoryValue }
  | { explicit: false; value: "any" }
  | null;

const ANY_INDICATORS = [
  /\ball\s+(?:the\s+)?(?:helmets?|jackets?|boots?|gloves?|pants?|tires?)/i,
  /\bevery\s+(?:helmet|jacket|boot|glove|pant|tire)/i,
  /\bshow\s+me\s+all\b/i,
];

const EXPLICIT_RULES: Record<
  SupportedProductType,
  Array<{ pattern: RegExp; value: SubcategoryValue }>
> = {
  helmet: [
    { pattern: /\bopen[\s-]?face\b|\b3\s*\/\s*4\b|three[\s-]?quarter/i, value: "open_face" },
    { pattern: /\bmodular\b|\bflip[\s-]?up\b/i, value: "modular" },
    { pattern: /\bhalf[\s-]?helmets?\b|\bbeanie\b|\bshorty\b/i, value: "half" },
    { pattern: /\badventure\b|\badv\b|\bdual[\s-]?sport\b/i, value: "adventure" },
    { pattern: /\bmotocross\b|\bmx\b|\boff[\s-]?road\b|\bdirt\b/i, value: "mx" },
    { pattern: /\bfull[\s-]?face\b|\brace\b|\btrack\b/i, value: "full_face" },
  ],
  jacket: [
    { pattern: /\bjersey\b|\bmotocross\b|\bmx\b|\boff[\s-]?road\b|\bdirt\b/i, value: "mx" },
    { pattern: /\badventure\b|\badv\b|\bdual[\s-]?sport\b/i, value: "adventure" },
    { pattern: /\bcruiser\b|\bharley\b|\bleather[\s-]?jacket\b/i, value: "cruiser" },
    { pattern: /\brace\b|\btrack\b|\bleathers\b/i, value: "racing" },
  ],
  boots: [
    { pattern: /\bmx\b|\bmotocross\b|\boff[\s-]?road\b|\bdirt\b/i, value: "mx" },
    { pattern: /\badventure\b|\badv\b|\bdual[\s-]?sport\b/i, value: "adventure" },
    { pattern: /\brace\b|\btrack\b/i, value: "racing" },
    { pattern: /\bcruiser\b|\bharley\b|\bengineer\b/i, value: "cruiser" },
  ],
  gloves: [
    { pattern: /\bmx\b|\bmotocross\b|\boff[\s-]?road\b|\bdirt\b/i, value: "mx" },
    { pattern: /\badventure\b|\badv\b|\bdual[\s-]?sport\b/i, value: "adventure" },
    { pattern: /\bheated\b|\bwinter\b|\bcold[\s-]?weather\b/i, value: "winter" },
    { pattern: /\brace\b|\btrack\b|\bgauntlet\b/i, value: "racing" },
  ],
  pants: [
    { pattern: /\bmx\b|\bmotocross\b|\boff[\s-]?road\b|\bdirt\b/i, value: "mx" },
    { pattern: /\badventure\b|\badv\b|\bdual[\s-]?sport\b/i, value: "adventure" },
    { pattern: /\bcruiser\b|\bharley\b|\bleather[\s-]?pants?\b/i, value: "cruiser" },
  ],
  tire: [
    { pattern: /\bknobby\b|\bdirt\b|\bmotocross\b|\bmx\b|\boff[\s-]?road\b/i, value: "dirt" },
    { pattern: /\badventure\b|\badv\b|\bdual[\s-]?sport\b/i, value: "adventure" },
    { pattern: /\bcruiser\b|\bharley\b/i, value: "cruiser" },
    { pattern: /\bsport[\s-]?touring\b|\btouring\b/i, value: "sport_touring" },
    { pattern: /\bsport\b|\brace\b|\btrack\b/i, value: "sport" },
  ],
};

export function extractSubcategoryRequest(
  query: string,
  productType: SupportedProductType | null
): SubcategoryRequest {
  if (!productType || !(productType in EXPLICIT_RULES)) return null;

  const rules = EXPLICIT_RULES[productType];
  for (const { pattern, value } of rules) {
    if (pattern.test(query)) return { explicit: true, value };
  }

  for (const re of ANY_INDICATORS) {
    if (re.test(query)) return { explicit: false, value: "any" };
  }

  return null;
}

/**
 * Public type guard helper.
 */
export function isSupportedProductType(
  type: string | null
): type is SupportedProductType {
  return (
    type === "helmet" ||
    type === "jacket" ||
    type === "boots" ||
    type === "gloves" ||
    type === "pants" ||
    type === "tire"
  );
}

/**
 * Bias an array of products by their subcategory:
 *   - Explicit request → keep only matching subcategory; if zero, fall back to all.
 *   - Ambiguous (null) → promote STREET_DEFAULT, demote OFF_STREET_SUBCATEGORIES.
 *   - "any" → no reordering.
 *
 * Stable: products with the same subcategory keep their original relative
 * order, so upstream signals (in-stock, premium brand, color match) survive.
 */
export function biasBySubcategory<T extends { _subcategory?: SubcategoryValue | null }>(
  products: T[],
  productType: SupportedProductType,
  request: SubcategoryRequest
): T[] {
  if (products.length === 0) return products;

  if (request && request.explicit) {
    const target = request.value;
    const matching = products.filter((p) => p._subcategory === target);
    if (matching.length > 0) return matching;
    return products;
  }

  if (request && !request.explicit && request.value === "any") {
    return products;
  }

  const target = STREET_DEFAULT[productType];
  const lead: T[] = [];
  const middle: T[] = [];
  const tail: T[] = [];
  for (const p of products) {
    const sub = p._subcategory;
    if (sub === target) {
      lead.push(p);
    } else if (sub && OFF_STREET_SUBCATEGORIES.has(sub)) {
      tail.push(p);
    } else {
      middle.push(p);
    }
  }
  return [...lead, ...middle, ...tail];
}

/**
 * Per-type fallback search phrase used when productSearch.searchProducts has
 * too few results after filtering. This generalizes the previous
 * `PRODUCT_TYPE_MAP[productType][0] + "s"` fallback.
 */
export const STREET_FALLBACK_PHRASE: Record<SupportedProductType, string> = {
  helmet: "full face helmet",
  jacket: "street jacket",
  boots: "street boots",
  gloves: "street gloves",
  pants: "street pants",
  tire: "sport touring tire",
};
