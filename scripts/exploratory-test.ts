import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { searchProducts, extractKeywords } from "../lib/search/productSearch";

interface TestCase {
  query: string;
  expect: string[];
}

const queries: TestCase[] = [
  // Maintenance / service tasks
  { query: "oil change kit", expect: ["oil", "filter"] },
  { query: "air filter for ktm", expect: ["air", "filter", "ktm"] },
  { query: "brake fluid", expect: ["brake", "fluid"] },
  { query: "coolant", expect: ["coolant"] },
  { query: "chain and sprocket kit", expect: ["chain", "sprocket"] },
  { query: "valve shim kit", expect: ["valve", "shim"] },
  { query: "spark plug wrench", expect: ["spark", "plug", "wrench", "tool"] },
  { query: "tire repair kit", expect: ["tire", "repair", "kit", "plug"] },
  { query: "tube 80/100-21", expect: ["tube", "80"] },
  { query: "rim lock", expect: ["rim", "lock"] },

  // Specific vehicle references
  { query: "parts for yamaha yz250f", expect: [""] },
  { query: "honda crf450 accessories", expect: ["crf"] },
  { query: "harley davidson exhaust", expect: ["harley", "exhaust"] },
  { query: "goldwing accessories", expect: ["goldwing", "gold wing"] },
  { query: "ktm adventure gear", expect: ["ktm", "adventure"] },
  { query: "bmw gs accessories", expect: [""] },

  // Riding discipline specific
  { query: "enduro gear", expect: ["enduro"] },
  { query: "supermoto tires", expect: ["supermoto", "tire"] },
  { query: "trials boots", expect: ["trial", "boot"] },
  { query: "street fighter helmet", expect: ["street", "helmet", ""] },
  { query: "cruiser windshield", expect: ["windshield", "windscreen"] },
  { query: "sportbike frame sliders", expect: ["slider", "frame"] },
  { query: "dual sport mirrors", expect: ["mirror"] },
  { query: "adventure panniers", expect: ["pannier", "adventure", "case", "bag"] },

  // Protection / safety
  { query: "neck brace", expect: ["neck", "brace", "leatt"] },
  { query: "impact shorts", expect: ["impact", "short", "protector"] },
  { query: "roost guard", expect: ["roost", "guard", "protector", "chest"] },
  { query: "elbow pads", expect: ["elbow", "pad", "guard", "protector"] },
  { query: "kidney belt", expect: ["kidney", "belt"] },
  { query: "ear plugs", expect: ["ear", "plug"] },

  // Electrical / electronics
  { query: "battery charger", expect: ["battery", "charger", "tender"] },
  { query: "usb charger for motorcycle", expect: ["usb", "charger"] },
  { query: "gps mount", expect: ["gps", "mount"] },
  { query: "phone mount for handlebars", expect: ["phone", "mount"] },

  // Cleaning / chemicals
  { query: "chain cleaner", expect: ["chain", "clean"] },
  { query: "bike wash", expect: ["wash", "clean"] },
  { query: "chrome polish", expect: ["chrome", "polish"] },
  { query: "leather conditioner", expect: ["leather", "condition"] },
  { query: "contact cleaner", expect: ["contact", "clean"] },

  // Comfort / ergonomics
  { query: "gel seat pad", expect: ["seat", "gel", "pad"] },
  { query: "throttle lock cruise control", expect: ["throttle", "cruise", "lock"] },
  { query: "handlebar risers", expect: ["handlebar", "riser"] },
  { query: "bar end mirrors", expect: ["bar", "end", "mirror"] },
  { query: "heated grips", expect: ["heated", "grip"] },

  // Camping / touring accessories
  { query: "dry bag waterproof", expect: ["dry", "bag", "waterproof"] },
  { query: "roll bag", expect: ["roll", "bag"] },
  { query: "top case", expect: ["top", "case", "trunk"] },
  { query: "tail bag", expect: ["tail", "bag"] },

  // Dirt bike specific parts
  { query: "dirt bike plastics", expect: ["fender", "number plate", "side panel", "acerbis"] },
  { query: "graphics kit", expect: ["graphic", "decal"] },
  { query: "skid plate ktm", expect: ["skid", "plate"] },
  { query: "handguards", expect: ["handguard", "barkbuster"] },
  { query: "radiator guards", expect: ["radiator", "guard"] },
  { query: "pipe guard", expect: ["pipe", "guard", "exhaust"] },
  { query: "spoke wraps", expect: ["spoke", "wrap", "skin"] },
  { query: "hour meter", expect: ["hour", "meter"] },

  // Apparel accessories
  { query: "balaclava", expect: ["balaclava"] },
  { query: "neck gaiter", expect: ["neck", "gaiter", "tube"] },
  { query: "base layer", expect: ["base", "layer"] },
  { query: "riding socks", expect: ["sock"] },
  { query: "helmet liner replacement", expect: ["liner", "helmet", "cheek"] },
  { query: "helmet visor", expect: ["visor", "shield"] },
  { query: "rain pants", expect: ["rain", "pant"] },

  // Tools
  { query: "torque wrench", expect: ["torque", "wrench"] },
  { query: "tire irons", expect: ["tire", "iron", "spoon"] },
  { query: "stand motorcycle", expect: ["stand"] },
  { query: "paddock stand", expect: ["stand", "paddock"] },
  { query: "bike lift", expect: ["lift", "jack", "stand"] },

  // More slang / casual
  { query: "stickers for my helmet", expect: ["sticker", "decal"] },
  { query: "lock for my bike", expect: ["lock"] },
  { query: "cover for my motorcycle", expect: ["cover"] },
  { query: "cargo net", expect: ["net", "cargo"] },
  { query: "tie downs", expect: ["tie", "down", "strap"] },

  // Price-oriented
  { query: "cheap helmets", expect: ["helmet"] },
  { query: "budget gloves", expect: ["glove"] },
  { query: "premium leather jacket", expect: ["leather", "jacket"] },

  // Unusual/tricky
  { query: "cheek pads for shoei", expect: ["cheek", "pad", "shoei"] },
  { query: "replacement lens oakley", expect: ["lens", "oakley"] },
  { query: "tear offs", expect: ["tear", "off"] },
  { query: "breath guard helmet", expect: ["breath", "guard"] },
  { query: "chin curtain", expect: ["chin", "curtain"] },
  { query: "visor ratchet kit", expect: ["visor", "ratchet", "shield", "pivot"] },
  { query: "d-ring helmet strap", expect: [""] },
  { query: "anti theft disc lock", expect: ["lock", "disc"] },
  { query: "wheel bearing", expect: ["wheel", "bearing"] },
  { query: "steering stem bearing", expect: ["steering", "stem", "bearing"] },
  { query: "linkage bearing kit", expect: ["linkage", "bearing"] },
  { query: "swingarm pivot bolt", expect: ["swingarm", "pivot"] },
];

