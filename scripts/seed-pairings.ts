import { config } from "dotenv";
config({ path: ".env.local" });

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { productPairings } from "../lib/db/schema";

type PairingType = "matching_pants" | "matching_jacket" | "accessory" | "frequently_bought";

interface Pairing {
  primarySku: string;
  pairedSku: string;
  pairingType: PairingType;
}

// ─── Jacket + Matching Pants (bidirectional) ───────────────────────────────
const jacketPantsPairs: [string, string][] = [
  // Klim Carlsbad
  ["6029-002-120-XXX", "6030-002-030-xxx"],
  // Klim Traverse
  ["4050-002-120-6XX", "4051-002-030-XXX"],
  // Klim Baja S4
  ["4061-000-120-6XX", "4062-000-030-6XX"],
  // Klim Enduro S4
  ["4064-000-120-XXX", "4065-000-XXX-XXX"],
  // Klim Dakar
  ["3122-002-XXX-XXX", "3142-004-XXX-XXX"],
  // Alpinestars Andes Air Drystar
  ["40780075XX", "40790005XX"],
  // Alpinestars Andes v3 Drystar (Women's jacket + pants)
  ["2822135x", "2823032x"],
  // Noru Taifu (jacket + waterproof pants)
  ["73012105X", "730221050x"],
  // Noru Kuki Mesh Jacket + Kiryu Mesh Pants
  ["73512107x", "73532105xx"],
  // Noru Kaze Mesh Jacket + Kiryu Mesh Pants
  ["735221050X", "73532105xx"],
  // Noru Women's Arashi Jacket + Taifu WP Pants
  ["7300XXXXXX", "730221050x"],
  // Noru Women's Josei Mesh Jacket + Kiryu Mesh Pants
  ["730801XXXX", "73532105xx"],
  // REV'IT! Quantum 2 Air Jacket + Alpinestars Andes v3 Pants (cross-brand ADV)
  ["FJT295-1600-X", "2855052x"],
  // Klim Carlsbad 2026
  ["6029-003-", "6030-003-030-"],
  // Klim Baja S4 2025
  ["4061-001-1XX", "4062-001-0XX"],
  // Klim Override Jacket + Enduro S4 Pants
  ["3391-000-XXX-000", "4065-000-XXX-XXX"],
];

// ─── MX Jersey + Pants Combos ──────────────────────────────────────────────
const jerseyPantsPairs: [string, string][] = [
  // Troy Lee Designs GP Mono
  ["30749000", "2074900"],
  // Troy Lee Designs GP Air Mono (jersey + air pants)
  ["304597XXX", "2044900"],
  // Seven Vox Staple
  ["2250057-001-XX", "2330057-001-XX"],
  // Seven Vox Fracture
  ["2250090-XXX-XX", "2330090-XXX-XX"],
  // Seven Vox Aperture 2025
  ["2250081-451-X", "2330081-451-X"],
  // Seven Zero Hijack
  ["2250087-XXX-XX", "2330087-XXX-XX"],
  // Seven Zero Alter
  ["2250088-XXX-XX", "2330088-XXX-XX"],
  // Alpinestars Fluid Haul
  ["3760525-3031-", "3720525-3031-"],
  // Alpinestars Fluid Wurx
  ["3761025-9230-", "3721025-9230-"],
  // Klim Mojave Jersey + Dakar OTB Pants
  ["3109-007-", "3142-004-XXX-XXX"],
  // Klim Dakar Dimension Jersey + Dakar OTB Pants
  ["3315-009-", "3142-004-XXX-XXX"],
  // Fox Racing 180 XPOZR Jersey + Fox 180 gloves
  ["30260-052-", "33518-116-XX"],
  // Fox Racing 180 BNKR Jersey + 180 Blackout Gloves
  ["31280-247", "38611-D17"],
];

