import Fuse from "fuse.js";
import { searchLocalCatalog, type LocalMatch } from "./localCatalogSearch";
import {
  searchProductsBC,
  getProductBySKU,
  getProductByNameLike,
  getProductById,
  getProductsByCategory,
  findCategoryByName,
  type BCProduct,
} from "@/lib/bigcommerce/client";
import {
  extractColorFromQuery,
  expandColorQuery,
  colorSynonymMap,
} from "./colorSynonyms";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

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
};

const TYPE_EXCLUSION_TERMS: Record<string, string[]> = {
  jacket: ["chest protector", "body armor", "roost guard", "roost deflector", "chest guard",
    "under jersey", "pressure suit", "subframe", "bio-foam", "plastic shell"],
  helmet: ["helmet bag", "helmet lock", "helmet shield", "helmet visor"],
  boots: ["boot bag", "boot liner"],
  gloves: ["glove box", "glove compartment"],
  airbag: ["replacement canister", "canister only"],
};

const USE_CASE_SEARCH_TERMS: Record<string, Record<string, string[]>> = {
  helmet: {
    touring: ["modular helmet", "touring helmet", "full face helmet"],
    sport: ["full face helmet", "race helmet", "street helmet"],
    adventure: ["adventure helmet", "dual sport helmet", "adv helmet"],
    street: ["full face helmet", "street helmet", "modular helmet"],
    cruiser: ["half helmet", "open face helmet", "3/4 helmet"],
    offroad: ["motocross helmet", "mx helmet", "dirt helmet"],
    commute: ["modular helmet", "full face helmet", "street helmet"],
  },
  jacket: {
    touring: ["touring jacket", "adventure jacket", "waterproof jacket"],
    sport: ["leather jacket", "race jacket", "sport jacket"],
    adventure: ["adventure jacket", "adv jacket", "dual sport jacket"],
    cruiser: ["leather jacket", "cruiser jacket"],
  },
  boots: {
    touring: ["touring boots", "adventure boots", "waterproof boots"],
    sport: ["race boots", "sport boots", "track boots"],
    adventure: ["adventure boots", "dual sport boots"],
  },
  airbag: {
    street: ["tech-air airbag", "airbag vest", "klim ai-1", "tech-air plasma"],
    offroad: ["tech-air offroad", "tech-air mx", "offroad airbag"],
    avalanche: ["avalanche airbag", "klim atlas avalanche", "klim aspect avalanche"],
    mx: ["tech-air mx", "tech-air offroad", "offroad airbag"],
  },
  suit: {
    track: ["race suit", "one piece suit", "leather suit", "track suit"],
    sport: ["race suit", "one piece suit", "leather suit", "track suit"],
    street: ["riding suit", "leather suit"],
  },
};

export function extractProductType(query: string): string | null {
  const lower = query.toLowerCase();
  for (const [type, terms] of Object.entries(PRODUCT_TYPE_MAP)) {
    for (const term of terms) {
      const re = new RegExp(`(^|\\s)${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(s|es)?($|\\s|\\?)`, "i");
      if (re.test(lower)) return type;
    }
  }
  return null;
}

const USE_CASE_KEYWORDS = [
  "touring", "sport", "adventure", "street", "cruiser", "offroad",
  "commute", "commuting", "track", "race", "racing", "dirt", "mx",
  "dual sport", "adv", "avalanche",
];

function extractUseCase(query: string): string | null {
  const lower = query.toLowerCase();
  for (const uc of USE_CASE_KEYWORDS) {
    if (lower.includes(uc)) {
      if (uc === "commuting") return "commute";
      if (uc === "track" || uc === "race" || uc === "racing") return "sport";
      if (uc === "dirt" || uc === "mx") return "offroad";
      if (uc === "dual sport" || uc === "adv") return "adventure";
      return uc;
    }
  }
  return null;
}

function productMatchesType(product: BCProduct, type: string): boolean {
  const terms = PRODUCT_TYPE_MAP[type];
  if (!terms) return false;
  const nameLower = product.name.toLowerCase();
  const descLower = (product.description || "").replace(/<[^>]*>/g, "").toLowerCase();
  const matched = terms.some((term) => nameLower.includes(term) || descLower.substring(0, 500).includes(term));
  if (!matched) return false;

  const exclusions = TYPE_EXCLUSION_TERMS[type];
  if (exclusions) {
    const combined = nameLower + " " + descLower.substring(0, 800);
    if (exclusions.some((ex) => combined.includes(ex))) return false;
  }
  return true;
}

