import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const { getProductByNameLike } = await import("../lib/bigcommerce/client");

  const names = [
    'Fly Folding Arched Aluminum Ramp 88"x11.5"',
    "Quadboss Quadlite Arched Aluminum Ramp 89\"x12\"",
    "RevArc ATV Loading Ramp 90\"x55\"",
    "Bikemaster Stair Ramp",
  ];

  for (const name of names) {
    console.log(`\n--- Enriching: "${name}" ---`);
    let products = await getProductByNameLike(name, 10);
    console.log(`  Full name search: ${products.length} results`);
    for (const p of products.slice(0, 3)) {
      console.log(`    [${p.id}] ${p.name}`);
    }

    if (products.length === 0) {
      const shortName = name.split(/\s+/).slice(0, 3).join(" ");
      console.log(`  Trying short name: "${shortName}"`);
      products = await getProductByNameLike(shortName, 10);
      console.log(`  Short name search: ${products.length} results`);
      for (const p of products.slice(0, 3)) {
        console.log(`    [${p.id}] ${p.name}`);
      }
    }
  }

  console.log("\n--- Direct BC keyword search for 'ramp' ---");
  const { searchProductsBC } = await import("../lib/bigcommerce/client");
  const bcResults = await searchProductsBC("ramp");
  console.log(`BC keyword 'ramp': ${bcResults.length} results`);
  for (const p of bcResults.slice(0, 6)) {
    console.log(`  [${p.id}] ${p.name}`);
  }

  console.log("\n--- Direct BC keyword search for 'metal ramps' ---");
  const bcResults2 = await searchProductsBC("metal ramps");
  console.log(`BC keyword 'metal ramps': ${bcResults2.length} results`);
  for (const p of bcResults2.slice(0, 6)) {
    console.log(`  [${p.id}] ${p.name}`);
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
