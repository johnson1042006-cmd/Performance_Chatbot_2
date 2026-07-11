import { db } from "@/lib/db";
import { messages, knowledgeBase } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";
import {
  searchProducts,
  extractSKUFromText,
  extractKeywords,
  extractBudget,
  extractProductType,
  extractDiscussedProductSubject,
  extractSubcategoryRequest,
  isLikelyProductFollowUp,
  isSupportedProductType,
  productHasColor,
  getMatchingColorLabels,
  type BudgetInfo,
  type SubcategoryValue,
  type SupportedProductType,
} from "@/lib/search/productSearch";
import { expandColorQuery } from "@/lib/search/colorSynonyms";
import { AI_BEHAVIOR_RULES } from "./rules";
import { PRODUCT_TAXONOMY } from "./taxonomy";
import type { Message } from "@/lib/db/schema";
import {
  getProductBySKU,
  getProductByName,
  getProductByNameLike,
  formatProductForPrompt,
  type BCProduct,
} from "@/lib/bigcommerce/client";

// Cap how much history is sent to Claude each turn: the first messages preserve
// the original ask, the last messages keep recent context. Long sessions
// otherwise grow slower and costlier every turn.
const HISTORY_HEAD = 2;
const HISTORY_TAIL = 16;

// Known brands in the catalog. Order doesn't matter — this is just for
// extracting a brand name from a product title so we can diversify results.
// Multi-word brands MUST come before single-word ones they share a token with
// (e.g. "Fox Racing" before "Fox", "Rev'It" before "Rev").
const KNOWN_BRANDS: string[] = [
  "Alpinestars", "Shoei", "Arai", "Schuberth", "Sidi", "Klim",
  "Rev'It", "RevIt", "Rev It",
  "Fox Racing", "Fox",
  "Bell", "Scorpion", "Gaerne", "Dainese", "AGV", "Nolan", "HJC",
  "Icon", "LS2", "Simpson", "Shark", "O'Neal", "Oneal", "Leatt",
  "6D", "Troy Lee Designs", "TLD", "Answer", "Thor", "Fly Racing", "Fly",
  "Michelin", "Dunlop", "Pirelli", "Metzeler", "Bridgestone", "Shinko",
  "Continental", "Kenda", "Maxxis", "IRC",
  "Bilt", "Highway 21", "Z1R", "Tourmaster", "Tour Master", "Noru",
  "Sedici", "Gmax", "GMAX", "Cortech", "Joe Rocket", "Speed and Strength",
  "Oxford", "SW-Motech", "Givi", "Shad", "Kriega",
  "EVS", "Leatt Brace", "Atlas", "Fly", "FXR", "509", "100%",
];

function brandOf(name: string): string {
  const lower = name.toLowerCase();
  for (const b of KNOWN_BRANDS) {
    const bl = b.toLowerCase();
    // Match as a word boundary at the start of the name, or as a standalone
    // token elsewhere. We want "Bell MX-9" -> "Bell", not "Campbell..." -> "Bell".
    const re = new RegExp(`(^|[^a-z0-9])${bl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^a-z0-9])`, "i");
    if (re.test(lower)) return b;
  }
  return name.split(/\s+/)[0] || "Unknown";
}

/**
 * Cap products by brand so the top-N isn't dominated by one brand. Walks the
 * already-ranked list in order (preserving in-stock / color-match / premium
 * signals) and skips products that would exceed the per-brand cap.
 *
 * Two-tier fallback: if cap=2 leaves fewer than minFloor products, retry at
 * cap=3. If that's still too few, pass the original list through untouched.
 */
function capByBrand(
  products: BCProduct[],
  limit: number,
  minFloor = 5
): BCProduct[] {
  if (products.length <= limit) return products.slice(0, limit);

  const attempt = (perBrandCap: number): BCProduct[] => {
    const counts = new Map<string, number>();
    const out: BCProduct[] = [];
    for (const p of products) {
      if (out.length >= limit) break;
      const b = brandOf(p.name);
      const c = counts.get(b) || 0;
      if (c >= perBrandCap) continue;
      counts.set(b, c + 1);
      out.push(p);
    }
    return out;
  };

  const strict = attempt(2);
  if (strict.length >= Math.min(minFloor, products.length)) return strict;

  const relaxed = attempt(3);
  if (relaxed.length >= Math.min(minFloor, products.length)) return relaxed;

  return products.slice(0, limit);
}