async function run() {
  let pass = 0;
  let fail = 0;
  const failures: { query: string; kw: string[]; got: string[] }[] = [];

  for (const t of queries) {
    const kw = extractKeywords(t.query);
    let products: { name: string }[];
    try {
      const result = await searchProducts(t.query);
      products = result.products;
    } catch {
      products = [];
    }

    const names = products.map((p) => p.name);
    const namesLower = names.map((n) => n.toLowerCase());

    const hasEmptyExpect = t.expect.length === 1 && t.expect[0] === "";
    const passed = hasEmptyExpect
      ? products.length > 0
      : t.expect.some((e) => namesLower.some((n) => n.includes(e.toLowerCase())));

    if (passed) {
      pass++;
      console.log(`  [PASS] "${t.query}" -> ${products.length}: ${names.slice(0, 2).join(", ")}`);
    } else {
      fail++;
      failures.push({ query: t.query, kw, got: names.slice(0, 5) });
      console.log(`  [FAIL] "${t.query}" -> kw=[${kw.join(",")}] -> ${products.length}: ${names.slice(0, 3).join(", ") || "NONE"}`);
    }
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log(`  TOTAL: ${pass}/${pass + fail} (${Math.round((pass / (pass + fail)) * 100)}%)`);

  if (fail > 0) {
    console.log(`\n  FAILURES:`);
    for (const f of failures) {
      console.log(`    "${f.query}" -> kw=[${f.kw.join(",")}] -> ${f.got.join(" | ") || "NOTHING"}`);
    }
  }
}

run().catch((e) => { console.error(e); process.exit(1); });
