import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const { searchProducts, extractKeywords } = await import("../lib/search/productSearch");
  const { searchLocalCatalog } = await import("../lib/search/localCatalogSearch");

  const query = "do you have metal ramps in stock";
  console.log("=== Query:", query, "===\n");

  const keywords = extractKeywords(query);
  console.log("Keywords extracted:", keywords);
  console.log("Keywords joined:", keywords.join(" "));

  console.log("\n--- Local Catalog Search (keywords joined) ---");
  const localResults = await searchLocalCatalog(keywords.join(" "), 10);
  console.log("Local matches:", localResults.length);
  for (const m of localResults) {
    console.log(`  [score=${m.score.toFixed(2)}] ${m.name} | ${m.price} | ${m.url}`);
  }

  console.log("\n--- Local Catalog Search (just 'ramps') ---");
  const localRamps = await searchLocalCatalog("ramps", 10);
  console.log("Local matches:", localRamps.length);
  for (const m of localRamps) {
    console.log(`  [score=${m.score.toFixed(2)}] ${m.name} | ${m.price} | ${m.url}`);
  }

  console.log("\n--- Local Catalog Search (just 'ramp') ---");
  const localRamp = await searchLocalCatalog("ramp", 10);
  console.log("Local matches:", localRamp.length);
  for (const m of localRamp) {
    console.log(`  [score=${m.score.toFixed(2)}] ${m.name} | ${m.price} | ${m.url}`);
  }

  console.log("\n--- Full searchProducts pipeline ---");
  const result = await searchProducts(query);
  console.log("Final products:", result.products.length);
  console.log("Detected color:", result.detectedColor);
  for (const p of result.products.slice(0, 10)) {
    console.log(`  [id=${p.id}] ${p.name} | $${p.price} | ${p.custom_url?.url}`);
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