// ─── Helmet + Accessories ──────────────────────────────────────────────────
const helmetAccessories: Pairing[] = [
  // Shoei RF-1400 + matching shield
  { primarySku: "01010105XXX", pairedSku: "02019405XX", pairingType: "accessory" },
  // Shoei RF-1400 + Pinlock insert
  { primarySku: "01010105XXX", pairedSku: "020198000", pairingType: "accessory" },
  // Shoei RF-1400 + Cardo PackTalk Edge
  { primarySku: "01010105XXX", pairedSku: "71-5044", pairingType: "accessory" },
  // Shoei RF-1400 Dedicated + shield
  { primarySku: "010116050X", pairedSku: "02019405XX", pairingType: "accessory" },
  // Shoei GT-Air 3 + Cardo PackTalk Edge
  { primarySku: "01210109XX", pairedSku: "71-5044", pairingType: "accessory" },
  // Shoei GT-Air 3 + Cardo Shoei Adapter
  { primarySku: "01210109XX", pairedSku: "71-5064", pairingType: "accessory" },
  // Shoei GT-Air 3 + CNS-2 Pinlock Shield
  { primarySku: "01210109XX", pairedSku: "022494XXXX", pairingType: "accessory" },
  // Shoei Neotec 3 + Cardo PackTalk Edge
  { primarySku: "01200105XX", pairedSku: "71-5044", pairingType: "accessory" },
  // Shoei Neotec 3 + Cardo Shoei Adapter Gen 3
  { primarySku: "01200105XX", pairedSku: "71-5078", pairingType: "accessory" },
  // Shoei GT-Air II + Sena 10U for GT-Air
  { primarySku: "011901090XX", pairedSku: "843-02012", pairingType: "accessory" },
  // AGV K3 + Cardo PackTalk NEO
  { primarySku: "0101155", pairedSku: "71-5052", pairingType: "accessory" },
  // AGV Pista GP RR + Pista GP-RR Face Shield
  { primarySku: "0101155xx", pairedSku: "01300685XX", pairingType: "accessory" },
  // AGV K6 S + K6 Pinlock Face Shield
  { primarySku: "01011559", pairedSku: "0130092", pairingType: "accessory" },
  // AGV K1S + Cardo PackTalk NEO
  { primarySku: "01011563", pairedSku: "71-5052", pairingType: "accessory" },
  // Arai Signet-X + VAS-V Face Shields
  { primarySku: "0101159", pairedSku: "013010", pairingType: "accessory" },
  // Arai Signet-X + VAS-V Pinlock Insert
  { primarySku: "0101159", pairedSku: "01301191", pairingType: "accessory" },
  // Arai Quantum-X + VAS-V Face Shields
  { primarySku: "0101157", pairedSku: "013010", pairingType: "accessory" },
  // Arai VX Pro 4 + XD4 Anti-Fog Shield
  { primarySku: "0110817xx", pairedSku: "0130110", pairingType: "accessory" },
  // Arai Corsair X + VAS-V Pro Shade Shield
  { primarySku: "01011591", pairedSku: "814087xx", pairingType: "accessory" },
  // Shoei Hornet X2 + Pinlock Lens
  { primarySku: "012401xxxx", pairedSku: "1123sssss", pairingType: "accessory" },
  // Shoei RF-SR + CWR-1 Shield
  { primarySku: "010701xxxxx", pairedSku: "0209940", pairingType: "accessory" },
];