function isInStock(product: BCProduct): boolean {
  if (product.inventory_tracking === "none") return true;
  return product.inventory_level > 0;
}

function preferInStock(products: BCProduct[]): BCProduct[] {
  const inStock: BCProduct[] = [];
  const oos: BCProduct[] = [];
  for (const p of products) {
    if (isInStock(p)) inStock.push(p);
    else oos.push(p);
  }
  return inStock.length > 0 ? [...inStock, ...oos] : oos;
}

function filterByProductType(products: BCProduct[], type: string | null): BCProduct[] {
  if (!type || products.length === 0) return products;
  const matching = products.filter((p) => productMatchesType(p, type));
  return matching.length > 0 ? matching : products;
}

const PREMIUM_BRANDS = new Set([
  "alpinestars", "shoei", "arai", "schuberth", "sidi", "klim",
  "rev'it", "revit", "fox racing", "fox", "bell", "scorpion",
  "gaerne", "dainese", "agv", "nolan", "icon", "ls2",
  "michelin", "dunlop", "pirelli", "metzeler", "avon",
  "akrapovic", "yoshimura",
]);

const PREMIUM_BRANDS_LIST = Array.from(PREMIUM_BRANDS);

function isPremiumBrand(productName: string): boolean {
  const lower = productName.toLowerCase();
  return PREMIUM_BRANDS_LIST.some((brand) => lower.startsWith(brand) || lower.includes(brand + " "));
}

function scoreRelevance(product: BCProduct, keywords: string[]): number {
  const nameLower = product.name.toLowerCase();
  const descLower = (product.description || "").replace(/<[^>]*>/g, "").toLowerCase().substring(0, 600);
  let score = 0;
  for (const kw of keywords) {
    if (nameLower.includes(kw)) score += 3;
    else if (descLower.includes(kw)) score += 1;
  }
  if (isInStock(product)) score += 2;
  if (isPremiumBrand(product.name)) score += 1;
  return score;
}

