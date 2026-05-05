import { db } from "../lib/db";
import { productColorways, productPairings } from "../lib/db/schema";
import { isNotNull } from "drizzle-orm";

type PairingType = "matching_pants" | "matching_jacket" | "accessory";

interface SeedProduct {
  brand: string | null;
  category: string | null;
  baseSku: string | null;
  productName: string | null;
  bcProductId: number | null;
}

function idSku(p: SeedProduct): string | null {
  return p.bcProductId ? `ID:${p.bcProductId}` : null;
}

async function seedPairings() {
  console.log("Fetching products from productColorways...");

  const rows = await db
    .selectDistinctOn([productColorways.bcProductId], {
      brand: productColorways.brand,
      category: productColorways.category,
      baseSku: productColorways.baseSku,
      productName: productColorways.productName,
      bcProductId: productColorways.bcProductId,
    })
    .from(productColorways)
    .where(isNotNull(productColorways.bcProductId));

  console.log(`Found ${rows.length} unique products\n`);

  const catOf  = (p: SeedProduct) => (p.category    || "").toLowerCase();
  const nameOf = (p: SeedProduct) => (p.productName || "").toLowerCase();

  const helmets = rows.filter(p => catOf(p).includes("helmet") || nameOf(p).includes("helmet"));
  const comms   = rows.filter(p =>
    (p.brand || "").toLowerCase().includes("cardo") ||
    (p.brand || "").toLowerCase().includes("sena")
  );

  console.log(`Helmets: ${helmets.length}, Comms: ${comms.length}`);

  const byBrand = new Map<string, SeedProduct[]>();
  for (const p of rows) {
    const b = (p.brand || "Unknown").trim();
    if (!byBrand.has(b)) byBrand.set(b, []);
    byBrand.get(b)!.push(p);
  }

  const pairings: { primarySku: string; pairedSku: string; pairingType: PairingType }[] = [];

  function addPair(a: SeedProduct, b: SeedProduct, type: PairingType) {
    const aSku = idSku(a);
    const bSku = idSku(b);
    if (aSku && bSku && aSku !== bSku) {
      pairings.push({ primarySku: aSku, pairedSku: bSku, pairingType: type });
    }
  }

  // ── 1. Jacket ↔ Pants per brand ──────────────────────────────────────────
  for (const [brand, bp] of byBrand) {
    const jackets = bp.filter(p =>
      (catOf(p).includes("jacket") || nameOf(p).includes("jacket")) &&
      !nameOf(p).includes("rain")
    );
    const pants = bp.filter(p =>
      catOf(p).includes("pant") || catOf(p).includes("bib") ||
      nameOf(p).includes(" pant") || nameOf(p).includes(" bib")
    );
    if (!jackets.length || !pants.length) continue;
    console.log(`${brand}: ${jackets.length} jackets × ${pants.length} pants`);
    for (const j of jackets.slice(0, 6))
      for (const p of pants.slice(0, 6)) {
        addPair(j, p, "matching_pants");
        addPair(p, j, "matching_jacket");
      }
  }

  // ── 2. Helmet → Comms ────────────────────────────────────────────────────
  const topComms = comms.slice(0, 4);
  for (const h of helmets.slice(0, 40))
    for (const c of topComms) addPair(h, c, "accessory");

  // ── 3. Jacket → Gloves (same brand) ─────────────────────────────────────
  for (const [, bp] of byBrand) {
    const jackets = bp.filter(p =>
      (catOf(p).includes("jacket") || nameOf(p).includes("jacket")) &&
      !nameOf(p).includes("rain")
    );
    const gloves = bp.filter(p => catOf(p).includes("glove") || nameOf(p).includes("glove"));
    if (!jackets.length || !gloves.length) continue;
    for (const j of jackets.slice(0, 4))
      for (const g of gloves.slice(0, 3)) addPair(j, g, "accessory");
  }

  // ── 4. Boots → Gloves (same brand) ──────────────────────────────────────
  for (const [, bp] of byBrand) {
    const boots  = bp.filter(p => catOf(p).includes("boot") || nameOf(p).includes(" boot"));
    const gloves = bp.filter(p => catOf(p).includes("glove") || nameOf(p).includes("glove"));
    if (!boots.length || !gloves.length) continue;
    for (const b of boots.slice(0, 3))
      for (const g of gloves.slice(0, 2)) addPair(b, g, "accessory");
  }

  // ── 5. MX Full Kit (helmet → jersey, pants, gloves, boots — same brand) ──
  const mxBrands = ["Fox Racing", "Fly Racing", "Troy Lee Designs", "Fasthouse",
                    "6D", "Leatt", "Alpinestars", "Thor", "Answer", "One Industries"];
  for (const brand of mxBrands) {
    const bp = byBrand.get(brand) || [];
    const mxHelmets = bp.filter(p => nameOf(p).includes("helmet"));
    const mxJerseys = bp.filter(p => nameOf(p).includes("jersey"));
    const mxPants   = bp.filter(p => nameOf(p).includes("pant") || catOf(p).includes("pant"));
    const mxGloves  = bp.filter(p => nameOf(p).includes("glove") || catOf(p).includes("glove"));
    const mxBoots   = bp.filter(p => nameOf(p).includes("boot")  || catOf(p).includes("boot"));

    console.log(`MX ${brand}: ${mxHelmets.length}h ${mxJerseys.length}j ${mxPants.length}p ${mxGloves.length}g ${mxBoots.length}b`);

    // Helmet → full kit items
    for (const h of mxHelmets.slice(0, 5)) {
      for (const item of [
        ...mxJerseys.slice(0, 3),
        ...mxPants.slice(0, 3),
        ...mxGloves.slice(0, 3),
        ...mxBoots.slice(0, 2),
      ]) addPair(h, item, "accessory");
    }

    // Jersey ↔ Pants
    for (const j of mxJerseys.slice(0, 4))
      for (const p of mxPants.slice(0, 4)) {
        addPair(j, p, "matching_pants");
        addPair(p, j, "matching_jacket");
      }
  }

  // ── 6. Snow Kit (jacket ↔ pants ↔ gloves ↔ boots — same brand) ──────────
  const snowByBrand = new Map<string, {
    jackets: SeedProduct[]; pants: SeedProduct[];
    gloves: SeedProduct[]; boots: SeedProduct[]; helmets: SeedProduct[];
  }>();

  for (const p of rows) {
    const b = (p.brand || "Unknown").trim();
    if (!snowByBrand.has(b)) snowByBrand.set(b, { jackets:[], pants:[], gloves:[], boots:[], helmets:[] });
    const e = snowByBrand.get(b)!;
    if (catOf(p) === "snow jackets")    e.jackets.push(p);
    else if (catOf(p) === "snow pants/bibs") e.pants.push(p);
    else if (catOf(p) === "snow gloves")    e.gloves.push(p);
    else if (catOf(p) === "snow boots")     e.boots.push(p);
    else if (catOf(p).includes("snowmobile") || (nameOf(p).includes("helmet") && catOf(p).includes("snow")))
      e.helmets.push(p);
  }

  for (const [brand, s] of snowByBrand) {
    if (!s.jackets.length && !s.pants.length) continue;
    console.log(`Snow ${brand}: ${s.jackets.length}j ${s.pants.length}p ${s.gloves.length}g ${s.boots.length}b ${s.helmets.length}h`);
    for (const j of s.jackets.slice(0, 5)) {
      for (const p of s.pants.slice(0, 5))  { addPair(j, p, "matching_pants"); addPair(p, j, "matching_jacket"); }
      for (const g of s.gloves.slice(0, 3)) addPair(j, g, "accessory");
      for (const b of s.boots.slice(0, 2))  addPair(j, b, "accessory");
    }
    for (const h of s.helmets.slice(0, 3)) {
      for (const item of [...s.jackets.slice(0,3), ...s.pants.slice(0,3), ...s.gloves.slice(0,3)])
        addPair(h, item, "accessory");
    }
  }

  // ── Deduplicate & insert ──────────────────────────────────────────────────
  const seen = new Set<string>();
  const deduped = pairings.filter(p => {
    const key = `${p.primarySku}|${p.pairedSku}|${p.pairingType}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  console.log(`\nTotal pairings to insert: ${deduped.length}`);

  if (process.argv.includes("--dry-run")) {
    console.log("\nDRY RUN — no changes made.");
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

seedPairings().catch(e => { console.error(e); process.exit(1); });