// ─── Frequently Bought Together ────────────────────────────────────────────
const frequentlyBought: Pairing[] = [
  // Klim Baja S4 Jacket + Baja S4 Gloves (same line)
  { primarySku: "4061-000-120-6XX", pairedSku: "4063-000-XXX-XXX", pairingType: "frequently_bought" },
  // Klim Carlsbad Jacket + Inversion Pro Gloves (ADV set)
  { primarySku: "6029-002-120-XXX", pairedSku: "5035-002-", pairingType: "frequently_bought" },
  // Klim Traverse Jacket + Inversion Pro Gloves
  { primarySku: "4050-002-120-6XX", pairedSku: "5035-002-", pairingType: "frequently_bought" },
  // Shoei RF-1400 + Alpinestars SMX-2 Air Carbon Gloves (street rider set)
  { primarySku: "01010105XXX", pairedSku: "3301XXXXX", pairingType: "frequently_bought" },
  // Shoei GT-Air 3 + Alpinestars Mustang V2 Gloves (touring set)
  { primarySku: "01210109XX", pairedSku: "3301319X", pairingType: "frequently_bought" },
  // Shoei Hornet X2 + Dunlop Trailmax Mission Tires (ADV rider set)
  { primarySku: "012401xxxx", pairedSku: "873-035XX", pairingType: "frequently_bought" },
  // Noru Taifu Jacket + Furo Gloves (same brand)
  { primarySku: "73012105X", pairedSku: "74012105XX", pairingType: "frequently_bought" },
  // Noru Taifu Jacket + Tori Boots (same brand)
  { primarySku: "73012105X", pairedSku: "75022105x", pairingType: "frequently_bought" },
  // Noru Kuki Mesh Jacket + Kiryu Gloves
  { primarySku: "73512107x", pairedSku: "74032105xxx", pairingType: "frequently_bought" },
  // Noru Kaze Mesh Jacket + Doro Gloves
  { primarySku: "735221050X", pairedSku: "74042105x", pairingType: "frequently_bought" },
  // Noru Women's Arashi Jacket + Women's Furo Gloves
  { primarySku: "7300XXXXXX", pairedSku: "740121XXXX", pairingType: "frequently_bought" },
  // Noru Women's Arashi Jacket + Women's Tori Boots
  { primarySku: "7300XXXXXX", pairedSku: "750221XXXX", pairingType: "frequently_bought" },
  // Noru Women's Josei Mesh Jacket + Women's Kiryu Gloves
  { primarySku: "730801XXXX", pairedSku: "740321XXXX", pairingType: "frequently_bought" },
  // Noru Women's Josei Mesh Jacket + Women's Shoto Boots
  { primarySku: "730801XXXX", pairedSku: "750521XXXX", pairingType: "frequently_bought" },
  // Alpinestars Tech 7 Enduro Boots + Oakley Front Line Goggles (MX set)
  { primarySku: "482-2810", pairedSku: "OO7087-", pairingType: "frequently_bought" },
  // Alpinestars Tech 10 Boots + 100% Armega Goggles
  { primarySku: "482-0110X", pairedSku: "610-5", pairingType: "frequently_bought" },
  // Fly Racing Maverik Boots + Fox Racing Airspace Goggles (MX set)
  { primarySku: "364-671X", pairedSku: "29672-", pairingType: "frequently_bought" },
  // Highway 21 Gasser Leather Jacket + Icon 1000 Axys Gloves (cruiser set)
  { primarySku: "489-1011XX", pairedSku: "330128XXXX", pairingType: "frequently_bought" },
  // Cardo PackTalk Edge + 45mm JBL Speaker Set (upgrade speakers)
  { primarySku: "71-5044", pairedSku: "71-5031", pairingType: "frequently_bought" },
  // Cardo PackTalk NEO + 45mm JBL Speaker Set
  { primarySku: "71-5052", pairedSku: "71-5031", pairingType: "frequently_bought" },
  // AGV K6 S Helmet + Alpinestars SMX-2 Air Carbon Gloves
  { primarySku: "01011559", pairedSku: "3301XXXXX", pairingType: "frequently_bought" },
  // Alpinestars Andes Air Drystar Jacket + Andes V2 Boots
  { primarySku: "40780075XX", pairedSku: "34010627XX", pairingType: "frequently_bought" },
  // Troy Lee Designs GP Mono Jersey + Seven Zero Clash Gloves
  { primarySku: "30749000", pairedSku: "2210028-XXX-XX", pairingType: "frequently_bought" },
  // Klim Dakar Jacket + Klim Dakar In The Boot Pants (alt pants option)
  { primarySku: "3122-002-XXX-XXX", pairedSku: "3182-005-", pairingType: "frequently_bought" },
];

function buildAllPairings(): Pairing[] {
  const all: Pairing[] = [];

  for (const [jacketSku, pantsSku] of jacketPantsPairs) {
    all.push({ primarySku: jacketSku, pairedSku: pantsSku, pairingType: "matching_pants" });
    all.push({ primarySku: pantsSku, pairedSku: jacketSku, pairingType: "matching_jacket" });
  }

  for (const [jerseySku, pantsSku] of jerseyPantsPairs) {
    all.push({ primarySku: jerseySku, pairedSku: pantsSku, pairingType: "matching_pants" });
    all.push({ primarySku: pantsSku, pairedSku: jerseySku, pairingType: "matching_jacket" });
  }

  all.push(...helmetAccessories);
  all.push(...frequentlyBought);

  return all;
}

async function seedPairings() {
  const sql = neon(process.env.DATABASE_URL!);
  const db = drizzle(sql);

  const replace = process.argv.includes("--replace");

  const pairings = buildAllPairings();

  if (replace) {
    await db.delete(productPairings);
    console.log("Cleared existing pairings");
  }

  let inserted = 0;
  const BATCH_SIZE = 50;

  for (let i = 0; i < pairings.length; i += BATCH_SIZE) {
    const batch = pairings.slice(i, i + BATCH_SIZE);
    await db.insert(productPairings).values(batch);
    inserted += batch.length;
  }

  console.log(`Inserted ${inserted} product pairings:`);
  console.log(`  Jacket/Pants combos: ${jacketPantsPairs.length * 2} (bidirectional)`);
  console.log(`  Jersey/Pants combos: ${jerseyPantsPairs.length * 2} (bidirectional)`);
  console.log(`  Helmet accessories:  ${helmetAccessories.length}`);
  console.log(`  Frequently bought:   ${frequentlyBought.length}`);
  console.log(`  Total rows:          ${pairings.length}`);
}

seedPairings()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  });
