/**
 * Catalog skeleton — a compact structural summary of the store's inventory,
 * injected into every system prompt so the LLM knows what types and brands
 * the store carries even when keyword search returns nothing.
 *
 * Fixes:
 *   Q1  — Alpinestars MX helmets not surfaced when search misses
 *   Bug C — Bluetooth communicators (Cardo/Sena) not known to exist
 *
 * Also hosts the broad product-type classifier (formerly lib/catalog/classify.ts)
 * so catalog tooling has a single import target.
 */

import {
  classifyProductSubcategoryByText,
  type SupportedProductType,
} from "@/lib/search/subcategory";
import type { BCProduct } from "@/lib/bigcommerce/client";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface CatalogSkeleton {
  generatedAt: string;
  /** type → brand → subcategories[] (subcats "other"/"general" collapsed out) */
  byType: Record<string, Record<string, string[]>>;
}

// ---------------------------------------------------------------------------
// Rendering constants
// ---------------------------------------------------------------------------

/**
 * Rich types get a multi-line block: one indented line per brand listing its
 * subcategories (e.g. "  Alpinestars: adventure, full_face, mx").
 */
const RICH_TYPES = new Set([
  "helmet",
  "jacket",
  "boots",
  "gloves",
  "pants",
  "tire",
  "comm",
  "pack",
  "protection",
]);

/**
 * Flat types (and any type not in RICH_TYPES) get a single
 * "type: Brand A, Brand B, …" line.
 *
 * goggles | brake | sprocket | chain | filter | casual
 * + leftovers: heated | snow | e_bike | parts | accessory | chemical | tool
 */

// ---------------------------------------------------------------------------
// buildSkeletonFromDump
// ---------------------------------------------------------------------------

interface DumpJson {
  generatedAt: string;
  /** brand → productType → subcategory → product names[] */
  tree: Record<string, Record<string, Record<string, string[]>>>;
}

/**
 * Build an inverted CatalogSkeleton from the raw catalog dump produced by
 * scripts/dump-catalog.ts.
 *
 * - Drops `productType === "other"` entirely.
 * - Collapses subcategory keys named "other" or "general" (they add no
 *   information for the LLM — the brand's presence in the type is enough).
 */
export function buildSkeletonFromDump(dumpJson: DumpJson): CatalogSkeleton {
  const byType: Record<string, Record<string, string[]>> = {};

  for (const [brand, types] of Object.entries(dumpJson.tree)) {
    for (const [productType, subcats] of Object.entries(types)) {
      if (productType === "other") continue;

      if (!byType[productType]) byType[productType] = {};

      const meaningfulSubcats = Object.keys(subcats).filter(
        (s) => s !== "other" && s !== "general"
      );

      if (!byType[productType][brand]) {
        byType[productType][brand] = meaningfulSubcats;
      } else {
        // A brand can appear under the same type from multiple passes; merge.
        for (const s of meaningfulSubcats) {
          if (!byType[productType][brand].includes(s)) {
            byType[productType][brand].push(s);
          }
        }
      }
    }
  }

  return { generatedAt: dumpJson.generatedAt, byType };
}

// ---------------------------------------------------------------------------
// formatSkeletonForPrompt
// ---------------------------------------------------------------------------

/**
 * Render the skeleton as a compact, human-readable (and LLM-readable) string.
 *
 * Rich types (helmet, jacket, boots, gloves, pants, tire, comm, pack,
 * protection) get a multi-line block with subcategories per brand:
 *
 *   helmet:
 *     Alpinestars: adventure, full_face, mx
 *     Bell: full_face, mx, modular
 *
 * Flat types (goggles, brake, sprocket, chain, filter, casual) and any
 * remaining unrecognised types get a single-line summary:
 *
 *   goggles: 100%, Answer, Dragon, Fox Racing, Oakley, Scott
 *
 * Brands are sorted alphabetically within each type. Type "other" is never
 * rendered.
 */
