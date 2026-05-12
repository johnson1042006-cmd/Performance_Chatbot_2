import Fuse from "fuse.js";
import { searchLocalCatalog, type LocalMatch } from "./localCatalogSearch";
import {
  searchProductsBC,
  getProductBySKU,
  getProductByNameLike,
  getProductsByCategory,
  findCategoryByName,
  type BCProduct,
} from "@/lib/bigcommerce/client";
import {
  extractColorFromQuery,
  expandColorQuery,
  colorSynonymMap,
} from "./colorSynonyms";
import {
  classifyProductSubcategory,
  extractSubcategoryRequest,
  isSupportedProductType,
  OFF_STREET_SUBCATEGORIES,
  type SubcategoryValue,
  type SubcategoryRequest,
  type SupportedProductType,
} from "./subcategory";

const SKU_PATTERN = /\b[A-Z0-9]{2,}[-_]?[A-Z0-9]{2,}[-_]?[A-Z0-9]*\b/i;

const STOP_WORDS = new Set([
  "i", "me", "my", "we", "our", "you", "your", "it", "its", "the", "a", "an",
  "is", "are", "was", "were", "be", "been", "am", "do", "does", "did", "have",
  "has", "had", "can", "could", "will", "would", "shall", "should", "may",
  "might", "must", "need", "dare", "to", "of", "in", "for", "on", "with",
  "at", "by", "from", "as", "into", "about", "like", "through", "after",
  "over", "between", "out", "up", "down", "off", "then", "than", "too",
  "very", "just", "so", "not", "no", "nor", "and", "but", "or", "if",
  "that", "this", "these", "those", "what", "which", "who", "whom", "how",
  "all", "each", "every", "any", "some", "such", "only", "also", "both",
  "here", "there", "when", "where", "why", "see", "show", "get", "got",
  "want", "looking", "look", "find", "please", "thanks", "thank", "hey",
  "hi", "hello", "yeah", "yes", "yep", "nope", "okay", "ok", "much",
  "many", "still", "right", "thing", "things", "come", "something",
  "carry", "sell", "available", "stock", "interested", "recommend",
  "suggest", "prefer", "budget", "price", "cost", "cheap", "expensive",
  "affordable", "best", "popular", "favorite", "options", "selection",
  "range", "need", "buy", "purchase", "order", "shop", "store", "guys",
  "motorcycle", "bike", "riding", "rider", "ride",
  "whats", "good", "great", "nice", "decent", "solid", "quality", "really",
  "pretty", "kind", "type", "pair", "one", "two", "ones", "new", "old",
  "big", "small", "little", "gonna", "wanna", "gotta", "maybe", "probably",
  "someone", "anything", "everything", "lot", "lots", "bit", "sure", "well",
]);

const PHRASE_SYNONYMS: [RegExp, string][] = [
  [/brain bucket/gi, "helmet"],
  [/rain suit/gi, "rain gear waterproof"],
  [/\brain gear\b/gi, "rain waterproof"],
  [/dirt bike plastics/gi, "fender number plate side panel"],
  [/dirtbike plastics/gi, "fender number plate side panel"],
  [/\bdirt\s+bike\b/gi, "dirtbike offroad mx"],
  [/\bhi[\s-]?vis\b/gi, "high visibility fluorescent"],
  [/\bhivis\b/gi, "high visibility fluorescent"],
  [/\bexhaust system/gi, "exhaust pipe muffler"],
  [/\bexhaust systems/gi, "exhaust pipe muffler"],
  [/\btech[\s-]?air\b/gi, "tech-air airbag"],
  [/\bair\s*bag\b/gi, "airbag"],
  [/\bavy\s+airbag/gi, "avalanche airbag"],
  [/\bavy\s+bag/gi, "avalanche airbag"],
  [/\bphone\s+mount/gi, "quadlock ram mount phone mount"],
  [/\bleathers\b/gi, "leather suit race suit one piece"],
  [/\bcans\b/gi, "exhaust muffler slip-on"],
  [/\baction\s+cam(?:era)?/gi, "insta360 action camera"],
  [/\bsnow\s+plow/gi, "snow plow"],
  [/\belectric\s+bike/gi, "ebike e-bike electric"],
  [/\belectric\s+motorcycle/gi, "ebike e-bike electric"],
  [/\bbalance\s+bike/gi, "stacyc balance bike"],
  // Model-name normalization — prevents single-char tokens (e.g. "x") from
  // being dropped by the length filter after punctuation stripping.
  [/\bx[\s-]?fifteen\b/gi, "x-15"],
  [/\bx[\s-]?15\b/gi, "x-15"],
  [/\bs[\s-]?r[\s-]?7\b/gi, "s-r7"],
  [/\brs[\s-]?7\b/gi, "s-r7"],
  [/\bnz[\s-]?race\b/gi, "nz-race"],
  [/\brf[\s-]?1400\b/gi, "rf-1400"],
  [/\brf[\s-]?sr\b/gi, "rf-sr"],
  [/\br2r\b/gi, "r2r"],
  [/\bkx[\s-]?1\b/gi, "kx-1"],
  [/\bcorsair[\s-]?x\b/gi, "corsair-x"],
  [/\bcontour[\s-]?x\b/gi, "contour-x"],
  [/\bquantum[\s-]?x\b/gi, "quantum-x"],
];

