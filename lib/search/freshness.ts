/**
 * Phase B (7/20/2026): generation freshness beyond tires + model-year recency.
 * Pure functions — no I/O, unit-tested directly.
 *
 * WHY CURATED, NOT GENERIC: the 7/20 catalog audit proved that outside tires,
 * numeric suffixes are usually CONCURRENT TIERS, not generations — Alpinestars
 * Tech 3/5/7 boots, Tech-Air 3/5/7X airbags, Leatt 2.5–9.5 protection levels,
 * Alpinestars Vision 3/5/8 goggles, Klim Aggressor/Solstice 1.0/2.0 insulation
 * weights, Cardo Freecom 2X/4X feature tiers. A generic "higher number is
 * newer" matcher would demote live products all over the catalog. So every
 * non-tire family is listed here explicitly, derived from real catalog data
 * where BOTH generations exist. Tires keep the generic single-digit detector
 * in productSearch.ts (computeStaleGenerationPenalties) — tire lines version
 * generationally as a rule.
 *
 * Demotion rules (same contract as the tire mechanism):
 *  - penalty only, never a filter — every product stays reachable
 *  - only when a NEWER generation of the same family is in the same pool
 *  - suppressed when the query names a specific generation of that family
 *    (a bare family name like "gt-air" is NOT an explicit generation request)
 */

import type { BCProduct } from "@/lib/bigcommerce/client";

// Keep equal to STALE_GENERATION_DEMOTION in productSearch.ts: smaller than
// the +30 in-stock bonus so an in-stock older generation still outranks a
// sold-out newer one (B3 precedence, Antonio-approved).
export const CURATED_STALE_DEMOTION = 25;

interface GenerationFamily {
  key: string;
  /**
   * Substring that must appear in the product name for generic family words
   * (guards "Sand 5" against non-REV'IT sands). Omit for patterns that are
   * distinctive on their own (rf-1400, exo-r430, gt-air, neotec).
   */
  brandHint?: string;
  /**
   * Capture group 1 = the generation token (digit or roman numeral). The
   * token may be optional when `unnumberedIsGen1` is set.
   */
  re: RegExp;
  /**
   * Families whose first generation shipped unnumbered ("Shoei GT-Air",
   * "Shoei Neotec"): a family match with no number token parses as gen 1.
   * Applies to PRODUCT names only, never to the query escape hatch.
   */
  unnumberedIsGen1?: boolean;
}

// Real lineages confirmed in the live catalog on 7/20/2026 — both (or all)
// generations physically present. Add entries only with the same evidence.
export const CURATED_GENERATION_FAMILIES: GenerationFamily[] = [
  // Shoei RF street helmets: RF-1100 → RF-1200 → RF-1400 ("RF1100" also
  // appears unhyphenated in shield names). Middle digits order correctly.
  { key: "shoei-rf", re: /\brf-?1([0-9])00\b/ },
  // Shoei X racing helmets: X-12 → X-14 → X-15 (X-12/X-14 live on in
  // accessory/shield names).
  { key: "shoei-x", re: /\bx-?1([2-9])\b/ },
  // Shoei GT-Air: GT-Air (1) → GT-Air II → GT-Air 3. Mixed notation in the
  // catalog: "GT-Air II Helmet", "GT-Air 3 Helmet", "GT-Air3/Neotec3".
  {
    key: "shoei-gt-air",
    re: /\bgt[ -]?air\s?-?(3|ii|2)?\b/,
    unnumberedIsGen1: true,
  },
  // Shoei Neotec modulars: Neotec (1) → Neotec 2 → Neotec 3.
  {
    key: "shoei-neotec",
    re: /\bneotec\s?-?(3|ii|2)?\b/,
    unnumberedIsGen1: true,
  },
  // Scorpion EXO-R4x0 full-face: R410 → R420 → R430.
  { key: "scorpion-exo-r4", re: /\bexo-r4([0-9])0\b/ },
  // Scorpion EXO-AT9x0 adventure: AT950 → AT960.
  { key: "scorpion-exo-at9", re: /\bexo-at9([0-9])0\b/ },
  // REV'IT numbered gear lines — numbers are generations consistently.
  // brandHint guards the generic family words. The (?![0-9/]) tail keeps
  // fractions ("1/4") and multi-digit numbers out.
  { key: "revit-sand", brandHint: "rev'it", re: /\bsand\s+([1-9])(?![0-9/])/ },
  { key: "revit-hydra", brandHint: "rev'it", re: /\bhydra\s+([1-9])(?![0-9/])/ },
  { key: "revit-quantum", brandHint: "rev'it", re: /\bquantum\s+([1-9])(?![0-9/])/ },
  { key: "revit-tracer-air", brandHint: "rev'it", re: /\btracer air\s+([1-9])(?![0-9/])/ },
  { key: "revit-acid", brandHint: "rev'it", re: /\bacid\s+([1-9])(?![0-9/])/ },
  { key: "revit-hyperspeed", brandHint: "rev'it", re: /\bhyperspeed\s+([1-9])(?![0-9/])/ },
  // Sidi Crossfire MX boots: Crossfire (1) → 2 → 3. NOT unnumberedIsGen1 —
  // "Crossfire 1/4 Turn Screws" is a fraction, and the tail guard skips it.
  { key: "sidi-crossfire", brandHint: "sidi", re: /\bcrossfire\s+([1-9])(?![0-9/])/ },
];

const ROMAN: Record<string, number> = { ii: 2, iii: 3, iv: 4 };

