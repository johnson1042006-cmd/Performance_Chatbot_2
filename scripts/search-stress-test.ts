import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { searchProducts, extractKeywords } from "../lib/search/productSearch";

interface TestCase {
  query: string;
  expect: string[];
}

interface CategoryResult {
  pass: number;
  fail: number;
  failures: { query: string; keywords: string[]; got: string[] }[];
}

const categories: Record<string, TestCase[]> = {

  // ═══════════════════════════════════════════════════════════════
  //  1. BRAND-SPECIFIC SEARCHES (~30)
  // ═══════════════════════════════════════════════════════════════
  "Brand-Specific": [
    { query: "alpinestars", expect: ["alpinestars"] },
    { query: "rev'it", expect: ["rev'it"] },
    { query: "revit", expect: ["rev'it"] },
    { query: "shoei", expect: ["shoei"] },
    { query: "arai", expect: ["arai"] },
    { query: "bell", expect: ["bell"] },
    { query: "hjc", expect: ["hjc"] },
    { query: "icon", expect: ["icon"] },
    { query: "klim", expect: ["klim"] },
    { query: "fox racing", expect: ["fox"] },
    { query: "fly racing", expect: ["fly"] },
    { query: "thor", expect: ["thor"] },
    { query: "leatt", expect: ["leatt"] },
    { query: "sena", expect: ["sena"] },
    { query: "cardo", expect: ["cardo"] },
    { query: "scorpion", expect: ["scorpion"] },
    { query: "nolan", expect: ["nolan"] },
    { query: "dainese", expect: ["dainese"] },
    { query: "sidi", expect: ["sidi"] },
    { query: "gaerne", expect: ["gaerne"] },
    { query: "dunlop", expect: ["dunlop"] },
    { query: "michelin", expect: ["michelin"] },
    { query: "ebc", expect: ["ebc"] },
    { query: "hiflo", expect: ["hiflo"] },
    { query: "k&n", expect: ["k&n"] },
    { query: "ngk", expect: ["ngk"] },
    { query: "fmf", expect: ["fmf"] },
    { query: "kriega", expect: ["kriega"] },
    { query: "kuryakyn", expect: ["kuryakyn"] },
    { query: "troy lee designs", expect: ["troy lee"] },
    { query: "tourmaster", expect: ["tourmaster"] },
    { query: "motion pro", expect: ["motion pro"] },
  ],

  // ═══════════════════════════════════════════════════════════════
  //  2. PRODUCT TYPE SEARCHES (~25)
  // ═══════════════════════════════════════════════════════════════
  "Product Types": [
    { query: "helmets", expect: ["helmet"] },
    { query: "jackets", expect: ["jacket"] },
    { query: "gloves", expect: ["glove"] },
    { query: "boots", expect: ["boot"] },
    { query: "tires", expect: ["tire"] },
    { query: "brake pads", expect: ["brake"] },
    { query: "chains", expect: ["chain"] },
    { query: "oil", expect: ["oil"] },
    { query: "air filter", expect: ["filter"] },
    { query: "oil filter", expect: ["oil", "filter"] },
    { query: "lights", expect: ["light"] },
    { query: "mirrors", expect: ["mirror"] },
    { query: "grips", expect: ["grip"] },
    { query: "goggles", expect: ["goggle"] },
    { query: "vests", expect: ["vest"] },
    { query: "pants", expect: ["pant"] },
    { query: "jerseys", expect: ["jersey"] },
    { query: "shields", expect: ["shield"] },
    { query: "knee guards", expect: ["knee", "guard"] },
    { query: "back protector", expect: ["protector", "back"] },
    { query: "batteries", expect: ["battery"] },
    { query: "ramps", expect: ["ramp"] },
    { query: "sprockets", expect: ["sprocket"] },
    { query: "spark plugs", expect: ["ngk", "spark", "plug"] },
    { query: "clutch cable", expect: ["clutch", "cable"] },
  ],

  // ═══════════════════════════════════════════════════════════════
  //  3. SPECIFIC PRODUCT NAMES (~30)
  // ═══════════════════════════════════════════════════════════════
  "Specific Products": [
    { query: "shoei x-15", expect: ["x-15"] },
    { query: "shoei rf-1400", expect: ["rf-1400"] },
    { query: "shoei neotec 3", expect: ["neotec 3", "neotec"] },
    { query: "bell mx-9 adventure", expect: ["mx-9", "adventure"] },
    { query: "bell srt modular", expect: ["srt", "modular"] },
    { query: "hjc rpha 11", expect: ["rpha"] },
    { query: "hjc i-91", expect: ["i-91"] },
    { query: "nolan n100-5", expect: ["n100"] },
    { query: "6d atr-3", expect: ["atr"] },
    { query: "icon airflite", expect: ["airflite"] },
    { query: "arai signet-x", expect: ["signet"] },
    { query: "scorpion exo-r1", expect: ["exo-r1", "exo"] },
    { query: "kyt nz-race", expect: ["nz-race", "kyt"] },
    { query: "alpinestars tech-air 5", expect: ["tech-air"] },
    { query: "alpinestars gp pro r4 gloves", expect: ["gp pro"] },
    { query: "sena 50s", expect: ["sena", "50s"] },
    { query: "cardo packtalk neo", expect: ["packtalk"] },
    { query: "garmin fenix", expect: ["garmin", "fenix"] },
    { query: "insta360 x4", expect: ["insta360"] },
    { query: "klim baja s4", expect: ["baja"] },
    { query: "klim traverse jacket", expect: ["traverse"] },
    { query: "klim latitude jacket", expect: ["latitude"] },
    { query: "fox v3 rs", expect: ["v3"] },
    { query: "fox racing youth v1 helmet", expect: ["youth", "v1"] },
    { query: "giant loop diablo", expect: ["diablo"] },
    { query: "pod k8 knee brace", expect: ["pod", "k8"] },
    { query: "sidi crossair boots", expect: ["crossair"] },
    { query: "gaerne sg22 boots", expect: ["sg22", "gaerne"] },
    { query: "dainese air frame", expect: ["air frame", "dainese"] },
    { query: "moose aluminum folding step ramp", expect: ["moose", "ramp"] },
  ],

  // ═══════════════════════════════════════════════════════════════
  //  4. CONVERSATIONAL / NATURAL LANGUAGE (~25)
  // ═══════════════════════════════════════════════════════════════
  "Conversational": [
    { query: "hey do you guys have anything for riding in the rain", expect: ["rain", "waterproof", "water", "gore"] },
    { query: "im looking for something to protect my knees", expect: ["knee", "guard", "protector", "pant"] },
    { query: "can you help me find a full face helmet", expect: ["helmet", "full"] },
    { query: "what helmet would you recommend for a sport bike", expect: ["helmet"] },
    { query: "i need something waterproof for touring", expect: ["waterproof", "touring", "gore"] },
    { query: "looking for brake pads for my yamaha r1", expect: ["brake", "pad"] },
    { query: "can i get a tinted visor for my shoei", expect: ["shield", "visor", "shoei"] },
    { query: "do you have any bluetooth communicators", expect: ["sena", "cardo", "communication", "bluetooth"] },
    { query: "i want to get my dad a gift hes into motorcycles", expect: [""] },
    { query: "i just got a new bike and need all the gear", expect: [""] },
    { query: "do you sell gopro mounts for helmets", expect: ["mount", "camera", "insta"] },
    { query: "whats your cheapest helmet", expect: ["helmet"] },
    { query: "my chain is worn out and needs replacing", expect: ["chain"] },
    { query: "im doing an oil change on my honda what do i need", expect: ["oil", "filter"] },
    { query: "looking for a jacket thats good in summer heat", expect: ["jacket", "mesh", "air", "vent"] },
    { query: "i ride a harley and need some new grips", expect: ["grip"] },
    { query: "what kind of tires do you have for dual sport", expect: ["tire", "dual"] },
    { query: "need a chest protector for motocross", expect: ["protector", "chest", "guard", "leatt"] },
    { query: "can you recommend goggles for off road riding", expect: ["goggle"] },
    { query: "looking for heated gear for winter", expect: ["heated"] },
    { query: "whats the best intercom system you carry", expect: ["sena", "cardo", "communication", "intercom"] },
    { query: "do you have any adventure helmets", expect: ["adventure", "helmet"] },
    { query: "i need new fork seals", expect: ["fork", "seal"] },
    { query: "looking for a tank bag", expect: ["tank", "bag"] },
    { query: "do you carry stacyc balance bikes", expect: ["stacyc"] },
  ],

  // ═══════════════════════════════════════════════════════════════
  //  5. TYPOS & MISSPELLINGS (~20)
  // ═══════════════════════════════════════════════════════════════
  "Typos & Misspellings": [
    { query: "alpinestar gloves", expect: ["alpinestars"] },
    { query: "shoey helmet", expect: ["shoei"] },
    { query: "dainise jacket", expect: ["dainese"] },
    { query: "bel mx-9", expect: ["bell", "mx-9"] },
    { query: "hjc modualr helmet", expect: ["hjc"] },
    { query: "klim traverss jacket", expect: ["klim"] },
    { query: "sidi rexs boots", expect: ["sidi", "rex"] },
    { query: "scorpien helmet", expect: ["scorpion"] },
    { query: "firstgeer jacket", expect: ["firstgear"] },
    { query: "tourmster gloves", expect: ["tourmaster"] },
    { query: "dunlap tires", expect: ["dunlop"] },
    { query: "michlin tires", expect: ["michelin"] },
    { query: "kuryakan pegs", expect: ["kuryakyn"] },
    { query: "leaat chest protector", expect: ["leatt"] },
    { query: "gaeren boots", expect: ["gaerne"] },
    { query: "kriega backpack", expect: ["kriega"] },
    { query: "alpinestars teck air", expect: ["tech-air", "alpinestars"] },
    { query: "shoei neoteck 3", expect: ["neotec", "shoei"] },
    { query: "fox raceing helmet", expect: ["fox"] },
    { query: "cardo packtalke", expect: ["cardo", "packtalk"] },
  ],

  // ═══════════════════════════════════════════════════════════════
  //  6. AUDIENCE QUALIFIERS (~15)
  // ═══════════════════════════════════════════════════════════════
  "Audience Qualifiers": [
    { query: "womens waterproof jacket", expect: ["women", "waterproof"] },
    { query: "womens klim jacket", expect: ["women", "klim"] },
    { query: "kids dirt bike boots", expect: ["youth", "kids", "boot", "fox"] },
    { query: "youth fox boots", expect: ["youth", "fox", "boot"] },
    { query: "ladies gloves small", expect: ["ladies", "women", "glove"] },
    { query: "youth motocross helmet", expect: ["youth", "helmet", "mx"] },
    { query: "mens leather jacket", expect: ["mens", "leather", "jacket"] },
    { query: "mens heated vest", expect: ["heated", "vest"] },
    { query: "kids gloves", expect: ["youth", "kids", "glove"] },
    { query: "ladies leather pants", expect: ["women", "ladies", "leather", "pant"] },
    { query: "youth goggles", expect: ["youth", "goggle"] },
    { query: "womens alpinestars", expect: ["women", "alpinestars"] },
    { query: "youth thor jersey", expect: ["youth", "thor", "jersey"] },
    { query: "kids mx racing helmet for my kid", expect: ["youth", "helmet", "mx", "fox", "fly"] },
    { query: "womens touring boots", expect: ["women", "boot", "touring"] },
  ],

  // ═══════════════════════════════════════════════════════════════
  //  7. FEATURE / USE-CASE QUERIES (~20)
  // ═══════════════════════════════════════════════════════════════
  "Feature / Use-Case": [
    { query: "bluetooth helmet", expect: ["bluetooth", "sena", "cardo"] },
    { query: "heated gloves", expect: ["heated", "glove"] },
    { query: "waterproof boots", expect: ["waterproof", "boot"] },
    { query: "carbon fiber helmet", expect: ["carbon", "helmet"] },
    { query: "gore-tex adventure jacket", expect: ["gore", "jacket"] },
    { query: "armored jacket", expect: ["armor", "jacket"] },
    { query: "hi viz vest", expect: ["vest"] },
    { query: "pinlock lens", expect: ["pinlock"] },
    { query: "led auxiliary lights", expect: ["led", "light"] },
    { query: "bluetooth intercom", expect: ["sena", "cardo", "bluetooth", "communication"] },
    { query: "heated gear", expect: ["heated"] },
    { query: "waterproof touring boots", expect: ["waterproof", "boot"] },
    { query: "d3o protector", expect: ["d3o", "d30", "protector"] },
    { query: "anti-fog shield", expect: ["shield", "pinlock", "fog"] },
    { query: "rain gear motorcycle", expect: ["rain"] },
    { query: "dual sport helmet", expect: ["helmet", "adventure", "dual"] },
    { query: "track day helmet", expect: ["helmet"] },
    { query: "adventure touring jacket", expect: ["adventure", "jacket"] },
    { query: "off road goggles", expect: ["goggle", "off-road"] },
    { query: "winter riding gear", expect: ["winter", "heated", "thermal", "insulated"] },
  ],

  // ═══════════════════════════════════════════════════════════════
  //  8. SLANG / ABBREVIATIONS (~15)
  // ═══════════════════════════════════════════════════════════════
  "Slang / Abbreviations": [
    { query: "lid for street riding", expect: ["helmet"] },
    { query: "brain bucket", expect: ["helmet"] },
    { query: "saddle bags", expect: ["saddlebag", "saddle", "bag"] },
    { query: "comms system for my helmet", expect: ["sena", "cardo", "communication"] },
    { query: "pipe for harley", expect: ["exhaust", "pipe", "vance"] },
    { query: "sprocket", expect: ["sprocket"] },
    { query: "pegs", expect: ["peg", "footpeg", "foot"] },
    { query: "windscreen", expect: ["windshield", "windscreen", "shield"] },
    { query: "saddlebags for touring", expect: ["saddlebag", "bag"] },
    { query: "skid plate", expect: ["skid"] },
    { query: "bark busters", expect: ["barkbuster", "bark", "handguard"] },
    { query: "rear sets", expect: ["rear", "set", "peg"] },
    { query: "race fuel", expect: ["fuel", "race", "vp"] },
    { query: "fork oil", expect: ["fork", "oil"] },
  ],

  // ═══════════════════════════════════════════════════════════════
  //  9. CROSS-BRAND + PRODUCT TYPE COMBOS (~20)
  // ═══════════════════════════════════════════════════════════════
  "Cross-Brand Combos": [
    { query: "shoei modular helmet", expect: ["shoei", "modular"] },
    { query: "alpinestars racing gloves", expect: ["alpinestars", "glove"] },
    { query: "klim adventure jacket", expect: ["klim", "jacket"] },
    { query: "dunlop sport tires", expect: ["dunlop", "tire"] },
    { query: "ebc brake pads", expect: ["ebc", "brake"] },
    { query: "hiflo oil filter", expect: ["hiflo", "filter"] },
    { query: "sena bluetooth system", expect: ["sena"] },
    { query: "fox racing mx goggles", expect: ["fox", "goggle"] },
    { query: "fly racing youth helmet", expect: ["fly", "helmet"] },
    { query: "revit gore-tex jacket", expect: ["rev'it", "gore"] },
    { query: "alpinestars tech air 5", expect: ["tech-air", "alpinestars"] },
    { query: "shoei rf-1400 yagyo", expect: ["rf-1400", "yagyo"] },
    { query: "bell mx-9 mips", expect: ["mx-9", "mips"] },
    { query: "klim dakar jacket", expect: ["klim", "dakar"] },
    { query: "sidi adventure boots", expect: ["sidi", "boot"] },
    { query: "dainese leather jacket", expect: ["dainese", "leather", "jacket"] },
    { query: "icon airflite helmet", expect: ["airflite"] },
    { query: "scorpion exo helmet", expect: ["scorpion", "exo"] },
    { query: "michelin pilot tires", expect: ["michelin", "pilot"] },
    { query: "k&n oil filter", expect: ["k&n", "filter"] },
  ],

  // ═══════════════════════════════════════════════════════════════
  //  10. EDGE CASES (~20)
  // ═══════════════════════════════════════════════════════════════
  "Edge Cases": [
    { query: "k&n filter", expect: ["k&n", "filter"] },
    { query: "100% goggles", expect: ["100%", "goggle"] },
    { query: "rf-1400", expect: ["rf-1400"] },
    { query: "mx-9", expect: ["mx-9"] },
    { query: "tech-air", expect: ["tech-air"] },
    { query: "x-15", expect: ["x-15"] },
    { query: "gt-air", expect: ["gt-air"] },
    { query: "2025 alpinestars techstar gloves", expect: ["alpinestars", "techstar"] },
    { query: "2024 klim womens pants", expect: ["klim", "women", "pant"] },
    { query: "i need a full face helmet thats comfortable for long distance touring with bluetooth and a pinlock visor", expect: ["helmet"] },
    { query: "oil", expect: ["oil"] },
    { query: "ngk", expect: ["ngk"] },
    { query: "helmet", expect: ["helmet"] },
    { query: "gloves", expect: ["glove"] },
    { query: "chain lube", expect: ["chain"] },
    { query: "o-ring chain 520", expect: ["chain", "520"] },
    { query: "tire pressure gauge", expect: ["tire", "pressure", "gauge"] },
    { query: "moose racing tools", expect: ["moose"] },
    { query: "stacyc electric bike", expect: ["stacyc"] },
    { query: "vp race fuel", expect: ["vp", "fuel", "race"] },
  ],

  // ═══════════════════════════════════════════════════════════════
  //  11. COLOR + PRODUCT TYPE COMBOS (~35)
  // ═══════════════════════════════════════════════════════════════
  "Color + Product Type": [
    { query: "white mx helmets", expect: ["helmet"] },
    { query: "white street helmet", expect: ["helmet"] },
    { query: "white adventure helmet", expect: ["helmet"] },
    { query: "black street helmet", expect: ["helmet"] },
    { query: "black mx helmet", expect: ["helmet"] },
    { query: "matte black helmet", expect: ["helmet"] },
    { query: "red helmet", expect: ["helmet"] },
    { query: "blue adventure helmet", expect: ["helmet"] },
    { query: "hi-viz helmet", expect: ["helmet"] },
    { query: "orange dirt bike helmet", expect: ["helmet"] },
    { query: "black leather jacket", expect: ["jacket"] },
    { query: "red racing jacket", expect: ["jacket"] },
    { query: "hi-viz adventure jacket", expect: ["jacket"] },
    { query: "white jacket", expect: ["jacket"] },
    { query: "black gloves", expect: ["glove"] },
    { query: "red gloves", expect: ["glove"] },
    { query: "white gloves", expect: ["glove"] },
    { query: "yellow gloves", expect: ["glove"] },
    { query: "black boots", expect: ["boot"] },
    { query: "white mx boots", expect: ["boot"] },
    { query: "brown leather boots", expect: ["boot"] },
    { query: "black riding boots", expect: ["boot"] },
    { query: "pink womens gloves", expect: ["glove"] },
    { query: "red fox jersey", expect: ["jersey", "fox"] },
    { query: "blue troy lee jersey", expect: ["jersey", "troy lee"] },
    { query: "black mx pants", expect: ["pant"] },
    { query: "white mx pants", expect: ["pant"] },
    { query: "blue goggles", expect: ["goggle"] },
    { query: "red goggles", expect: ["goggle"] },
    { query: "orange ktm gloves", expect: ["glove"] },
    { query: "grey modular helmet", expect: ["helmet", "modular"] },
    { query: "green kawasaki jersey", expect: ["jersey"] },
    { query: "carbon fiber black helmet", expect: ["helmet"] },
    { query: "pearl white shoei helmet", expect: ["shoei", "helmet"] },
    { query: "stealth black alpinestars jacket", expect: ["alpinestars", "jacket"] },
  ],
};