// Feature keywords customers commonly ask about. When one is detected in the
// query, we scan each product's name AND description to tag the ones that
// genuinely have the feature, then float them to the top. Starts narrow on
// purpose; easy to extend when new feature queries surface.
const FEATURE_KEYWORDS: Array<{ canonical: string; patterns: RegExp[] }> = [
  { canonical: "MIPS", patterns: [/\bmips\b/i] },
  {
    canonical: "waterproof",
    patterns: [
      /\bwater[-\s]?proof\b/i,
      /\bh2o\b/i,
      /\bgore[-\s]?tex\b/i,
      /\bdrystar\b/i,
    ],
  },
  { canonical: "heated", patterns: [/\bheated\b/i] },
  {
    canonical: "Bluetooth",
    patterns: [/\bbluetooth\b/i, /\bcomm(?:unication)?\s+system\b/i],
  },
  {
    canonical: "airbag",
    patterns: [/\bairbag\b/i, /\btech[-\s]?air\b/i],
  },
  {
    canonical: "ventilated",
    patterns: [/\bvented\b/i, /\bventilated\b/i, /\bmesh\b/i],
  },
  { canonical: "D3O", patterns: [/\bd3o\b/i] },
  { canonical: "carbon fiber", patterns: [/\bcarbon\s?fiber\b/i] },
];

function detectFeatures(query: string): string[] {
  if (!query) return [];
  const out: string[] = [];
  for (const f of FEATURE_KEYWORDS) {
    if (f.patterns.some((p) => p.test(query))) out.push(f.canonical);
  }
  return out;
}

function productMentionsFeature(p: BCProduct, featureCanonical: string): boolean {
  const entry = FEATURE_KEYWORDS.find((f) => f.canonical === featureCanonical);
  if (!entry) return false;
  const haystack = `${p.name} ${(p.description || "").replace(/<[^>]+>/g, " ")}`;
  return entry.patterns.some((re) => re.test(haystack));
}

function countFeatureMatches(p: BCProduct, features: string[]): number {
  let n = 0;
  for (const f of features) if (productMentionsFeature(p, f)) n++;
  return n;
}

function productPriceNum(p: BCProduct): number {
  const candidates = [p.calculated_price, p.sale_price, p.price];
  for (const c of candidates) {
    if (typeof c === "number" && c > 0) return c;
  }
  return Number.POSITIVE_INFINITY;
}

/**
 * Partition products into in-budget and over-budget based on a parsed budget.
 * Returns [...inBudget, ...overBudget] so budget items are prioritized while
 * over-budget items remain as fallback (Option B: sort, don't filter).
 */
function sortByBudget(products: BCProduct[], budget: BudgetInfo): BCProduct[] {
  if (!budget.max) return products;
  const inBudget: BCProduct[] = [];
  const overBudget: BCProduct[] = [];
  for (const p of products) {
    if (productPriceNum(p) <= budget.max) inBudget.push(p);
    else overBudget.push(p);
  }
  return [...inBudget, ...overBudget];
}

interface PageContext {
  url?: string;
  pageType?: string;
  productName?: string | null;
  productSku?: string | null;
  categoryName?: string | null;
  searchQuery?: string | null;
}

interface PromptResult {
  system: string;
  conversationMessages: { role: "user" | "assistant"; content: string }[];
}

/**
 * Phase 3: when `USE_AI_TOOLS=true` the model is given a tool catalog and is
 * expected to call `search_products` itself instead of receiving a pre-rendered
 * RELEVANT PRODUCTS dump. We compute the env flag once here so callers and
 * tests can stub `process.env.USE_AI_TOOLS` and re-import.
 */
function aiToolsEnabled(): boolean {
  return process.env.USE_AI_TOOLS === "true";
}