const QUERY_SYNONYMS: Record<string, string> = {
  kid: "youth", kids: "youth", children: "youth", child: "youth",
  womens: "women", mens: "men",
  motocross: "mx", dirtbike: "dirt", offroad: "mx",
  lid: "helmet", lids: "helmet",
  pipe: "exhaust", pipes: "exhaust",
  revit: "rev'it",
  firstgeer: "firstgear",
  plastics: "fender",
  panniers: "pannier",
  cans: "exhaust",
  leathers: "race suit leather suit",
  mirror: "mirrors", mirrors: "mirror",
  sprockets: "sprocket",
  visor: "shield",
  shield: "visor",
  "tech-air": "airbag",
  "techair": "airbag",
  airbag: "tech-air",
  airbags: "tech-air",
  intercom: "cardo sena communication",
  intercoms: "cardo sena communication",
  bluetooth: "cardo sena communication",
  headset: "cardo sena communication",
  communicator: "cardo sena communication",
  gps: "garmin navigation",
  navigation: "garmin gps",
  "action camera": "insta360 camera",
  "phone mount": "quadlock ram mount",
  ebike: "e-bike electric",
  "e-bike": "ebike electric",
  "electric bike": "ebike e-bike",
  "electric motorcycle": "ebike e-bike",
  scooter: "ebike e-bike electric",
  snowmobile: "snow",
  snowplow: "snow plow",
  "snow plow": "plow snow",
  winch: "snow plow winch",
  avalanche: "backcountry avy",
  backcountry: "avalanche snow",
};

const ALL_COLOR_WORDS: Set<string> = (() => {
  const s = new Set<string>();
  for (const [primary, synonyms] of Object.entries(colorSynonymMap)) {
    s.add(primary);
    for (const syn of synonyms) {
      if (!syn.includes(" ")) s.add(syn);
    }
  }
  return s;
})();

const COLOR_OPTION_NAMES = ["color", "colour", "colorway", "finish", "style", "graphics", "color/graphics"];

function isColorOption(displayName: string): boolean {
  const lower = displayName.toLowerCase();
  return COLOR_OPTION_NAMES.some((name) => lower.includes(name));
}

function colorWordMatch(label: string, colorTerm: string): boolean {
  const re = new RegExp(`(^|[\\s/\\-_,.(])${colorTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[\\s/\\-_,.)])`, "i");
  return re.test(label) || label === colorTerm;
}

export function productHasColor(product: BCProduct, expandedColors: Set<string>): boolean {
  if (!product.variants || product.variants.length === 0) return false;

  return product.variants.some((v) =>
    (v.option_values || []).some((ov) => {
      if (!ov.label || !ov.option_display_name) return false;
      if (!isColorOption(ov.option_display_name)) return false;
      const label = ov.label.toLowerCase();
      for (const c of Array.from(expandedColors)) {
        if (colorWordMatch(label, c)) return true;
      }
      return false;
    })
  );
}

/**
 * Returns the unique color-option variant labels whose value contains any of the
 * expanded color terms. Used to surface matching colorways explicitly in the
 * prompt so the LLM can't claim a product "doesn't come in" the requested color.
 */
export function getMatchingColorLabels(
  product: BCProduct,
  expandedColors: Set<string>
): string[] {
  if (!product.variants || product.variants.length === 0) return [];
  const seen = new Set<string>();
  const matches: string[] = [];
  for (const v of product.variants) {
    for (const ov of v.option_values || []) {
      if (!ov.label || !ov.option_display_name) continue;
      if (!isColorOption(ov.option_display_name)) continue;
      const label = ov.label;
      const lower = label.toLowerCase();
      let hit = false;
      for (const c of Array.from(expandedColors)) {
        if (colorWordMatch(lower, c)) {
          hit = true;
          break;
        }
      }
      if (hit && !seen.has(lower)) {
        seen.add(lower);
        matches.push(label);
      }
    }
  }
  return matches;
}

function boostColorMatches(products: BCProduct[], color: string): BCProduct[] {
  const expanded = new Set(expandColorQuery(color).map((c) => c.toLowerCase()));

  const matching: BCProduct[] = [];
  const rest: BCProduct[] = [];

  for (const p of products) {
    if (productHasColor(p, expanded)) {
      matching.push(p);
    } else {
      rest.push(p);
    }
  }

  return matching.length > 0 ? matching : rest;
}

