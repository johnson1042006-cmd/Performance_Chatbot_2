/**
 * Catalog skeleton — a compact structural summary of the store's inventory,
 * injected into every system prompt so the LLM knows what types and brands
 * the store carries even when keyword search returns nothing.
 *
 * Fixes:
 *   Q1  — Alpinestars MX helmets not surfaced when search misses
 *   Bug C — Bluetooth communicators (Cardo/Sena) not known to exist
 */

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
