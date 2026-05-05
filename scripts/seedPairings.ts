import { db } from "../lib/db";
import { productColorways, productPairings } from "../lib/db/schema";
import { isNotNull } from "drizzle-orm";

async function seedPairings() {
  console.log("Fetching products from productColorways...");

  const rows = await db
    .selectDistinctOn([productColorways.baseSku], {
      brand: productColorways.brand,
      category: productColorways.category,
      baseSku: productColorways.baseSku,
      productName: productColorways.productName,
      bcProductId: productColorways.bcProductId,
    })
    .from(productColorways)
    .where(isNotNull(productColorways.baseSku));

  console.log(`Found ${rows.length} unique products with SKUs\n`);

  const catOf  = (p: (typeof rows)[0]) => (p.category    || "").toLowerCase();
  const nameOf = (p: (typeof rows)[0]) => (p.productName || "").toLowerCase();

  // ── Helmets: category OR product name contains "helmet" ──────────────────
  const helmets = rows.filter(
    (p) => catOf(p).includes("helmet") || nameOf(p).includes("helmet")
  );

  // ── Comms: Cardo or Sena brand ───────────────────────────────────────────
  const comms = rows.filter(
    (p) =>
      (p.brand || "").toLowerCase().includes("cardo") ||
      (p.brand || "").toLowerCase().includes("sena")
  );

  console.log(`Helmets: ${helmets.length}, Comms: ${comms.length}`);

  // ── Group by brand ────────────────────────────────────────────────────────
  const byBrand = new Map<string, typeof rows>();
  for (const p of rows) {
    const brand = (p.brand || "Unknown").trim();
    if (!byBrand.has(brand)) byBrand.set(brand, []);
    byBrand.get(brand)!.push(p);
  }

  const pairings: {
    primarySku: string;
    pairedSku: string;
    pairingType: "matching_pants" | "matching_jacket" | "accessory";
  }[] = [];

  // ── 1. Jacket ↔ Pants per brand ──────────────────────────────────────────
  for (const [brand, brandProducts] of byBrand) {
    const jackets = brandProducts.filter(
      (p) =>
        (catOf(p).includes("jacket") || nameOf(p).includes("jacket")) &&
        !nameOf(p).includes("rain")
    );
    const pants = brandProducts.filter(
      (p) =>
        catOf(p).includes("pant") ||
        catOf(p).includes("bib") ||
        nameOf(p).includes(" pant") ||
        nameOf(p).includes(" bib")
    );
    if (!jackets.length || !pants.length) continue;

    console.log(`${brand}: ${jackets.length} jackets × ${pants.length} pants`);
    // Log specifics for key brands
    if (["Klim", "Fox Racing", "Fly Racing", "Alpinestars", "REV'IT!"].includes(brand)) {
      jackets.slice(0, 6).forEach((j) => console.log(`  jacket: ${j.productName}`));
      pants.slice(0, 6).forEach((p)   => console.log(`  pant:   ${p.productName}`));
    }

    for (const jacket of jackets.slice(0, 6)) {
      for (const pant of pants.slice(0, 6)) {
        if (!jacket.baseSku || !pant.baseSku) continue;
        if (jacket.baseSku === pant.baseSku) continue;
        pairings.push({ primarySku: jacket.baseSku, pairedSku: pant.baseSku, pairingType: "matching_pants" });
        pairings.push({ primarySku: pant.baseSku,   pairedSku: jacket.baseSku, pairingType: "matching_jacket" });
      }
    }
  }

  // ── 2. Helmet → Comms ────────────────────────────────────────────────────
  const topComms = comms.slice(0, 4);
  for (const helmet of helmets.slice(0, 40)) {
    for (const comm of topComms) {
      if (!helmet.baseSku || !comm.baseSku) continue;
      pairings.push({ primarySku: helmet.baseSku, pairedSku: comm.baseSku, pairingType: "accessory" });
    }
  }

  // ── 3. Jacket → Gloves (same brand) ─────────────────────────────────────
  for (const [brand, brandProducts] of byBrand) {
    const jackets = brandProducts.filter(
      (p) =>
        (catOf(p).includes("jacket") || nameOf(p).includes("jacket")) &&
        !nameOf(p).includes("rain")
    );
    const gloves = brandProducts.filter(
      (p) => catOf(p).includes("glove") || nameOf(p).includes("glove")
    );
    if (!jackets.length || !gloves.length) continue;
    for (const jacket of jackets.slice(0, 4)) {
      for (const glove of gloves.slice(0, 3)) {
        if (!jacket.baseSku || !glove.baseSku) continue;
        pairings.push({ primarySku: jacket.baseSku, pairedSku: glove.baseSku, pairingType: "accessory" });
      }
    }
  }

  // ── 4. Boots → Matching Gloves (same brand, same discipline) ────────────
  for (const [brand, brandProducts] of byBrand) {
    const boots = brandProducts.filter(
      (p) => catOf(p).includes("boot") || nameOf(p).includes(" boot")
    );
    const gloves = brandProducts.filter(
      (p) => catOf(p).includes("glove") || nameOf(p).includes("glove")
    );
    if (!boots.length || !gloves.length) continue;
    for (const boot of boots.slice(0, 3)) {
      for (const glove of gloves.slice(0, 2)) {
        if (!boot.baseSku || !glove.baseSku) continue;
        pairings.push({ primarySku: boot.baseSku, pairedSku: glove.baseSku, pairingType: "accessory" });
      }
    }
  }

  // ── Deduplicate ──────────────────────────────────────────────────────────
  const seen = new Set<string>();
  const deduped = pairings.filter((p) => {
    const key = `${p.primarySku}|${p.pairedSku}|${p.pairingType}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  console.log(`\nTotal pairings to insert: ${deduped.length}`);

  if (process.argv.includes("--dry-run")) {
    console.log("\nDRY RUN — no changes made. Remove --dry-run to apply.");
    process.exit(0);
  }

  await db.delete(productPairings);
  console.log("Deleted existing pairings");

  for (let i = 0; i < deduped.length; i += 100) {
    await db.insert(productPairings).values(deduped.slice(i, i + 100));
    process.stdout.write(`\rInserted ${Math.min(i + 100, deduped.length)}/${deduped.length}`);
  }

  console.log("\nDone!");
  process.exit(0);
}

seedPairings().catch((e) => { console.error(e); process.exit(1); });
