/**
 * Phase B verification (7/20/2026): run real searchProducts calls and show
 * where each generation of a curated family lands, plus year-boost effects.
 * Read-only against BigCommerce/DB — no model calls. Usage:
 *   npx tsx --env-file=.env.local scripts/check-freshness-ranking.ts
 */
import { searchProducts } from "@/lib/search/productSearch";
import { extractCuratedGenerations } from "@/lib/search/freshness";

// Pass queries as argv (space invocations out — BigCommerce rate-limits
// bursts of category lookups); default covers a two-generation case.
const QUERIES = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ["shoei modular helmet"];

async function main() {
  for (const q of QUERIES) {
    const { products } = await searchProducts(q);
    console.log(`\n=== "${q}" — ${products.length} results ===`);
    products.slice(0, 12).forEach((p, i) => {
      const gens = extractCuratedGenerations(p.name)
        .map((g) => `${g.key}:g${g.generation}`)
        .join(",");
      console.log(
        `${String(i + 1).padStart(2)}. ${p.name}${gens ? `   [${gens}]` : ""}`
      );
    });
  }
}

main().then(() => process.exit(0));