export function formatSkeletonForPrompt(skel: CatalogSkeleton): string {
  const lines: string[] = [];

  // Render rich types first (apparel / gear categories customers ask about).
  const richKeys = Object.keys(skel.byType)
    .filter((t) => RICH_TYPES.has(t))
    .sort();

  for (const type of richKeys) {
    lines.push(`${type}:`);
    const brands = Object.keys(skel.byType[type]).sort();
    for (const brand of brands) {
      const subcats = skel.byType[type][brand].slice().sort();
      if (subcats.length > 0) {
        lines.push(`  ${brand}: ${subcats.join(", ")}`);
      } else {
        lines.push(`  ${brand}`);
      }
    }
  }

  // Flat types — known undifferentiated categories + any leftover unknown types.
  const flatKeys = Object.keys(skel.byType)
    .filter((t) => !RICH_TYPES.has(t) && t !== "other")
    .sort();

  for (const type of flatKeys) {
    const brands = Object.keys(skel.byType[type]).sort();
    lines.push(`${type}: ${brands.join(", ")}`);
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Broad product-type classifier (moved from lib/catalog/classify.ts)
//
// Classifies a product into a BroadProductType using BC category names as the
// authoritative signal.  The product name is deliberately NOT inspected —
// name-based matching caused Bug C where "Cardo Freecom 2nd Helmet Audio Kit"
// was routed to `helmet` because of the word "Helmet" in the product title.
// ---------------------------------------------------------------------------

export type BroadProductType =
  | "helmet"
  | "jacket"
  | "boots"
  | "gloves"
  | "pants"
  | "tire"
  | "comm"
  | "goggles"
  | "pack"
  | "protection"
  | "tool"
  | "chemical"
  | "brake"
  | "filter"
  | "sprocket"
  | "chain"
  | "heated"
  | "casual"
  | "e_bike"
  | "snow"
  | "parts"
  | "accessory"
  | "other";

export interface ClassifyInput {
  name: string;
  categories?: string[];
  brand?: string | null;
}

// ---------------------------------------------------------------------------
// Pass 1 — exact / contains matches on BC category names
// Order is critical — first match wins.
// ---------------------------------------------------------------------------

const RIDING_GEAR_ROOTS = new Set([
  "Helmets",
  "Jackets",
  "Pants",
  "Boots",
  "Gloves",
  "Riding Gear",
]);

function pass1(cats: string[]): BroadProductType | null {
  const set = new Set(cats);

  // a) Comm Systems / Electronics → comm  (Bug C fix — must be before any
  //    helmet/apparel check so product name "…Helmet Audio Kit" never fires).
  //    Exception: if the product is also in "Helmets" it is a helmet with
  //    electronics (e.g. SM-10, S-M7, SENA Phantom) — let the helmet pass win.
  if (
    set.has("Comm Systems") ||
    (set.has("Electronics") && !set.has("Helmets"))
  )
    return "comm";

  // b) Brake
  if (set.has("Brake Pads/Brake Shoes")) return "brake";

  // c) Filters
  if (set.has("Air Filters") || set.has("Oil Filters")) return "filter";

  // d) Sprockets
  if (set.has("Sprockets") || cats.some((c) => c.includes("Sprocket")))
    return "sprocket";

  // e) Goggles
  if (
    set.has("Goggles") ||
    set.has("Snow Goggles") ||
    set.has("Kids Goggles") ||
    set.has("Glasses/Goggles")
  )
    return "goggles";

  // f) Pack / luggage
  if (
    set.has("Luggage") ||
    set.has("Packs and Bags") ||
    set.has("Backpacks") ||
    set.has("Gear Bags") ||
    set.has("Fender Bags") ||
    set.has("Saddlebags")
  )
    return "pack";

  // g) Protection
  if (
    set.has("Protection") ||
    set.has("Chest Protectors") ||
    set.has("Knee Braces") ||
    set.has("Neck Braces")
  )
    return "protection";

  // h) Chain Lube → chemical (BEFORE chain check)
  if (set.has("Chain Lube")) return "chemical";

  // i) Chain Tools → tool (BEFORE chain check)
  if (set.has("Chain Tools")) return "tool";

  // j) Chains / Chain
  if (set.has("Chains") || set.has("Chain")) return "chain";

  // k) Tools (after Chain Tools was already excluded above)
  if (set.has("Tools") || cats.some((c) => c.includes("Tools")))
    return "tool";

  // l) Chemicals / Maintenance
  if (set.has("Chemicals") || set.has("Maintenance")) return "chemical";

  // m) Heated Gear (BEFORE jacket/pants/gloves so a heated jacket → heated)
  if (set.has("Heated Gear") || cats.some((c) => c.includes("Heated")))
    return "heated";

  // n) Snow / Backcountry
  if (set.has("Snow Plows") || set.has("Backcountry")) return "snow";

  return null;
}

// ---------------------------------------------------------------------------
// Pass 2 — existing 6 product-type roots + specific helmet sub-category names
// ---------------------------------------------------------------------------

const BROAD_TYPE_ROOT_NAMES: Record<SupportedProductType, RegExp> = {
  helmet: /^helmets?$/i,
  jacket: /^jackets?$/i,
  boots: /^boots?$/i,
  gloves: /^gloves?$/i,
  pants: /^pants?$/i,
  tire: /^tires?$/i,
};

const HELMET_SUBCATEGORY_NAMES = new Set([
  "Street Helmets",
  "Full Face",
  "Half Helmets",
  "Modular Helmets",
  "MX Helmets",
  "Adventure Helmets",
]);

function pass2(cats: string[]): BroadProductType | null {
  for (const cat of cats) {
    if (HELMET_SUBCATEGORY_NAMES.has(cat)) return "helmet";
    if (cat === "Tubes") return "tire";
    for (const [pt, re] of Object.entries(BROAD_TYPE_ROOT_NAMES) as [
      SupportedProductType,
      RegExp,
    ][]) {
      if (re.test(cat)) return pt;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Pass 3 — Casual (no riding-gear ancestor)
// ---------------------------------------------------------------------------

function pass3(cats: string[]): BroadProductType | null {
  if (!cats.includes("Casual")) return null;
  if (cats.some((c) => RIDING_GEAR_ROOTS.has(c))) return null;
  return "casual";
}

// ---------------------------------------------------------------------------
// Pass 4 — E-bike
// ---------------------------------------------------------------------------

const EBIKE_BRANDS = new Set([
  "Stacyc",
  "Super73",
  "Stage2",
  "79Bike",
  "E Ride Pro",
]);

function pass4(cats: string[], brand: string | null | undefined): BroadProductType | null {
  if (
    cats.includes("E Bikes") ||
    cats.includes("E-Bike") ||
    cats.includes("Stacyc")
  )
    return "e_bike";
  if (brand && EBIKE_BRANDS.has(brand)) return "e_bike";
  return null;
}

// ---------------------------------------------------------------------------
// Pass 5 — Snow
// ---------------------------------------------------------------------------

function pass5(cats: string[]): BroadProductType | null {
  if (cats.includes("Snow") || cats.includes("Snowmobile Gear")) return "snow";
  return null;
}

// ---------------------------------------------------------------------------
// Pass 6 — Parts / Accessory catch-all
// ---------------------------------------------------------------------------

function pass6(cats: string[]): BroadProductType | null {
  if (cats.includes("Parts")) return "parts";
  if (cats.includes("Accessories")) return "accessory";
  return null;
}

/**
 * Classify a product into a BroadProductType using BC category names as the
 * authoritative signal.  The product name is deliberately NOT inspected —
 * name-based matching caused Bug C where "Cardo Freecom 2nd Helmet Audio Kit"
 * was routed to `helmet` because of the word "Helmet" in the product title.
 */
export function classifyBroadCategory(product: ClassifyInput): BroadProductType {
  const cats = product.categories ?? [];

  return (
    pass1(cats) ??
    pass2(cats) ??
    pass3(cats) ??
    pass4(cats, product.brand) ??
    pass5(cats) ??
    pass6(cats) ??
    "other"
  );
}

// ---------------------------------------------------------------------------
// Category-name → subcategory pre-check for the 6 delegated types
//
// Mirrors CATEGORY_NAME_RULES in lib/search/subcategory.ts. We cannot call
// the runtime category-tree path directly (it requires the async BC id map);
// instead we match against the resolved category NAME strings that the dump
// script already has. This fires BEFORE the text classifier so products whose
// names lack explicit discipline keywords (e.g. SM-10 / S-M7 are in "Offroad
// Helmets" but their names contain no "mx" or "offroad") still classify correctly.
// ---------------------------------------------------------------------------

const CAT_SUB_RULES: Partial<
  Record<SupportedProductType, Array<{ pattern: RegExp; value: string }>>
> = {
  helmet: [
    { pattern: /open[\s-]?face/i,                             value: "open_face"  },
    { pattern: /modular|flip[\s-]?up/i,                       value: "modular"    },
    { pattern: /half|beanie|shorty|3\s*\/\s*4|three[\s-]?quarter/i, value: "half" },
    { pattern: /adventure|adv|dual[\s-]?sport/i,              value: "adventure"  },
    { pattern: /moto|mx|motocross|off[\s-]?road|dirt/i,       value: "mx"         },
    { pattern: /street|sport|race|track|full[\s-]?face/i,     value: "full_face"  },
  ],
  jacket: [
    { pattern: /moto|mx|motocross|off[\s-]?road|dirt|jersey/i, value: "mx"       },
    { pattern: /adventure|adv|dual[\s-]?sport/i,               value: "adventure" },
    { pattern: /cruiser|harley|leather/i,                      value: "cruiser"   },
    { pattern: /race|track/i,                                  value: "racing"    },
  ],
  boots: [
    { pattern: /moto|mx|motocross|off[\s-]?road|dirt/i, value: "mx"       },
    { pattern: /adventure|adv|dual[\s-]?sport/i,        value: "adventure" },
    { pattern: /cruiser|harley/i,                       value: "cruiser"   },
    { pattern: /race|track/i,                           value: "racing"    },
  ],
  gloves: [
    { pattern: /moto|mx|motocross|off[\s-]?road|dirt/i, value: "mx"       },
    { pattern: /adventure|adv|dual[\s-]?sport/i,        value: "adventure" },
    { pattern: /heated|winter|cold[\s-]?weather/i,      value: "winter"    },
    { pattern: /race|track|gauntlet/i,                  value: "racing"    },
  ],
  pants: [
    { pattern: /moto|mx|motocross|off[\s-]?road|dirt/i, value: "mx"       },
    { pattern: /adventure|adv|dual[\s-]?sport/i,        value: "adventure" },
    { pattern: /cruiser|harley|leather/i,               value: "cruiser"   },
  ],
  tire: [
    { pattern: /off[\s-]?road|dirt|knobby|mx|motocross/i,  value: "dirt"          },
    { pattern: /adventure|adv|dual[\s-]?sport/i,           value: "adventure"     },
    { pattern: /cruiser|harley/i,                          value: "cruiser"       },
    { pattern: /sport[\s-]?touring|touring/i,              value: "sport_touring" },
  ],
};

function catSubcategory(
  cats: string[],
  type: SupportedProductType
): string | null {
  const rules = CAT_SUB_RULES[type];
  if (!rules) return null;
  for (const cat of cats) {
    for (const { pattern, value } of rules) {
      if (pattern.test(cat)) return value;
    }
  }
  return null;
}

/**
 * Given a broad type, return a normalized subcategory string.
 *
 * For the 6 types that lib/search/subcategory.ts already handles
 * (helmet/jacket/boots/gloves/pants/tire), we first try BC category names
 * (more reliable for products whose names lack explicit discipline keywords),
 * then fall back to the text-based classifier.
 */
export function classifyBroadSubcategory(
  product: ClassifyInput,
  broadType: BroadProductType
): string {
  if (
    broadType === "helmet" ||
    broadType === "jacket" ||
    broadType === "boots" ||
    broadType === "gloves" ||
    broadType === "pants" ||
    broadType === "tire"
  ) {
    const fromCat = catSubcategory(product.categories ?? [], broadType);
    if (fromCat) return fromCat;

    const shim = { name: product.name, description: "" } as BCProduct;
    return classifyProductSubcategoryByText(shim, broadType);
  }

  const name = product.name.toLowerCase();

  if (broadType === "comm") {
    if (
      /intercom|packtalk|freecom|30k|50r|spirit|shoei\s*sena/i.test(name)
    )
      return "intercom";
    if (/speaker|audio/i.test(name)) return "audio";
    return "general";
  }

  if (broadType === "pack") {
    if (/tank[\s-]?bag/i.test(name)) return "tank";
    if (/saddle/i.test(name)) return "saddle";
    if (/tail/i.test(name)) return "tail";
    if (/fender/i.test(name)) return "fender";
    return "general";
  }

  if (broadType === "protection") {
    if (/chest/i.test(name)) return "chest";
    if (/elbow/i.test(name)) return "elbow";
    if (/knee/i.test(name)) return "knee";
    if (/neck/i.test(name)) return "neck";
    return "general";
  }

  return "general";
}