function rankByRelevance(products: BCProduct[], keywords: string[]): BCProduct[] {
  return [...products].sort((a, b) => scoreRelevance(b, keywords) - scoreRelevance(a, keywords));
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

const CATEGORY_SYNONYMS: Record<string, string[]> = {
  mx: ["moto"],
  motocross: ["moto"],
  dirt: ["moto", "offroad"],
  offroad: ["moto"],
  "dual sport": ["adventure", "dual sport"],
  "dual-sport": ["adventure", "dual sport"],
  adv: ["adventure"],
  "full face": ["street", "full face", "race"],
  "open face": ["open face"],
  modular: ["modular"],
  flip: ["modular"],
  snow: ["snow", "snowmobile"],
  snowmobile: ["snow"],
  backcountry: ["snow"],
  "snow plow": ["snow"],
  snowplow: ["snow"],
  kids: ["kids"],
  youth: ["kids"],
  touring: ["street", "touring"],
  sport: ["street", "sport", "race"],
  adventure: ["adventure", "dual sport"],
  street: ["street"],
  race: ["race", "street"],
  cruiser: ["cruiser", "street"],
  electronics: ["electronics"],
  communication: ["electronics"],
  intercom: ["electronics"],
  bluetooth: ["electronics"],
  gps: ["electronics"],
  camera: ["electronics"],
  "phone mount": ["electronics"],
  ebike: ["ebikes"],
  "e-bike": ["ebikes"],
  "ebikes": ["ebikes"],
  "electric bike": ["ebikes"],
  "electric motorcycle": ["ebikes"],
  electric: ["ebikes"],
  parts: ["parts"],
  accessories: ["parts"],
  maintenance: ["parts"],
  controls: ["parts"],
  tools: ["parts"],
  stands: ["parts"],
};

function expandCategoryTerms(keywords: string[]): string[] {
  const expanded = new Set<string>();
  for (const kw of keywords) {
    expanded.add(kw);
    const synonyms = CATEGORY_SYNONYMS[kw.toLowerCase()];
    if (synonyms) {
      for (const s of synonyms) expanded.add(s);
    }
  }
  // Also try two-word combinations for multi-word synonyms
  for (let i = 0; i < keywords.length - 1; i++) {
    const pair = `${keywords[i]} ${keywords[i + 1]}`.toLowerCase();
    const synonyms = CATEGORY_SYNONYMS[pair];
    if (synonyms) {
      for (const s of synonyms) expanded.add(s);
    }
  }
  return Array.from(expanded);
}

async function searchByCategory(keywords: string[]): Promise<BCProduct[]> {
  const expandedTerms = expandCategoryTerms(keywords);

  const phrases = [
    expandedTerms.join(" "),
    ...expandedTerms.filter((w) => w.length > 2),
  ];

  for (const phrase of phrases) {
    try {
      const cat = await findCategoryByName(phrase);
      if (cat) {
        return getProductsByCategory(cat.id, 50);
      }
    } catch {
      /* continue */
    }
  }
  return [];
}

async function searchByColorway(
  color: string,
  keywords: string[]
): Promise<BCProduct[]> {
  try {
    const colorTerms = expandColorQuery(color);

    const colorConditions = colorTerms.map(
      (c) => sql`colorway_lower LIKE ${`%${c.toLowerCase()}%`}`
    );
    const colorWhere = colorConditions.reduce(
      (acc, cond) => sql`${acc} OR ${cond}`
    );

    const expandedCatTerms = expandCategoryTerms(keywords);
    const catKeywords = expandedCatTerms.filter(
      (w) => w.length > 1 && !ALL_COLOR_WORDS.has(w.toLowerCase())
    );

    let query;
    if (catKeywords.length > 0) {
      const catConditions = catKeywords.map(
        (w) => sql`(category ILIKE ${`%${w}%`} OR product_name ILIKE ${`%${w}%`})`
      );
      const catWhere = catConditions.reduce(
        (acc, cond) => sql`${acc} OR ${cond}`
      );
      query = sql`SELECT DISTINCT bc_product_id FROM product_colorways WHERE (${colorWhere}) AND (${catWhere}) LIMIT 15`;
    } else {
      query = sql`SELECT DISTINCT bc_product_id FROM product_colorways WHERE (${colorWhere}) LIMIT 15`;
    }

    const rows = await db.execute(query);
    const ids: number[] = [];
    const rawRows = Array.isArray(rows) ? rows : ((rows as unknown as { rows: { bc_product_id: number }[] }).rows || []);
    for (const r of rawRows) {
      const id = (r as { bc_product_id: number }).bc_product_id;
      if (id) ids.push(id);
    }

    if (ids.length === 0) return [];

    const products = await Promise.all(
      ids.map((id) => getProductById(id).catch(() => null))
    );
    return products.filter((p): p is BCProduct => p !== null && p.is_visible);
  } catch (e) {
    console.error("Colorway search error:", e);
    return [];
  }
}

export async function searchProducts(
  query: string
): Promise<{ products: BCProduct[]; detectedColor: string | null }> {
  if (!query || query.trim().length === 0)
    return { products: [], detectedColor: null };

  const normalizedQuery = query.trim();

  const detectedColor = extractColorFromQuery(normalizedQuery);

  const allKeywords = extractKeywords(normalizedQuery);
  let keywords = detectedColor
    ? allKeywords.filter((kw) => !ALL_COLOR_WORDS.has(kw.toLowerCase()))
    : allKeywords;
  if (keywords.length === 0) keywords = allKeywords;
  if (keywords.length === 0) return { products: [], detectedColor };

  const applyColor = (results: BCProduct[]) =>
    detectedColor && results.length > 0
      ? boostColorMatches(results, detectedColor)
      : results;

  // 1. Exact SKU lookup (fastest path)
  const skuMatch = normalizedQuery.match(SKU_PATTERN);
  if (skuMatch) {
    const skuProduct = await getProductBySKU(skuMatch[0]);
    if (skuProduct && skuProduct.is_visible) {
      return { products: [skuProduct], detectedColor };
    }
  }

  // 2. Run ALL search sources in parallel — local catalog, BC keyword, category, and colorway index
  const keywordsForLocal = keywords.join(" ");
  const keywordQuery = keywords.slice(0, 6).join(" ");

  const [localMatches, bcKeywordResults, categoryResults, colorwayResults] = await Promise.all([
    searchLocalCatalog(keywordsForLocal, 10).catch(() => [] as LocalMatch[]),
    searchProductsBC(keywordQuery).catch(() => [] as BCProduct[]),
    searchByCategory(keywords).catch(() => [] as BCProduct[]),
    detectedColor
      ? searchByColorway(detectedColor, keywords).catch(() => [] as BCProduct[])
      : Promise.resolve([] as BCProduct[]),
  ]);

  const deduped = new Map<number, BCProduct>();
  function addProducts(products: BCProduct[]) {
    for (const p of products) {
      if (p.is_visible && !deduped.has(p.id)) {
        deduped.set(p.id, p);
      }
    }
  }

  // Colorway index results are highest priority for color+type queries
  addProducts(colorwayResults);

  // Category results are the most relevant for type-based queries like "street helmets"
  addProducts(categoryResults);

  // BC keyword results search descriptions, so they catch category terms too
  addProducts(bcKeywordResults);

  // Enrich local catalog matches with full BC data
  if (localMatches.length > 0) {
    const enrichPromises = localMatches
      .slice(0, 12)
      .map((m) => enrichLocalMatch(m));
    const enriched = await Promise.all(enrichPromises);
    const localProducts = enriched.filter(
      (p): p is BCProduct => p !== null && p.is_visible
    );
    addProducts(localProducts);

    // If enrichment failed for all, add raw local catalog entries
    if (localProducts.length === 0 && deduped.size === 0) {
      const fallback: BCProduct[] = localMatches.slice(0, 10).map((m, idx) => ({
        id: -(idx + 1),
        name: m.name,
        sku: "",
        price: m.price ? parseFloat(m.price) : 0,
        sale_price: 0,
        retail_price: 0,
        calculated_price: m.price ? parseFloat(m.price) : 0,
        description: "",
        is_visible: true,
        availability: "available" as const,
        inventory_level: -1,
        inventory_tracking: "none" as const,
        categories: [],
        brand_id: 0,
        variants: [],
        images: [],
        custom_url: { url: m.url || "", is_customized: false },
      }));
      const results = applyColor(fallback);
      return { products: results, detectedColor };
    }
  }

  let results = Array.from(deduped.values());

  // If still too few results, retry with the full natural-language query
  if (results.length < 3 && keywordQuery !== normalizedQuery) {
    const rawResults = await searchProductsBC(normalizedQuery).catch(() => []);
    addProducts(rawResults);
    results = Array.from(deduped.values());
  }

  const productType = extractProductType(normalizedQuery);

  // Apply type filtering FIRST so we know how many relevant products we have
  results = filterByProductType(results, productType);

  // Fallback: if we detected a product type but have few results after filtering,
  // do a use-case-aware search (e.g., "touring helmets" → search "modular helmet", "touring helmet")
  if (results.length < 3 && productType) {
    const useCase = extractUseCase(normalizedQuery);
    const useCaseTerms = useCase
      ? USE_CASE_SEARCH_TERMS[productType]?.[useCase]
      : null;

    const fallbackQueries: string[] = useCaseTerms
      ? [...useCaseTerms]
      : [PRODUCT_TYPE_MAP[productType][0] + "s"];

    const fallbackSearches = fallbackQueries.flatMap((q) => [
      searchProductsBC(q).catch(() => [] as BCProduct[]),
      searchByCategory(q.split(" ")).catch(() => [] as BCProduct[]),
    ]);

    const fallbackResults = await Promise.all(fallbackSearches);
    for (const batch of fallbackResults) addProducts(batch);
    results = filterByProductType(Array.from(deduped.values()), productType);
  }
  results = rankByRelevance(results, keywords);
  results = preferInStock(results);

  results = applyColor(results);

  return { products: results, detectedColor };
}

export function extractSKUFromText(text: string): string | null {
  const match = text.match(SKU_PATTERN);
  return match ? match[0] : null;
}