const TOOL_MODE_INSTRUCTIONS = `\n## TOOLS

You have a tool catalog you MUST use. The proactive "RELEVANT PRODUCTS FROM CATALOG" section is REPLACED by these tools — call them yourself when you need product data.

- \`search_products({ query, productType?, budgetMax?, color?, inStockOnly? })\` — search the catalog. Always call BEFORE naming any product not on the current page or in conversation history.
- \`get_product_details({ sku })\` — full product info including variants. Always call BEFORE stating stock, price, or variant info.
- \`get_product_by_variant_sku({ variantSku })\` — resolve a customer-pasted variant SKU (e.g. from an invoice) to its parent product.
- \`lookup_order({ email, orderId })\` — order status, tracking, and items shipped. Use whenever the customer asks about an order they placed.
- \`lookup_helmet_sizing()\` — canonical helmet sizing-guide URL. Use whenever a customer asks how a helmet fits.
- \`lookup_tire_services()\` — tire and wheel services URL. Use for tire mounting/balancing questions.
- \`escalate_to_human({ reason, urgency })\` — hand the conversation to a human teammate.

Always call search_products before naming any product not on the current page or in conversation history. Always call get_product_details before stating stock/price/variant info.
- SPECIFIC PRODUCT NAME QUERIES: When the customer asks about a particular product/variant/colorway by name (e.g. 'do you have the Yagyo colorway', 'is the Badlands Pro in stock', 'show me the Corsair X'), call search_products with ONLY the distinctive name tokens — do NOT include brand, product type, or context words from earlier turns. Examples: (1) Customer asks 'do you have the yagyo' after discussing Shoei RF-1400 → call search_products({ query: 'yagyo' }). NOT 'Shoei RF-1400 Yagyo' or 'Yagyo colorway helmet'. (2) Customer asks 'is the badlands pro available' after discussing Klim adventure jackets → call search_products({ query: 'badlands pro' }). NOT 'Klim Badlands Pro adventure jacket'. (3) Customer asks 'show me the M10 Deegan' after browsing helmets → call search_products({ query: 'M10 Deegan' }). NOT 'Alpinestars Supertech M10 Deegan helmet'. If the first search returns no results, retry once with even shorter tokens (just the model name, no brand). The catalog has fuzzy substring matching — shorter queries usually work better for specific products.
- WHEN A CUSTOMER NAMES A SPECIFIC PRODUCT: always call search_products first. Never say "I'm not finding X" or "we don't carry X" or "that's not showing up" based on prior turns or memory. You MUST run a fresh search_products call with the product name as the query before making any claim about availability. If search_products returns it: present it with price, stock, and a link. If search_products genuinely returns nothing matching: say "I searched and couldn't find that exact model — here's what we have that's close:" and show the top results. NEVER skip the search call when a customer names a product. Example: customer says "you dont have the m10 deegan helmet?" — call search_products({query: "m10 deegan helmet"}) BEFORE responding. If the result contains "Alpinestars Supertech M10 Deegan Monster Helmet", present that product. Do not say "I'm not finding it" when search returned it.
- Call escalate_to_human({reason: 'complex_fitment'}) for ANY question about what specific part fits a specific bike — sprocket counts, chain length, tire sizes for a year/make/model, jet sizes, brake pad fitment, suspension setup, VIN-level lookups. "What X fits my [year] [brand] [model]" is ALWAYS complex_fitment. Verbal "our service team is best equipped" guidance ALONE is insufficient — the tool call is what fires the dashboard alert so the two on-call agents actually see the question. NEVER answer a fitment question without invoking the tool first.
- Tech-Air SHOPPING questions ('show me tech-air airbags', 'do you have tech-air 5') are NOT service — treat as a normal airbag product query per the airbag_categorization rule. Tech-Air SERVICE questions (recharging, deployed unit, recertification, warranty repair): always include the link https://performancecycle.com/tech-air-service/ in your response — do NOT omit it or reconstruct it.
- WHEN SEARCH RETURNS ZERO RESULTS: after the one retry with shorter tokens, if you still have nothing, you MUST NOT name, describe, or link any product from memory — your training data is not our catalog. Say honestly: "I searched and couldn't find that exact item in our catalog right now." Then do ONE of: (a) run a broader search_products call for the parent category and present what we DO carry, (b) point to the category browse page if the STORE CATALOG section confirms we carry that brand/category, or (c) if neither works, offer the in-chat handoff ("a teammate can dig deeper — want me to flag them?") and call escalate_to_human if they say yes. Zero results NEVER justifies inventing a product, price, or availability claim.\n`;

async function safeFetch<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    console.error("Non-fatal fetch error in buildPrompt:", error);
    return fallback;
  }
}

async function fetchContextProduct(
  pageContext?: PageContext | null
): Promise<BCProduct | null> {
  if (!pageContext) return null;

  if (pageContext.productSku) {
    const product = await safeFetch(() => getProductBySKU(pageContext.productSku!), null);
    if (product) return product;
  }

  if (pageContext.productName) {
    const products = await safeFetch(() => getProductByName(pageContext.productName!), []);
    if (products.length > 0) return products[0];
  }

  return null;
}

