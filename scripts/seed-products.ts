import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { products, productPairings } from "../lib/db/schema";

async function seed() {
  const sql = neon(process.env.DATABASE_URL!);
  const db = drizzle(sql);

  const sampleProducts = [
    {
      sku: "HEL-SHOEI-RF1400-BK",
      name: "Shoei RF-1400 Full Face Helmet",
      description:
        "The Shoei RF-1400 features an AIM+ shell, Pinlock EVO lens, emergency quick release system, and advanced ventilation with 4 intake and 6 exhaust vents. DOT and SNELL M2020D certified. Lightweight at 3.4 lbs.",
      price: "549.99",
      category: "Helmets",
      colorTags: ["black", "onyx", "stealth"],
      isDiscontinued: false,
      stockQty: 15,
    },
    {
      sku: "HEL-SHOEI-RF1400-WH",
      name: "Shoei RF-1400 Full Face Helmet - White",
      description:
        "The Shoei RF-1400 in premium white finish. Features AIM+ shell construction, Pinlock EVO lens included, emergency quick release system, 4 intake and 6 exhaust vents. DOT and SNELL M2020D certified.",
      price: "549.99",
      category: "Helmets",
      colorTags: ["white", "pearl", "ivory"],
      isDiscontinued: false,
      stockQty: 8,
    },
    {
      sku: "HEL-AGV-K6S-BL",
      name: "AGV K6 S Full Face Helmet",
      description:
        "Ultra-lightweight carbon-aramid fiber shell. Features 5 front vents, 2 rear extractors, removable and washable Dri-Lex interior, pinlock-ready visor. ECE 22.06 certified. Weighs only 2.9 lbs.",
      price: "449.99",
      category: "Helmets",
      colorTags: ["blue", "navy", "cobalt"],
      isDiscontinued: false,
      stockQty: 12,
    },
    {
      sku: "HEL-BELL-QUAL3-RD",
      name: "Bell Qualifier DLX MIPS Helmet",
      description:
        "Polycarbonate/ABS shell with MIPS brain protection. Integrated communication ready speaker pockets, padded chin strap, Velocity Flow ventilation, NutraFog II anti-fog face shield. DOT certified.",
      price: "199.99",
      category: "Helmets",
      colorTags: ["red", "crimson", "scarlet"],
      isDiscontinued: false,
      stockQty: 20,
    },
    {
      sku: "JKT-REVIT-ECLIPSE-BK",
      name: "REV'IT! Eclipse Textile Jacket",
      description:
        "Lightweight summer mesh jacket with PWR|mesh main shell for maximum ventilation. SEESMART CE-level 1 shoulder and elbow protectors included. Prepared for SEESOFT CE-level 2 back protector. Features laminated reflection, connection zipper for pants.",
      price: "229.99",
      category: "Jackets",
      colorTags: ["black", "jet", "onyx"],
      isDiscontinued: false,
      stockQty: 18,
    },
    {
      sku: "JKT-REVIT-ECLIPSE-NV",
      name: "REV'IT! Eclipse Textile Jacket - Navy",
      description:
        "Lightweight summer mesh jacket in dark navy blue with PWR|mesh main shell. SEESMART CE-level 1 protectors at shoulders and elbows. Connection zipper compatible with REV'IT pants. Reflective accents.",
      price: "229.99",
      category: "Jackets",
      colorTags: ["navy", "blue", "midnight", "dark blue"],
      isDiscontinued: false,
      stockQty: 10,
    },
    {
      sku: "PNT-REVIT-TORNADO3-BK",
      name: "REV'IT! Tornado 3 Textile Pants",
      description:
        "Ventilated touring pants with mesh panels. SEESMART CE-level 1 knee protectors, adjustable fit via Velcro straps at waist. Connection zipper for REV'IT! jackets. Water-resistant liner included.",
      price: "249.99",
      category: "Pants",
      colorTags: ["black", "jet"],
      isDiscontinued: false,
      stockQty: 14,
    },
    {
      sku: "GLV-ALPINE-SP8V3-BK",
      name: "Alpinestars SP-8 v3 Leather Gloves",
      description:
        "Full-grain leather construction with reinforced palm. Hard knuckle protector with TPR sliders, touchscreen-compatible fingertips, pre-curved design. CE certified.",
      price: "89.99",
      category: "Gloves",
      colorTags: ["black", "charcoal"],
      isDiscontinued: false,
      stockQty: 25,
    },
    {
      sku: "BTS-SIDI-VORTICE2-BK",
      name: "Sidi Vortice 2 Sport Boots",
      description:
        "Premium sport riding boots with Technomicro upper, replaceable toe slider, shin plate protection, ankle pivot system, and Vibram sole. CE certified.",
      price: "399.99",
      category: "Boots",
      colorTags: ["black", "stealth"],
      isDiscontinued: false,
      stockQty: 7,
    },
    {
      sku: "RMP-MOOSE-FOLD-AL",
      name: "Moose Aluminum Folding Step Ramp",
      description:
        "Heavy-duty aluminum folding ramp. 750 lb capacity, non-slip surface, folds in half for easy storage. Measures 7.5 ft extended. Universal fit for most trucks and trailers. Features safety straps and rubber feet.",
      price: "189.99",
      category: "Ramps",
      colorTags: ["silver", "aluminum"],
      isDiscontinued: false,
      stockQty: 5,
    },
    {
      sku: "4530-0097",
      name: "Moose Aluminum Folding Step Ramp (legacy SKU)",
      description:
        "Same as RMP-MOOSE-FOLD-AL. Heavy-duty aluminum folding ramp, 750 lb capacity, non-slip surface with safety straps.",
      price: "189.99",
      category: "Ramps",
      colorTags: ["silver"],
      isDiscontinued: false,
      stockQty: 5,
    },
    {
      sku: "HEL-HJC-I10-OLD",
      name: "HJC i10 Helmet (2021 Model)",
      description: "Previous generation HJC i10 helmet. Replaced by the i10 SF in 2023.",
      price: "179.99",
      category: "Helmets",
      colorTags: ["black"],
      isDiscontinued: true,
      stockQty: 0,
    },
    {
      sku: "EBIKE-SURRON-LBX",
      name: "Sur-Ron Light Bee X Electric Dirt Bike",
      description:
        "High-performance electric dirt bike with 6kW peak motor, 60V 32Ah lithium battery, 47 mile range, 47 mph top speed. Hydraulic disc brakes, adjustable suspension, street-legal kit available.",
      price: "4599.99",
      category: "E-Bikes",
      colorTags: ["black", "green"],
      isDiscontinued: false,
      stockQty: 3,
    },
    {
      sku: "EBIKE-BATT-60V32",
      name: "Sur-Ron 60V 32Ah Replacement Battery",
      description: "OEM replacement battery for Sur-Ron Light Bee X. Lithium-ion, 60V 32Ah capacity. 1500+ charge cycles.",
      price: "1299.99",
      category: "E-Bike Parts",
      colorTags: [],
      isDiscontinued: false,
      stockQty: 6,
    },
  ];

  for (const product of sampleProducts) {
    await db
      .insert(products)
      .values(product)
      .onConflictDoUpdate({
        target: products.sku,
        set: {
          name: product.name,
          description: product.description,
          price: product.price,
          category: product.category,
          colorTags: product.colorTags,
          isDiscontinued: product.isDiscontinued,
          stockQty: product.stockQty,
          updatedAt: new Date(),
        },
      });
  }

  await db.insert(productPairings).values([
    {
      primarySku: "JKT-REVIT-ECLIPSE-BK",
      pairedSku: "PNT-REVIT-TORNADO3-BK",
      pairingType: "matching_pants",
    },
    {
      primarySku: "JKT-REVIT-ECLIPSE-NV",
      pairedSku: "PNT-REVIT-TORNADO3-BK",
      pairingType: "matching_pants",
    },
    {
      primarySku: "HEL-SHOEI-RF1400-BK",
      pairedSku: "GLV-ALPINE-SP8V3-BK",
      pairingType: "accessory",
    },
  ]);

  console.log(`Seeded ${sampleProducts.length} products and 3 pairings`);
}

seed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
