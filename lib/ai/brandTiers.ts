/**
 * Brand tier lookup — Phase A5 measurement (7/20/2026).
 *
 * Mirrors the premium/budget brand lists in the `brand_preference` rule
 * (lib/ai/rules.ts). Today this only feeds the `ai.ranking_snapshot`
 * telemetry that measures whether the prompt-level premium-first rule is
 * actually followed in production. If Phase C promotes premium-first into a
 * ranking signal, this module is the single source of truth for tiers —
 * extend here, don't fork the lists.
 *
 * Keep in sync with the rules.ts `brand_preference` prose when brands change.
 */

export const PREMIUM_BRANDS: string[] = [
  "alpinestars", "shoei", "arai", "schuberth", "sidi", "klim",
  "rev'it", "revit", "rev it",
  "fox racing",
  "bell", "scorpion", "gaerne", "dainese", "agv", "nolan",
  "michelin", "dunlop", "pirelli",
];

export const BUDGET_BRANDS: string[] = [
  "bilt", "fly racing", "fly", "highway 21", "z1r",
  "tourmaster", "tour master", "noru", "thor",
];

export type BrandTier = "premium" | "budget" | "other";

function matchesBrand(nameLower: string, brand: string): boolean {
  const escaped = brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`).test(nameLower);
}

/**
 * Tier of the brand appearing in a product name (word-boundary match, so
 * "Bell MX-9" is premium but "Campbell" is not). Premium wins if a name
 * somehow matches both lists. "other" for unknown/mid-range brands.
 */
export function brandTierOf(productName: string | null | undefined): BrandTier {
  if (!productName) return "other";
  const lower = productName.toLowerCase();
  if (PREMIUM_BRANDS.some((b) => matchesBrand(lower, b))) return "premium";
  if (BUDGET_BRANDS.some((b) => matchesBrand(lower, b))) return "budget";
  return "other";
}