const PRODUCT_TYPE_MAP: Record<string, string[]> = {
  airbag: ["airbag", "airbags", "air bag", "air bags", "tech-air", "tech air", "ai-1", "plasma system"],
  helmet: ["helmet", "helmets", "lid", "lids", "brain bucket", "full face", "half helmet", "modular", "open face"],
  jacket: ["jacket", "jackets", "coat"],
  pants: ["pants", "pant", "jeans", "overpants"],
  gloves: ["gloves", "glove", "gauntlet", "gauntlets"],
  boots: ["boots", "boot", "shoes", "shoe"],
  vest: ["vest", "vests"],
  suit: ["suit", "suits", "one piece", "one-piece", "leathers"],
  tire: ["tire", "tires", "tyre", "tyres", "inner tube", "inner tubes"],
  exhaust: ["exhaust", "pipe", "pipes", "muffler", "header", "cans", "can", "slip-on", "slip on"],
  chain: ["chain", "chains", "sprocket", "sprockets"],
  oil: ["oil", "oils", "lubricant", "lube"],
  battery: ["battery", "batteries"],
  brake: ["brake", "brakes", "rotor", "rotors", "pad", "pads"],
  visor: ["visor", "shield", "face shield"],
  bag: ["bag", "bags", "luggage", "saddlebag", "saddlebags", "pannier", "panniers", "tank bag"],
  jersey: ["jersey", "jerseys"],
  goggle: ["goggle", "goggles"],
  armor: ["armor", "armour", "protector", "protection", "guard", "guards", "back protector", "chest protector"],
  communication: ["intercom", "intercoms", "communicator", "communicators", "headset", "headsets", "bluetooth"],
  camera: ["camera", "cameras", "action camera", "dashcam"],
  mount: ["phone mount", "phone mounts", "device mount", "gps mount"],
  ebike: ["e-bike", "e-bikes", "ebike", "ebikes", "electric bike", "electric motorcycle", "electric scooter"],
  snowplow: ["snow plow", "snow plows", "plow blade", "plow mount", "winch"],
  snowgear: ["snowmobile gear", "snowmobile helmet", "snowmobile jacket", "snowmobile pants"],
  accessory: ["accessory", "accessories", "add-on", "add-ons", "extras", "accessory pack"],
};

export function extractProductType(query: string): string | null {
  // Broad-type regexes checked first — these return non-SupportedProductType
  // strings that feed the broad-type category path instead of subcategory routing.
  if (/\b(communicator|intercom|bluetooth|comm system|comms?)\b/i.test(query)) return "comm";
  if (/\b(goggles?|moto goggles?)\b/i.test(query)) return "goggles";
  if (/\b(brake pads?|brake shoes?)\b/i.test(query)) return "brake";
  if (/\b(sprockets?|front sprocket|rear sprocket)\b/i.test(query)) return "sprocket";
  if (/\b(chain lube|chain wax)\b/i.test(query)) return "chemical";
  if (/\b(air filters?|oil filters?|filter)\b/i.test(query)) return "filter";

  const lower = query.toLowerCase();
  for (const [type, terms] of Object.entries(PRODUCT_TYPE_MAP)) {
    for (const term of terms) {
      const re = new RegExp(`(^|\\s)${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(s|es)?($|\\s|\\?)`, "i");
      if (re.test(lower)) return type;
    }
  }
  return null;
}

function isInStock(product: BCProduct): boolean {
  if (product.inventory_tracking === "none") return true;
  return product.inventory_level > 0;
}

export interface BudgetInfo {
  max: number | null;
  min: number | null;
  phrase: string;
  soft: boolean;
}

// Parse amounts like "$1,200", "1200", "1,200 dollars" into a number.
function parseAmount(raw: string): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[$,\s]/g, "");
  if (!cleaned) return null;
  const n = parseFloat(cleaned);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

/**
 * Detects a customer-stated budget in free text. Returns null when no budget
 * signal is found. Ordered so more specific patterns (ranges, ceilings) win
 * over looser ones (around/about, bare "budget $N").
 */
