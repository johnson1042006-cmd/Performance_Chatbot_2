import { searchProducts, productHasColor } from "@/lib/search/productSearch";
import { expandColorQuery } from "@/lib/search/colorSynonyms";

async function main() {
  const query = "show me a blue street helmet";
  console.log(`\n=== Running searchProducts("${query}") ===\n`);

  const { products, detectedColor } = await searchProducts(query);
  console.log("detectedColor:", detectedColor);
  console.log("Total products returned:", products.length);
  console.log("");

  const expanded = new Set(
    expandColorQuery("blue").map((c) => c.toLowerCase())
  );

  let withVariants = 0;
  let withColorOption = 0;
  let withBlueMatch = 0;

  for (const p of products.slice(0, 10)) {
    const hasVariants = !!(p.variants && p.variants.length > 0);
    if (hasVariants) withVariants++;

    const hasColorOpt = (p.variants || []).some((v) =>
      (v.option_values || []).some(
        (ov) =>
          ov.option_display_name &&
          ov.option_display_name.toLowerCase().includes("color")
      )
    );
    if (hasColorOpt) withColorOption++;

    const matches = productHasColor(p, expanded);
    if (matches) withBlueMatch++;

    console.log(`- ${p.name}`);
    console.log(`    variants: ${p.variants?.length ?? 0}`);
    console.log(`    has color option: ${hasColorOpt}`);
    console.log(`    productHasColor(blue): ${matches}`);
    if (hasColorOpt) {
      const colorLabels = (p.variants || [])
        .flatMap((v) =>
          (v.option_values || [])
            .filter(
              (ov) =>
                ov.option_display_name &&
                ov.option_display_name.toLowerCase().includes("color")
            )
            .map((ov) => ov.label)
        )
        .filter(Boolean);
      console.log(`    color labels: ${JSON.stringify(colorLabels)}`);
    }
    console.log("");
  }

  console.log("=== Summary (top 10) ===");
  console.log(`With variants loaded: ${withVariants} / 10`);
  console.log(`With color option: ${withColorOption} / 10`);
  console.log(`productHasColor matched blue: ${withBlueMatch} / 10`);

  process.exit(0);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