export async function buildPrompt(
  sessionId: string,
  latestMessage: string,
  pageContext?: PageContext | null,
  latestMessageRaw?: string,
  agentsOnline?: boolean,
  routingDirective?: string | null
): Promise<PromptResult> {
  // Caller passes the un-redacted current-turn message as `latestMessageRaw`
  // so the model can answer about PII in this turn (e.g. "your card 4111…")
  // even though the persisted history is redacted. Falls back to the redacted
  // version when no raw text is provided (e.g. AI auto-claim sweeps).
  const effectiveRaw = latestMessageRaw ?? latestMessage;
  const [recentRows, knowledge, contextProduct] =
    await Promise.all([
      db
        .select()
        .from(messages)
        .where(eq(messages.sessionId, sessionId))
        .orderBy(desc(messages.sentAt))
        .limit(50),
      db.select().from(knowledgeBase),
      fetchContextProduct(pageContext),
    ]);

  const history = recentRows.reverse();

  const customerMessages = history
    .filter((m: Message) => m.role === "customer")
    .map((m: Message) => m.content);

  const effectiveLatest = effectiveRaw?.trim()
    || customerMessages[customerMessages.length - 1]
    || "";

  // Extract product-relevant keywords from recent history so that multi-turn
  // FOLLOW-UPS preserve model names, colorways, and niche terms (e.g. "what
  // colors?", "in black?", "is it in stock"). For fresh queries that introduce
  // a new product context (e.g. "show me a blue street helmet" after an
  // unrelated jacket conversation), skip the padding — otherwise old keywords
  // pollute the search and surface unrelated parts/accessories.
  const isFollowUp = isLikelyProductFollowUp(effectiveLatest);
  const recentHistory = isFollowUp
    ? customerMessages.slice(0, -1).slice(-3)
    : [];
  const historyKeywords = recentHistory.flatMap((msg) => extractKeywords(msg));
  const uniqueHistoryTerms = Array.from(new Set(historyKeywords)).slice(0, 8);
  const searchQuery = [effectiveLatest, ...uniqueHistoryTerms].join(" ").trim();

  const emptySearch = { products: [] as BCProduct[], detectedColor: null as string | null };

  const assistantContents = history
    .filter((m: Message) => m.role === "ai" || m.role === "agent")
    .map((m: Message) => m.content);

  async function resolveDiscussedProduct(): Promise<BCProduct | null> {
    const subj = extractDiscussedProductSubject(effectiveLatest, assistantContents);
    if (!subj) return null;
    if (subj.sku) {
      return await safeFetch(() => getProductBySKU(subj.sku!), null);
    }
    if (subj.productName) {
      const candidates = await safeFetch(
        () => getProductByNameLike(subj.productName!, 5),
        [] as BCProduct[]
      );
      return candidates[0] ?? null;
    }
    return null;
  }

  // Run searches in parallel: the focused query + just the latest message
  // to maximize chances of hitting BigCommerce results, plus pairings for the
  // resolved subject SKU.
  const [primarySearch, latestSearch, discussedProduct] =
    await Promise.all([
      safeFetch(() => searchProducts(searchQuery), emptySearch),
      searchQuery !== effectiveLatest
        ? safeFetch(() => searchProducts(effectiveLatest), emptySearch)
        : Promise.resolve(emptySearch),
      resolveDiscussedProduct(),
    ]);

  const seen = new Set(primarySearch.products.map((p) => p.id));
  const productResults: BCProduct[] = [...primarySearch.products];
  for (const p of latestSearch.products) {
    if (!seen.has(p.id)) {
      seen.add(p.id);
      productResults.push(p);
    }
  }

  if (discussedProduct) {
    const idx = productResults.findIndex((p) => p.id === discussedProduct.id);
    if (idx >= 0) {
      productResults.splice(idx, 1);
    }
    productResults.unshift(discussedProduct);
    seen.add(discussedProduct.id);
  }

  // Detect a stated budget in the latest message (e.g. "under $300",
  // "around $400", "$200-$500"). Null when no budget signal is present.
  const budget = extractBudget(effectiveLatest);

  // Color the customer asked for (if any) — used to tag products in the
  // RELEVANT PRODUCTS section as [COLOR MATCH: ...] / [OTHER COLORS ONLY] so
  // the color_strict_recommendations rule has real tags to act on.
  const detectedColor =
    primarySearch.detectedColor ?? latestSearch.detectedColor;
  const expandedColorSet = detectedColor
    ? new Set(expandColorQuery(detectedColor).map((c) => c.toLowerCase()))
    : null;

  // Detect feature keywords (MIPS, waterproof, Bluetooth, etc.) and re-rank so
  // products whose name OR description mention the feature come first. This
  // surfaces feature-matched products whose titles don't contain the feature
  // word (e.g. Fox V3 for MIPS — MIPS is only in the description).
  const detectedFeatures = detectFeatures(effectiveLatest);
  const featureSorted = detectedFeatures.length > 0
    ? [...productResults].sort(
        (a, b) =>
          countFeatureMatches(b, detectedFeatures) -
          countFeatureMatches(a, detectedFeatures)
      )
    : productResults;

  // Precedence: feature match > budget > brand-diversity cap > raw search rank.
  const budgetSorted = budget ? sortByBudget(featureSorted, budget) : featureSorted;
  const displayProducts = capByBrand(budgetSorted, 10);

  // Detect subcategory intent for the latest message so we can render an
  // explicit "STYLE PREFERENCE" block in the prompt. Helmets/jackets/boots/
  // gloves/pants/tires get this treatment; other types pass through.
  const latestType = extractProductType(effectiveLatest);
  const subcategoryProductType: SupportedProductType | null =
    isSupportedProductType(latestType) ? latestType : null;
  const subcategoryRequest = subcategoryProductType
    ? extractSubcategoryRequest(effectiveLatest, subcategoryProductType)
    : null;

  let system = `You are an agent at Performance Cycle — Colorado's largest independent motorcycle gear, parts, and accessories retailer in Centennial, CO. Do not give yourself a personal name. Do not sign your messages with a name. Never say you are an AI unless directly asked, in which case answer honestly.

## HOW TO RESPOND
- Talk like a real person. Be warm, casual, and helpful — like a knowledgeable friend at a moto shop.
- Keep responses SHORT. No walls of text. Get to the point fast.
- NEVER say "let me check", "give me a sec", "let me pull up", or any variation. You already have the data — just present it.
- NEVER reveal internal processes, search steps, or system logic. Just give the answer.
- PRODUCTS FIRST: If you have matching products in the RELEVANT PRODUCTS section below, LEAD with them. Show names, prices, and stock status right away. Add a brief 1-sentence comment after if helpful — not before.
- When mentioning a product, copy the pre-formatted bold linked title VERBATIM from the RELEVANT PRODUCTS section (it's already in [**Name**](url) form) and append " — $price" using the price from that same entry. Do NOT reconstruct the URL from the URL: line — use the pre-built link only.
- Products tagged [IN STORE ONLY] are available at the physical store but not purchasable online. Present them positively — "We carry that! It's available in our Centennial store." and link to the product page so the customer can see details.
- ONLY ask a qualifying question if the request is truly vague (e.g. "I need gear" with zero specifics). Once the customer has stated a product type, use case, OR budget, you have enough — show products immediately.
- NEVER ask more than 1 question before showing results. If you have products that match, show them AND ask a refinement question in the same message if needed.
- STORE CATALOG: A ## STORE CATALOG (current stock) section appears below listing every brand we carry and the product categories/subcategories they cover. Use it to answer "do you carry brand X?" or "what brands do you have for Y?" questions even when the RELEVANT PRODUCTS list is empty. The STORE CATALOG is for structural awareness — never quote product names or URLs from it (use RELEVANT PRODUCTS for that). If a brand or category is NOT listed in the STORE CATALOG, we do not carry it; say so honestly.
- MULTI-TURN REFINEMENTS: When a customer narrows their choice (e.g. "offroad only", "the cheaper one", "in black"), consider ALL products you've already discussed — not just products with that exact word in the name. For example, MX products are offroad products, sport products work for track, touring products work for long rides. Use your product knowledge, not just literal name matching.
- MATCH PRODUCTS TO USE CASE: When the customer has stated a riding style, bike type, or use case, ONLY recommend products that genuinely fit. Do NOT show touring tires to a track rider, or dual-sport tires for a supersport bike. If the available products don't match the stated need, say so honestly and suggest they contact the shop for specific fitment.
- NEVER GUESS SIZES OR FITMENT: Do NOT guess, assume, or recommend specific tire sizes, wheel dimensions, part fitment numbers, or compatibility with specific bike models unless that info is explicitly in the product data you have. Instead, ask the customer what size or fitment they need, then recommend the right product type/model. Our catalog lists tire models but not individual sizes — recommend by model and let the customer confirm sizing on the product page.
- When answering return or exchange questions, ALWAYS include clickable links to the [Returns & Exchanges page](https://performancecycle.com/returns-exchanges/) and the [Return Form](https://performancecycle.com/content/Online%20Return%20Form.pdf).

## BEHAVIOR RULES

${AI_BEHAVIOR_RULES.map((r, i) => `${i + 1}. ${r.rule}`).join("\n\n")}
`;

  // Phase 2b: deterministic dispatch text from the Sonnet routing
  // classification (first turn of a conversation only; null when the
  // classifier is off, fell back, or the category needs no directive).
  if (routingDirective) {
    system += `\n## ROUTING DIRECTIVE\n${routingDirective}\n`;
  }

  if (agentsOnline === true) {
    system += `\n## AGENT AVAILABILITY\n`;
    system += `A human teammate IS currently online. If the customer asks for a person, says they want to talk to a human, or sounds frustrated, you may say things like "let me get a teammate involved" or "a teammate will jump in shortly" — those statements will be true.\n`;
  } else if (agentsOnline === false) {
    system += `\n## AGENT AVAILABILITY\n`;
    system += `No human teammates are online right now. NEVER promise that "a manager will jump in shortly", "our team monitors this chat", "a teammate will be with you", or anything implying a live person is reading along — those statements would be false. Instead, when the customer asks for a person or sounds frustrated, acknowledge it honestly: "Our team is offline right now, but you can leave your email and we'll get back to you as soon as we're back" or "I can take down your contact info and have someone follow up." The widget will surface an email-capture form for them automatically.\n`;
  }

  if (pageContext) {
    system += `\n## CURRENT PAGE CONTEXT\n`;
    system += `The customer is currently on: ${pageContext.url || "unknown page"}\n`;
    system += `Page type: ${pageContext.pageType || "unknown"}\n`;
    if (pageContext.productName)
      system += `Product: ${pageContext.productName}\n`;
    if (pageContext.productSku) system += `SKU: ${pageContext.productSku}\n`;
    if (pageContext.categoryName)
      system += `Category: ${pageContext.categoryName}\n`;
    if (pageContext.searchQuery)
      system += `Search query: ${pageContext.searchQuery}\n`;
    system += `\nWhen the customer says "this" or "it", they are referring to the product/page above.\n`;
  }

  if (budget && budget.max) {
    system += `\n## CUSTOMER BUDGET\n`;
    system += `The customer stated a budget: "${budget.phrase}". Parsed ceiling: $${budget.max}${budget.soft ? " (soft target — this is an 'around' figure, so small stretches are acceptable)" : ""}${budget.min ? ` (range $${budget.min}-$${budget.max})` : ""}.\n`;
    system += `Only LEAD with products at or below this ceiling. Within the RELEVANT PRODUCTS section below, in-budget items are listed FIRST. If nothing in the list fits, say so honestly and list what's closest — do NOT silently present over-budget items as if they fit the budget.\n`;
  }

  if (detectedFeatures.length > 0) {
    const featList = detectedFeatures.join(", ");
    const tagList = detectedFeatures.map((f) => `[${f.toUpperCase()} MATCH]`).join(" / ");
    system += `\n## FEATURE REQUIREMENTS DETECTED\n`;
    system += `The customer asked for: **${featList}**. In the RELEVANT PRODUCTS section below:
- ${tagList} tags indicate the feature is confirmed in the product's name OR description — these are SAFE to recommend and you can state the feature as fact.
- Products WITHOUT a matching feature tag are in the list as context only — do NOT claim they have ${featList} if they aren't tagged.
- LEAD with tagged products. Include multiple brands when tagged products span brands (e.g. if Bell, Fox, and Icon all have [MIPS MATCH], recommend across all three — do not stack multiple models from one brand).
- If NO products in the list carry the ${featList} tag, say so honestly ("I don't see anything with ${featList} in that category right now — want me to pull up [closest alternative]?").\n`;
  }

  if (detectedColor && !aiToolsEnabled()) {
    system += `\n## COLOR REQUEST DETECTED\n`;
    system += `The customer asked for **${detectedColor}**. In the RELEVANT PRODUCTS section below:
- \`[COLOR MATCH: ...]\` tags list the matching colorway variant names confirmed in that product's data — these are SAFE to recommend for the color request; mention the specific variant name.
- \`[OTHER COLORS ONLY]\` means the product exists but no ${detectedColor} variant was found — only mention these if there are zero color matches, and say clearly which colors they DO come in (from their Variants list).
- NEVER claim a product comes in ${detectedColor} unless it carries a [COLOR MATCH] tag or its Variants list explicitly shows that color.\n`;
  }

  if (subcategoryProductType) {
    const TYPE_LABEL: Record<SupportedProductType, string> = {
      helmet: "helmet",
      jacket: "jacket",
      boots: "pair of boots",
      gloves: "pair of gloves",
      pants: "pair of pants",
      tire: "tire",
    };
    const STREET_LABEL: Record<SupportedProductType, string> = {
      helmet: "full-face / street",
      jacket: "street / road",
      boots: "street / road",
      gloves: "street / road",
      pants: "street / road",
      tire: "sport-touring / street",
    };
    const typeLabel = TYPE_LABEL[subcategoryProductType];
    const streetLabel = STREET_LABEL[subcategoryProductType];
    system += `\n## STYLE PREFERENCE\n`;
    if (subcategoryRequest && subcategoryRequest.explicit) {
      system += `The customer asked specifically for **${subcategoryRequest.value.replace(/_/g, " ")}** ${typeLabel}s. ONLY lead with products tagged \`[STYLE: ${subcategoryRequest.value}]\` in the RELEVANT PRODUCTS section. If no products carry that tag, say so honestly and SHOW the closest alternatives from the list with their prices and links — you may add ONE clarifying question after the products, but never reply with only a question and no products.\n`;
    } else if (subcategoryRequest && !subcategoryRequest.explicit) {
      system += `The customer asked to see all ${typeLabel}s. Show a mix across styles using the \`[STYLE: ...]\` tags in the RELEVANT PRODUCTS section.\n`;
    } else {
      system += `The customer asked about ${typeLabel}s without specifying a style. DEFAULT to **${streetLabel}** products. The \`[STYLE: ...]\` tags in the RELEVANT PRODUCTS section come from the BigCommerce category tree and are authoritative — never lead with off-road / MX / dirt / adventure / open-face / half / modular / cruiser-only products unless the customer explicitly asks. If the only products available are off-style, say so honestly rather than presenting them as a default.\n`;
    }
  }

  if (contextProduct) {
    system += `\n## CURRENT PRODUCT (from page context — FULL DETAILS)\n\n`;
    system += formatProductForPrompt(contextProduct);
    system += `\n\nYou have complete data for this product. Use it to answer questions about stock, sizing, colors, price, and compatibility.\n`;
  }

  if (
    discussedProduct &&
    (!contextProduct || discussedProduct.id !== contextProduct.id)
  ) {
    system += `\n## PRODUCT CUSTOMER IS FOLLOWING UP ON (FULL DETAILS)\n\n`;
    system += formatProductForPrompt(discussedProduct);
    system += `\n\nThe customer's latest message is a follow-up about THIS product (resolved from their question and/or the most recent product you showed in **bold**). Use the Variants list and per-variant stock lines above as the only source of truth for sizes and inventory — never invent sizes or stock states. If RELEVANT PRODUCTS below also includes this SKU, treat this section as authoritative for follow-up questions.\n`;
  }

  system += `\n## PRODUCT TAXONOMY\n\n${PRODUCT_TAXONOMY}\n`;

  const catalogIndex = knowledge.find((k) => k.topic === "store_catalog_index");
  if (catalogIndex?.content) {
    system += `\n## STORE CATALOG (current stock)\n${catalogIndex.content}\n`;
    system += `\nUse this catalog to answer "do you carry brand X?" / "what brands do you have for Y?" questions even when search returns nothing. NEVER claim a brand is unavailable unless it does not appear in this catalog. When recommending specific products, the RELEVANT PRODUCTS section below is authoritative for names, prices, and URLs — this catalog block is for structural awareness only, not for naming products.\n`;
  }

  if (knowledge.length > 0) {
    system += `\n## KNOWLEDGE BASE\n\n`;
    for (const entry of knowledge) {
      if (entry.topic === "store_catalog_index") continue;
      system += `### ${entry.topic.replace(/_/g, " ").toUpperCase()}\n${entry.content}\n\n`;
    }
  }

  function renderProductEntry(p: BCProduct): string {
    const tags: string[] = [];
    if (detectedFeatures.length > 0) {
      for (const f of detectedFeatures) {
        if (productMentionsFeature(p, f)) {
          tags.push(`[${f.toUpperCase()} MATCH]`);
        }
      }
    }
    if (expandedColorSet) {
      if (productHasColor(p, expandedColorSet)) {
        const labels = getMatchingColorLabels(p, expandedColorSet);
        tags.push(
          labels.length > 0
            ? `[COLOR MATCH: ${labels.join(", ")}]`
            : `[COLOR MATCH]`
        );
      } else {
        tags.push(`[OTHER COLORS ONLY]`);
      }
    }
    if (p.availability === "disabled") {
      tags.push(`[IN STORE ONLY]`);
    } else {
      const noTracking = p.inventory_tracking === "none";
      const inStock = noTracking || p.inventory_level > 0;
      tags.push(inStock ? `[IN STOCK]` : `[OUT OF STOCK]`);
    }
    const sub = (p as BCProduct & { _subcategory?: SubcategoryValue | null })._subcategory;
    if (sub) {
      tags.push(`[STYLE: ${sub}]`);
    }
    return tags.join(" ") + " " + formatProductForPrompt(p);
  }

  if (aiToolsEnabled()) {
    // Tool mode: skip the proactive RELEVANT PRODUCTS dump and append a
    // tool-use directive section instead. The model calls search_products /
    // get_product_details / etc. on demand. Page-context-product, follow-up
    // product block, knowledge base, and taxonomy still appear above.
    system += TOOL_MODE_INSTRUCTIONS;
  } else if (displayProducts.length > 0) {
    system += `\n## RELEVANT PRODUCTS FROM CATALOG\n\n`;
    for (const p of displayProducts) {
      system += renderProductEntry(p) + `\n\n`;
    }
  } else {
    system += `\n## RELEVANT PRODUCTS FROM CATALOG\n\n`;
    system += `(no matching products found — be honest with the customer that you don't have a great match in your current results)\n`;
  }


  // Only drop the LAST message if it duplicates latestMessage. The previous
  // implementation removed every matching customer message, which broke
  // multi-turn context whenever a short reply ("yes", "ok", "in black") was
  // repeated.
  const last = history[history.length - 1];
  const historyToUse =
    last && last.role === "customer" && last.content === latestMessage
      ? history.slice(0, -1)
      : history;

  // Cap depth: keep the first HISTORY_HEAD messages (the original ask) plus the
  // last HISTORY_TAIL (recent context), deduplicated, in chronological order.
  const cappedHistory =
    historyToUse.length <= HISTORY_HEAD + HISTORY_TAIL
      ? historyToUse
      : (() => {
          const head = historyToUse.slice(0, HISTORY_HEAD);
          const tail = historyToUse.slice(-HISTORY_TAIL);
          const seen = new Set(head.map((m: Message) => m.id));
          const merged = [...head];
          for (const m of tail) {
            if (!seen.has(m.id)) {
              merged.push(m);
              seen.add(m.id);
            }
          }
          return merged;
        })();

  const conversationMessages: { role: "user" | "assistant"; content: string }[] =
    cappedHistory.map((m: Message) => ({
      role: m.role === "customer" ? ("user" as const) : ("assistant" as const),
      content: m.content,
    }));

  // Guard against empty latestMessage so we never send empty user content
  // to the Anthropic API (it 400s). Push the RAW current-turn text so the
  // model sees PII (e.g. card numbers) in this single response cycle even
  // though the persisted DB content is redacted.
  const trimmedLatest = (effectiveRaw || "").trim();
  if (trimmedLatest.length > 0) {
    conversationMessages.push({ role: "user", content: effectiveRaw });
  } else if (
    conversationMessages.length === 0 ||
    conversationMessages[conversationMessages.length - 1].role !== "user"
  ) {
    conversationMessages.push({ role: "user", content: "(no message)" });
  }

  const inlineSKU = extractSKUFromText(effectiveRaw);
  if (inlineSKU && (!contextProduct || contextProduct.sku !== inlineSKU)) {
    const inlineProduct = await safeFetch(() => getProductBySKU(inlineSKU), null);
    if (inlineProduct) {
      system += `\n## PRODUCT MENTIONED IN MESSAGE (SKU: ${inlineSKU})\n\n`;
      system += formatProductForPrompt(inlineProduct);
      system += `\n`;
    }
  }

  return { system, conversationMessages };
}