function parseGenerationToken(token: string): number {
  const roman = ROMAN[token.toLowerCase()];
  return roman ?? Number(token);
}

/**
 * Which curated family (if any) a product name belongs to, and its parsed
 * generation. A name can belong to multiple families (combo accessory names
 * like "RF-1200/X-14/RFSR Shields") — all matches are returned.
 */
export function extractCuratedGenerations(
  name: string
): Array<{ key: string; generation: number }> {
  const lower = name.toLowerCase();
  const out: Array<{ key: string; generation: number }> = [];
  for (const fam of CURATED_GENERATION_FAMILIES) {
    if (fam.brandHint && !lower.includes(fam.brandHint)) continue;
    const m = lower.match(fam.re);
    if (!m) continue;
    if (m[1]) {
      out.push({ key: fam.key, generation: parseGenerationToken(m[1]) });
    } else if (fam.unnumberedIsGen1) {
      out.push({ key: fam.key, generation: 1 });
    }
  }
  return out;
}

/**
 * Generation digits/numerals the QUERY names explicitly, per family. A bare
 * family word without a number ("gt-air helmet") names no generation and
 * never suppresses demotion; "gt-air 2" / "gt-air ii" / "rf-1200" do.
 */
function explicitQueryGenerations(queryLower: string): Map<string, Set<number>> {
  const out = new Map<string, Set<number>>();
  for (const fam of CURATED_GENERATION_FAMILIES) {
    // brandHint intentionally NOT required on the query side: customers type
    // "sand 4 gloves" without the brand.
    const m = queryLower.match(fam.re);
    if (!m || !m[1]) continue;
    const set = out.get(fam.key) ?? new Set<number>();
    set.add(parseGenerationToken(m[1]));
    out.set(fam.key, set);
  }
  return out;
}

/**
 * Map of productId → penalty for pool members that are a stale generation of
 * a curated family whose newer generation is also in the pool. Mirrors the
 * tire mechanism's contract exactly (see computeStaleGenerationPenalties).
 */
export function computeCuratedStalePenalties(
  products: BCProduct[],
  queryLower: string
): Map<number, number> {
  const families = new Map<
    string,
    { maxGen: number; members: Array<{ id: number; generation: number }> }
  >();
  for (const p of products) {
    for (const info of extractCuratedGenerations(p.name)) {
      const fam = families.get(info.key) ?? { maxGen: 0, members: [] };
      fam.maxGen = Math.max(fam.maxGen, info.generation);
      fam.members.push({ id: p.id, generation: info.generation });
      families.set(info.key, fam);
    }
  }

  const explicit = explicitQueryGenerations(queryLower);
  const penalties = new Map<number, number>();
  for (const [key, fam] of Array.from(families.entries())) {
    const distinctGens = new Set(fam.members.map((m) => m.generation));
    if (distinctGens.size < 2) continue;
    // Customer named a generation from this family — respect their choice.
    if (explicit.has(key)) continue;
    for (const m of fam.members) {
      if (m.generation < fam.maxGen) {
        penalties.set(m.id, CURATED_STALE_DEMOTION);
      }
    }
  }
  return penalties;
}

// ---------------------------------------------------------------------------
// B2: model-year recency boost
// ---------------------------------------------------------------------------

// Mild by design (B3 precedence): max +5 sits below every real signal —
// keyword +10, head-noun +15, in-stock +30 — so an in-stock older-year
// product always beats a sold-out newer-year one, and products with no year
// token are NEUTRAL (absence of a year is not "old").
export const YEAR_BOOST_MAX = 5;

const YEAR_TOKEN_RE = /(^|[^0-9'])((?:19|20)[0-9]{2})(?![0-9])/g;
const YEAR_RANGE_RE = /\b(?:19|20)[0-9]{2}\s*-\s*(?:(?:19|20)[0-9]{2}|present)\b/gi;
const SHORT_RANGE_RE = /'[0-9]{2}\s*-\s*'[0-9]{2}/g;

/**
 * The product's model year from its title ("2023 Klim Marrakesh Jacket",
 * "Scorpion 2025 EXO-R430"). Fitment RANGES ("2020-2025", "'16-'19",
 * "2020-Present") are bike compatibility spans, not product years — every
 * year inside a range is ignored. Returns null when no standalone year in
 * [2015, nowYear + 1] remains.
 */
export function extractModelYear(
  name: string,
  nowYear: number = new Date().getFullYear()
): number | null {
  // Blank out range spans first so their endpoints can't match.
  const cleaned = name
    .replace(YEAR_RANGE_RE, " ")
    .replace(SHORT_RANGE_RE, " ");
  let best: number | null = null;
  let m: RegExpExecArray | null;
  YEAR_TOKEN_RE.lastIndex = 0;
  while ((m = YEAR_TOKEN_RE.exec(cleaned)) !== null) {
    const y = Number(m[2]);
    if (y >= 2015 && y <= nowYear + 1 && (best === null || y > best)) best = y;
  }
  return best;
}

/**
 * 0..YEAR_BOOST_MAX points: current/next model year earns the max, minus one
 * per year of age, floor 0. No year token → 0 (neutral).
 */
export function yearRecencyBoost(
  name: string,
  nowYear: number = new Date().getFullYear()
): number {
  const year = extractModelYear(name, nowYear);
  if (year === null) return 0;
  return Math.max(0, YEAR_BOOST_MAX - Math.max(0, nowYear - year));
}