export function extractBudget(text: string): BudgetInfo | null {
  if (!text) return null;
  const t = text.toLowerCase();

  const amt = `\\$?\\s*([0-9][0-9,]*(?:\\.\\d+)?)\\s*(?:dollars?|bucks?|usd)?`;

  // Range: "$200-$500", "$200 to $500", "between $200 and $500"
  const rangeRe = new RegExp(
    `(?:between\\s+)?${amt}\\s*(?:-|to|and|\\u2013)\\s*${amt}`,
    "i"
  );
  const rangeMatch = t.match(rangeRe);
  if (rangeMatch) {
    const a = parseAmount(rangeMatch[1]);
    const b = parseAmount(rangeMatch[2]);
    if (a && b && a < b && a >= 10 && b >= 20) {
      return {
        min: a,
        max: b,
        phrase: rangeMatch[0].trim(),
        soft: false,
      };
    }
  }

  // Hard ceiling: "under $300", "less than $300", "below $300", "max $300",
  // "no more than $300", "not more than $300", "up to $300", "within $300".
  const ceilingRe = new RegExp(
    `(?:under|less than|below|no more than|not more than|max(?:imum)?(?:\\s+of)?|up to|within|at most|cap(?:ped)?\\s+at)\\s+${amt}`,
    "i"
  );
  const ceilingMatch = t.match(ceilingRe);
  if (ceilingMatch) {
    const n = parseAmount(ceilingMatch[1]);
    if (n && n >= 10) {
      return { min: null, max: n, phrase: ceilingMatch[0].trim(), soft: false };
    }
  }

  // Explicit budget keyword: "budget of $300", "budget is $300",
  // "my budget is 300", "spend $300", "spend up to $300", "keep it under $300".
  const explicitRe = new RegExp(
    `(?:(?:my\\s+)?budget(?:\\s+is|\\s+of|:)?|(?:i\\s+(?:want\\s+to\\s+|can\\s+)?)?spend(?:ing)?(?:\\s+up\\s+to)?|keep\\s+it\\s+under|price\\s+range\\s+(?:of|is|around))\\s+${amt}`,
    "i"
  );
  const explicitMatch = t.match(explicitRe);
  if (explicitMatch) {
    const n = parseAmount(explicitMatch[1]);
    if (n && n >= 10) {
      return { min: null, max: n, phrase: explicitMatch[0].trim(), soft: false };
    }
  }

  // Soft target: "around $300", "about $300", "roughly $300", "near $300",
  // "in the $300 range", "ballpark $300". Bot treats max = n * 1.15.
  const softRe = new RegExp(
    `(?:around|about|roughly|near(?:ly)?|ballpark(?:\\s+of)?|in\\s+the)\\s+${amt}(?:\\s+range)?`,
    "i"
  );
  const softMatch = t.match(softRe);
  if (softMatch) {
    const n = parseAmount(softMatch[1]);
    if (n && n >= 20) {
      return {
        min: null,
        max: Math.round(n * 1.15),
        phrase: softMatch[0].trim(),
        soft: true,
      };
    }
  }

  return null;
}