async function runTests() {
  const summary: Record<string, CategoryResult> = {};
  let totalPass = 0;
  let totalFail = 0;

  for (const [category, tests] of Object.entries(categories)) {
    const result: CategoryResult = { pass: 0, fail: 0, failures: [] };

    console.log(`\n${"=".repeat(60)}`);
    console.log(`  ${category} (${tests.length} queries)`);
    console.log("=".repeat(60));

    for (const t of tests) {
      const keywords = extractKeywords(t.query);
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
      const passed =
        hasEmptyExpect
          ? products.length > 0
          : t.expect.some((e) =>
              namesLower.some((n) => n.includes(e.toLowerCase()))
            );

      if (passed) {
        result.pass++;
        totalPass++;
        console.log(
          `  [PASS] "${t.query}" -> ${products.length}: ${names.slice(0, 2).join(", ")}`
        );
      } else {
        result.fail++;
        totalFail++;
        result.failures.push({ query: t.query, keywords, got: names.slice(0, 5) });
        console.log(
          `  [FAIL] "${t.query}" -> kw=[${keywords.join(",")}] -> ${products.length}: ${names.slice(0, 3).join(", ") || "NONE"}`
        );
      }
    }

    summary[category] = result;
  }

  const totalQueries = totalPass + totalFail;
  console.log(`\n${"=".repeat(60)}`);
  console.log("  SUMMARY");
  console.log("=".repeat(60));
  for (const [cat, res] of Object.entries(summary)) {
    const pct = Math.round((res.pass / (res.pass + res.fail)) * 100);
    const status = res.fail === 0 ? "ALL PASS" : `${res.fail} FAIL`;
    console.log(`  ${cat}: ${res.pass}/${res.pass + res.fail} ${pct}% (${status})`);
  }
  console.log(`\n  TOTAL: ${totalPass}/${totalQueries} (${Math.round((totalPass / totalQueries) * 100)}%)`);

  if (totalFail > 0) {
    console.log(`\n${"=".repeat(60)}`);
    console.log("  FAILURE DETAILS");
    console.log("=".repeat(60));
    for (const [cat, res] of Object.entries(summary)) {
      for (const f of res.failures) {
        console.log(
          `  [${cat}] "${f.query}" -> kw=[${f.keywords.join(",")}] -> got: ${f.got.join(" | ") || "NOTHING"}`
        );
      }
    }
  }
}

runTests().catch((e) => {
  console.error("Test runner error:", e);
  process.exit(1);
});