export function extractKeywords(query: string): string[] {
  let processed = query.toLowerCase();
  for (const [pattern, replacement] of PHRASE_SYNONYMS) {
    processed = processed.replace(pattern, replacement);
  }

  const words = processed
    .replace(/[?!.,;:'"()]/g, "")
    .split(/\s+/)
    .filter((w) => {
      if (STOP_WORDS.has(w)) return false;
      if (/^\d+$/.test(w)) return true;
      return w.length > 1;
    });

  const expanded: string[] = [];
  for (const w of words) {
    expanded.push(w);
    if (QUERY_SYNONYMS[w]) expanded.push(QUERY_SYNONYMS[w]);
  }
  return expanded;
}

/**
 * Fetch full BigCommerce product details for a local catalog match.
 * Tries multiple strategies: full name, then first 3 words.
 */
async function enrichLocalMatch(match: LocalMatch): Promise<BCProduct | null> {
  try {
    const nameLower = match.name.toLowerCase();

    const searchName = match.name.length > 60
      ? match.name.substring(0, 60)
      : match.name;

    let products = await getProductByNameLike(searchName, 10);

    if (products.length === 0) {
      const words = match.name.split(/\s+/);
      if (words.length > 2) {
        const shortName = words.slice(0, 3).join(" ");
        products = await getProductByNameLike(shortName, 10);
      }
    }

    if (products.length === 0) return null;

    const exact = products.find(
      (p) => p.name.toLowerCase() === nameLower
    );
    if (exact) return exact;

    const fuse = new Fuse(products, {
      keys: ["name"],
      threshold: 0.4,
      includeScore: true,
    });
    const ranked = fuse.search(match.name);
    return ranked.length > 0 ? ranked[0].item : products[0];
  } catch {
    return null;
  }
}

// Canonical BC category names per productType + subcategory. Used to bypass
// the brand-keyword trap where a query like "alpinestars mx helmets"
// matches the Alpinestars brand category (mixed product types) and the
// MX helmets never surface because their names like "Supertech M10"
// don't contain "mx" or "moto" tokens. Try alternates in order.
const TYPE_SUBCATEGORY_CATEGORIES: Partial<
  Record<SupportedProductType, Partial<Record<SubcategoryValue, string[]>>>
> = {
  helmet: {
    mx:         ["MX Helmets", "Moto Helmets", "Offroad Helmets"],
    full_face:  ["Street Helmets", "Full Face Helmets"],
    modular:    ["Modular Helmets"],
    adventure:  ["Adventure Helmets"],
    open_face:  ["Open Face Helmets"],
    half:       ["Half Helmets"],
  },
  jacket: {
    mx:      ["MX Jackets", "Moto Jackets"],
    street:  ["Street Jackets"],
    adventure: ["Adventure Jackets"],
    cruiser: ["Cruiser Jackets"],
    racing:  ["Race Jackets", "Racing Jackets"],
  },
  boots: {
    mx:        ["MX Boots", "Moto Boots"],
    street:    ["Street Boots"],
    adventure: ["Adventure Boots"],
    racing:    ["Race Boots", "Racing Boots"],
    cruiser:   ["Cruiser Boots"],
  },
  gloves: {
    mx:        ["MX Gloves", "Moto Gloves"],
    street:    ["Street Gloves"],
    adventure: ["Adventure Gloves"],
    racing:    ["Race Gloves", "Racing Gloves"],
    winter:    ["Winter Gloves", "Heated Gloves"],
  },
  pants: {
    mx:        ["MX Pants", "Moto Pants"],
    street:    ["Street Pants"],
    adventure: ["Adventure Pants"],
    cruiser:   ["Cruiser Pants"],
  },
  tire: {
    dirt:          ["Dirt Tires", "Offroad Tires"],
    sport:         ["Sport Tires", "Sportbike Tires"],
    sport_touring: ["Sport Touring Tires"],
    adventure:     ["Adventure Tires", "Dual Sport Tires"],
    cruiser:       ["Cruiser Tires"],
  },
};

// For productType-only queries (no explicit subcategory), default to the
// street-appropriate canonical category. Catches "show me alpinestars
// helmets" without subcategory — surfaces street/full-face items first.
const TYPE_DEFAULT_CATEGORIES: Partial<Record<SupportedProductType, string[]>> = {
  helmet: ["Street Helmets", "Full Face Helmets"],
  jacket: ["Street Jackets"],
  boots:  ["Street Boots"],
  gloves: ["Street Gloves"],
  pants:  ["Street Pants"],
  tire:   ["Sport Touring Tires"],
};

const BROAD_TYPE_CATEGORIES: Record<string, string[]> = {
  comm:     ["Comm Systems", "Electronics"],
  goggles:  ["Goggles"],
  brake:    ["Brake Pads/Brake Shoes"],
  sprocket: ["Sprockets"],
  filter:   ["Air Filters", "Oil Filters"],
};

// ---------------------------------------------------------------------------
// Known brands — used by extractBrand to detect a brand token in the query.
// Multi-word brands come before single-word prefixes they share (e.g.
// "fox racing" before "fox") so first-match is unambiguous.
// Lowercase; extractBrand lowercases the query before comparing.
// ---------------------------------------------------------------------------

const KNOWN_BRANDS_LOWER: string[] = [
  "alpinestars", "shoei", "arai", "schuberth", "sidi", "klim",
  "rev'it", "revit", "rev it",
  "fox racing", "fox",
  "bell", "scorpion", "gaerne", "dainese", "agv", "nolan", "hjc",
  "icon", "ls2", "simpson", "shark", "o'neal", "oneal", "leatt",
  "6d", "troy lee designs", "tld", "answer", "thor", "fly racing", "fly",
  "michelin", "dunlop", "pirelli", "metzeler", "bridgestone", "shinko",
  "continental", "kenda", "maxxis", "irc",
  "bilt", "highway 21", "z1r", "tourmaster", "tour master", "noru",
  "sedici", "gmax", "cortech", "joe rocket", "speed and strength",
  "oxford", "sw-motech", "givi", "shad", "kriega",
  "evs", "leatt brace", "atlas", "fxr", "509", "100%",
  "cardo", "sena", "ebc", "renthal", "sunstar", "akrapovic", "yoshimura",
  "garmin", "insta360",
];

/**
 * Scan the query for a known brand token. Multi-word brands are checked before
 * any single-word prefix they share. Returns the matched brand (lowercase) or
 * null if none found.
 */
export function extractBrand(query: string): string | null {
  const lower = query.toLowerCase();
  for (const b of KNOWN_BRANDS_LOWER) {
    const escaped = b.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(^|[^a-z0-9'])${escaped}($|[^a-z0-9'])`, "i");
    if (re.test(lower)) return b;
  }
  return null;
}

// ---------------------------------------------------------------------------
// searchProducts — single scored pipeline
// ---------------------------------------------------------------------------

export async function searchProducts(
  query: string
): Promise<{ products: BCProduct[]; detectedColor: string | null }> {
  if (!query || query.trim().length === 0)
    return { products: [], detectedColor: null };

  const normalizedQuery = query.trim();

  // Step 1: SKU exact match (fastest path)
  const detectedColor = extractColorFromQuery(normalizedQuery);
  const skuMatch = normalizedQuery.match(SKU_PATTERN);
  if (skuMatch) {
    const skuProduct = await getProductBySKU(skuMatch[0]);
    if (skuProduct?.is_visible) return { products: [skuProduct], detectedColor };
  }

  // Step 2: Extract signals
  const productType = extractProductType(normalizedQuery);
  const subRequest: SubcategoryRequest = isSupportedProductType(productType)
    ? extractSubcategoryRequest(normalizedQuery, productType)
    : null;
  const budget = extractBudget(normalizedQuery);
  const brand = extractBrand(normalizedQuery);

  const allKeywords = extractKeywords(normalizedQuery);
  const keywords = detectedColor
    ? allKeywords.filter((kw) => !ALL_COLOR_WORDS.has(kw.toLowerCase()))
    : allKeywords;
  const kwTokens = keywords.length > 0 ? keywords : allKeywords;

  if (kwTokens.length === 0) return { products: [], detectedColor };

  const applyColor = (results: BCProduct[]) =>
    detectedColor && results.length > 0
      ? boostColorMatches(results, detectedColor)
      : results;

  // Step 3: Build ONE candidate pool via four parallel strategies.
  // All four run concurrently; results are unioned and deduplicated (≤ 200).
  const [subCatResults, brandResults, bcKwResults, localMatches] = await Promise.all([

    // 3a: canonical subcategory/type/broad-type category
    (async (): Promise<BCProduct[]> => {
      let candidates: string[] | undefined;
      if (isSupportedProductType(productType)) {
        if (subRequest && subRequest.explicit) {
          candidates = TYPE_SUBCATEGORY_CATEGORIES[productType]?.[subRequest.value];
        }
        if (!candidates || candidates.length === 0) {
          candidates = TYPE_DEFAULT_CATEGORIES[productType];
        }
      } else if (productType) {
        candidates = BROAD_TYPE_CATEGORIES[productType];
      }
      if (!candidates || candidates.length === 0) return [];
      for (const catName of candidates) {
        try {
          const cat = await findCategoryByName(catName);
          if (cat) {
            const products = await getProductsByCategory(cat.id, 100);
            if (products.length > 0) {
              if (productType && !isSupportedProductType(productType)) {
                for (const p of products) {
                  (p as BCProduct & { _broadType?: string })._broadType = productType;
                }
              }
              return products;
            }
          }
        } catch { /* continue to next candidate */ }
      }
      return [];
    })(),

    // 3b: brand category — paginate 100 (double the old 50 limit)
    (async (): Promise<BCProduct[]> => {
      if (!brand) return [];
      try {
        const cat = await findCategoryByName(brand);
        if (cat) return getProductsByCategory(cat.id, 100);
      } catch { /* */ }
      return [];
    })(),

    // 3c: BC keyword search
    searchProductsBC(kwTokens.slice(0, 6).join(" ")).catch(() => [] as BCProduct[]),

    // 3d: local catalog (enrichment happens after all parallel work completes)
    searchLocalCatalog(kwTokens.join(" "), 20).catch(() => [] as LocalMatch[]),
  ]);

  // Enrich local matches in parallel
  const enriched: BCProduct[] = [];
  if (localMatches.length > 0) {
    const enrichResults = await Promise.all(
      localMatches.slice(0, 12).map((m) => enrichLocalMatch(m))
    );
    for (const p of enrichResults) {
      if (p?.is_visible) enriched.push(p);
    }
  }

  // Union all sources into a deduplicated pool (≤ 200 visible products)
  const deduped = new Map<number, BCProduct>();
  function addProducts(products: BCProduct[]) {
    for (const p of products) {
      if (p.is_visible && !deduped.has(p.id) && deduped.size < 200) {
        deduped.set(p.id, p);
      }
    }
  }
  addProducts(subCatResults);
  addProducts(brandResults);
  addProducts(bcKwResults);
  addProducts(enriched);

  const pool = Array.from(deduped.values());

  if (pool.length === 0) {
    console.warn("[searchProducts] zero_result", {
      query: normalizedQuery,
      productType,
      brand,
      subcategoryRequest: subRequest,
    });
    return { products: [], detectedColor };
  }

  // Step 4: Annotate subcategories for supported product types.
  // classifyProductSubcategory uses a 5-min TTL in-process cache, so this is
  // cheap even at pool size 200.
  if (isSupportedProductType(productType)) {
    await Promise.all(
      pool.map((p) =>
        classifyProductSubcategory(p, productType)
          .then((sub) => {
            (p as BCProduct & { _subcategory?: SubcategoryValue | null })._subcategory = sub;
          })
          .catch(() => {})
      )
    );
  }

  // Expanded color set for the +40 scoring signal
  const expandedColors = detectedColor
    ? new Set(expandColorQuery(detectedColor).map((c) => c.toLowerCase()))
    : new Set<string>();

  // Step 5: Single scoring pass
  function scoreProduct(p: BCProduct): number {
    let score = 0;
    const nameLower = p.name.toLowerCase();
    const price = p.calculated_price || p.price;
    const sub = (p as BCProduct & { _subcategory?: SubcategoryValue | null })._subcategory ?? null;

    // +100: explicit subcategory match
    if (subRequest && subRequest.explicit && sub === subRequest.value) score += 100;

    // +80: brand token in product name
    if (brand && nameLower.includes(brand)) score += 80;

    // +60: product type term in name
    if (productType && PRODUCT_TYPE_MAP[productType]?.some((t) => nameLower.includes(t))) score += 60;

    // +40: detected color matches a variant or appears in name
    if (
      detectedColor &&
      (productHasColor(p, expandedColors) || nameLower.includes(detectedColor))
    ) score += 40;

    // +30: in stock
    if (isInStock(p)) score += 30;

    // +5 per keyword overlap (max 4 tokens → max +20)
    score += Math.min(4, kwTokens.filter((kw) => nameLower.includes(kw)).length) * 5;

    // -50: off-street bias when customer was ambiguous (not "any", not explicit)
    if (
      isSupportedProductType(productType) &&
      subRequest === null &&
      sub &&
      OFF_STREET_SUBCATEGORIES.has(sub)
    ) score -= 50;

    // -1000: hard budget penalty (effectively a filter via sort + slice)
    if (budget?.max && price > budget.max) score -= 1000;

    return score;
  }

  // Step 6: Sort desc, apply hard budget filter, take top 12, boost color
  pool.sort((a, b) => scoreProduct(b) - scoreProduct(a));

  // Hard-filter products that exceed a stated budget max so the LLM is never
  // shown items the customer explicitly said they can't afford.
  const withinBudget = budget?.max
    ? pool.filter((p) => (p.calculated_price || p.price) <= budget.max!)
    : pool;

  let results = withinBudget.slice(0, 12);
  results = applyColor(results);

  if (results.length === 0) {
    console.warn("[searchProducts] zero_result", {
      query: normalizedQuery,
      productType,
      brand,
      subcategoryRequest: subRequest,
    });
  }

  return { products: results, detectedColor };
}

export function extractSKUFromText(text: string): string | null {
  const match = text.match(SKU_PATTERN);
  return match ? match[0] : null;
}

// ---------------------------------------------------------------------------
// Accessory intent: did the customer ask for accessories *for* something?
// ---------------------------------------------------------------------------
//
// "accessories for my Shoei RF-1400" → returns a subject hint we can hand to
// findPairings. Two strategies, in order of preference:
//   1. SKU pattern present in the latest message → use it directly.
//   2. A product name from prior conversation history → return the most
//      recently mentioned BC product name from the assistant's history.
//
// The caller is responsible for resolving the hint into a concrete pairing
// lookup; this function only surfaces the hint so buildPrompt can call
// findPairings without page context.

export interface AccessorySubjectHint {
  sku: string | null;
  productName: string | null;
  isAccessoryQuery: boolean;
}

const ACCESSORY_QUERY_PATTERNS: RegExp[] = [
  /\baccessor(?:y|ies)\b/i,
  /\badd[\s-]?ons?\b/i,
  /\bextras?\b/i,
  /\bgo\s+with\b/i,
  /\bpair(?:ed|s)?\s+with\b/i,
  /\bcompanion\b/i,
];

const HISTORY_SCAN_LIMIT = 10;

/**
 * The shared SKU_PATTERN is intentionally permissive (matches alpha-only
 * tokens like "RF1400") but that means it also matches normal words like
 * "what" or "looking". For accessory subject resolution we want stricter
 * confidence — only accept SKU-like tokens that contain a digit or
 * dash/underscore separator. Iterates over ALL pattern matches and returns
 * the first one that passes the stricter filter.
 */
function extractStrictSku(text: string): string | null {
  if (!text) return null;
  const re = new RegExp(SKU_PATTERN.source, "gi");
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const token = match[0];
    const hasDigit = /\d/.test(token);
    const hasSeparator = /[-_]/.test(token);
    if (hasDigit || hasSeparator) return token;
  }
  return null;
}

/**
 * Detect accessory intent in the latest message and (optionally) resolve a
 * subject SKU or product name from the conversation history.
 *
 * @param latestMessage - the customer's most recent message
 * @param historyContents - last N message contents (newest LAST), used to find
 *   a fallback subject when the customer says "for it" / "for that helmet"
 */
export function extractAccessorySubject(
  latestMessage: string,
  historyContents: string[] = []
): AccessorySubjectHint {
  const isAccessoryQuery = ACCESSORY_QUERY_PATTERNS.some((re) => re.test(latestMessage));

  const skuFromLatest = extractStrictSku(latestMessage);
  if (skuFromLatest && isAccessoryQuery) {
    return { sku: skuFromLatest, productName: null, isAccessoryQuery: true };
  }

  if (!isAccessoryQuery) {
    return { sku: null, productName: null, isAccessoryQuery: false };
  }

  const recent = historyContents.slice(-HISTORY_SCAN_LIMIT);
  for (let i = recent.length - 1; i >= 0; i--) {
    const content = recent[i];
    const sku = extractStrictSku(content);
    if (sku) return { sku, productName: null, isAccessoryQuery: true };
  }

  const NAME_PATTERN = /\*\*([^*]{4,80})\*\*/g;
  for (let i = recent.length - 1; i >= 0; i--) {
    const content = recent[i];
    let match: RegExpExecArray | null;
    let lastName: string | null = null;
    NAME_PATTERN.lastIndex = 0;
    while ((match = NAME_PATTERN.exec(content)) !== null) {
      lastName = match[1].trim();
    }
    if (lastName) {
      return { sku: null, productName: lastName, isAccessoryQuery: true };
    }
  }

  return { sku: null, productName: null, isAccessoryQuery: true };
}

// ---------------------------------------------------------------------------
// Follow-up product resolution (sizes, stock, "tell me more", "that one")
// ---------------------------------------------------------------------------
//
// When the customer asks a short detail question after the assistant listed
// products in markdown (**Name**), the fresh keyword search often drops the
// referenced product from RELEVANT PRODUCTS. We recover the subject from the
// latest message (strict SKU) or from the most recent assistant reply that
// contains a bold product title, then fetch full BC data for buildPrompt.

export interface DiscussedProductSubject {
  sku: string | null;
  productName: string | null;
}

const BOLD_PRODUCT_PATTERN = /\*\*([^*]{4,120})\*\*/g;

function extractLastBoldProductNameFromRecent(contents: string[]): string | null {
  const recent = contents.slice(-HISTORY_SCAN_LIMIT);
  for (let i = recent.length - 1; i >= 0; i--) {
    const content = recent[i];
    let lastName: string | null = null;
    BOLD_PRODUCT_PATTERN.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = BOLD_PRODUCT_PATTERN.exec(content)) !== null) {
      lastName = match[1].trim();
    }
    if (lastName) return lastName;
  }
  return null;
}

/**
 * True when the latest message looks like a follow-up about an item already
 * in the thread (sizes, stock, price, ordinals, "that one") rather than a fresh
 * broad catalog question. Long messages are treated as new searches.
 */
export function isLikelyProductFollowUp(latestMessage: string): boolean {
  const t = latestMessage.trim();
  if (!t) return false;
  if (extractStrictSku(t)) return true;
  if (t.length > 140) return false;

  const patterns: RegExp[] = [
    /\bwhat(\s|'s|s)?\s+.{0,40}\b(price|cost)\b/i,
    /\bhow\s+much\b/i,
    /\bsizes?\b/i,
    /\bwhat\s+sizes?\b/i,
    /\bin\s+stock\b/i,
    /\bout\s+of\s+stock\b/i,
    /\b(low\s+)?stock\b/i,
    /\bavailable\b.{0,30}\b(in|for|size|color)\b/i,
    /\b(tell|show)\s+me\s+more\b/i,
    /\bmore\s+(details|info)\b/i,
    /\bthe\s+(first|second|third|cheapest|cheaper)\b/i,
    /\bthat\s+one\b/i,
    /\bthis\s+one\b/i,
    /\b(is|are)\s+.{0,20}\b(in\s+stock|available)\b/i,
    /\bdo\s+you\s+have\b.{0,20}\b(in|size|xl|xxl|large|medium|small)\b/i,
    /\b(variant|variants|colorway|colour|color)\b/i,
    /\bfit(s|ting)?\b/i,
    // "ones" / "one" used as a pronoun referring back to prior products
    // (catches: "show me ones motocross", "the red ones", "any blue ones")
    /\bones?\b(?!\s+(piece|day|time|way))/i,
    // refinement starters with a descriptor
    // (catches: "what about motocross", "what about in red")
    /\bwhat\s+about\b/i,
    // "any [descriptor]" / "any in [X]" / "got any [X]"
    /\b(any|got|have)\s+(in|with|for|that)\b/i,
    /^\s*(any|got|have)\s+\w+\??\s*$/i,
    // message starts with a preposition narrowing the prior subject
    // (catches: "in red", "with bluetooth", "for motocross", "in mx")
    /^\s*(in|with|for)\s+\w+/i,
    // "show me [descriptor]" / "show me the [descriptor]" — short refinements
    // (catches: "show me motocross", "show me the red ones", "show me cheaper")
    /^\s*show\s+me\s+(the\s+|a\s+|an\s+)?\w+(\s+ones?)?\s*\??\s*$/i,
  ];
  return patterns.some((p) => p.test(t));
}

/**
 * Resolve which product the customer is following up on. Returns null when the
 * message does not look like a product-detail follow-up or when no prior
 * assistant product title exists to anchor on.
 */
export function extractDiscussedProductSubject(
  latestMessage: string,
  assistantHistoryContents: string[]
): DiscussedProductSubject | null {
  const sku = extractStrictSku(latestMessage);
  if (sku) return { sku, productName: null };

  if (!isLikelyProductFollowUp(latestMessage)) return null;

  const name = extractLastBoldProductNameFromRecent(assistantHistoryContents);
  if (name) return { sku: null, productName: name };

  return null;
}

/**
 * Re-export subcategory helpers from this module so consumers don't need to
 * import from two files. The actual implementation lives in `./subcategory`.
 */
export {
  classifyProductSubcategory,
  extractSubcategoryRequest,
  isSupportedProductType,
  type SubcategoryValue,
  type SupportedProductType,
  type SubcategoryRequest,
} from "./subcategory";
