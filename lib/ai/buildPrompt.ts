import { db } from "@/lib/db";
import { messages, knowledgeBase } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";
import {
  searchProducts,
  extractSKUFromText,
  extractKeywords,
  productHasColor,
  getMatchingColorLabels,
  extractBudget,
  type BudgetInfo,
} from "@/lib/search/productSearch";
import { expandColorQuery } from "@/lib/search/colorSynonyms";
import { findPairings } from "@/lib/search/pairingSearch";
import { AI_BEHAVIOR_RULES } from "./rules";
import type { Message } from "@/lib/db/schema";
import {
  getProductBySKU,
  getProductByName,
  formatProductForPrompt,
  type BCProduct,
} from "@/lib/bigcommerce/client";

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
  pageContext?: PageContext | null
): Promise<PromptResult> {
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

  const effectiveLatest = latestMessage?.trim()
    || customerMessages[customerMessages.length - 1]
    || "";

  // Extract product-relevant keywords from recent history so that multi-turn
  // conversations preserve model names, colorways, and niche terms (e.g. "yagyo")
  // that a hardcoded allowlist would miss.
  const recentHistory = customerMessages.slice(0, -1).slice(-3);
  const historyKeywords = recentHistory.flatMap((msg) => extractKeywords(msg));
  const uniqueHistoryTerms = Array.from(new Set(historyKeywords)).slice(0, 8);
  const searchQuery = [effectiveLatest, ...uniqueHistoryTerms].join(" ").trim();

  const emptySearch = { products: [] as BCProduct[], detectedColor: null as string | null };

  // Run two searches in parallel: the focused query + just the latest message
  // to maximize chances of hitting BigCommerce results.
  const [primarySearch, latestSearch, pairingResults] = await Promise.all([
    safeFetch(() => searchProducts(searchQuery), emptySearch),
    searchQuery !== effectiveLatest
      ? safeFetch(() => searchProducts(effectiveLatest), emptySearch)
      : Promise.resolve(emptySearch),
    pageContext?.productSku
      ? safeFetch(() => findPairings(pageContext.productSku!), [])
      : Promise.resolve([] as Awaited<ReturnType<typeof findPairings>>),
  ]);

  const detectedColor = primarySearch.detectedColor ?? latestSearch.detectedColor;

  const seen = new Set(primarySearch.products.map((p) => p.id));
  const productResults: BCProduct[] = [...primarySearch.products];
  for (const p of latestSearch.products) {
    if (!seen.has(p.id)) {
      seen.add(p.id);
      productResults.push(p);
    }
  }

  // Detect a stated budget in the latest message (e.g. "under $300",
  // "around $400", "$200-$500"). Null when no budget signal is present.
  const budget = extractBudget(effectiveLatest);

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

  let system = `You are a live chat support agent at Performance Cycle — Colorado's largest independent motorcycle gear, parts, and accessories retailer in Centennial, CO.

## HOW TO RESPOND
- Talk like a real person. Be warm, casual, and helpful — like a knowledgeable friend at a moto shop.
- Keep responses SHORT. No walls of text. Get to the point fast.
- NEVER say "let me check", "give me a sec", "let me pull up", or any variation. You already have the data — just present it.
- NEVER reveal internal processes, search steps, or system logic. Just give the answer.
- PRODUCTS FIRST: If you have matching products in the RELEVANT PRODUCTS section below, LEAD with them. Show names, prices, and stock status right away. Add a brief 1-sentence comment after if helpful — not before.
- When mentioning a product, format it as a clickable markdown link: [**Product Name**](url) — $price
- Products tagged [IN STORE ONLY] are available at the physical store but not purchasable online. Present them positively — "We carry that! It's available in our Centennial store." and link to the product page so the customer can see details.
- ONLY ask a qualifying question if the request is truly vague (e.g. "I need gear" with zero specifics). Once the customer has stated a product type, use case, OR budget, you have enough — show products immediately.
- NEVER ask more than 1 question before showing results. If you have products that match, show them AND ask a refinement question in the same message if needed.
- STORE CATALOG AWARENESS: You have a full STORE CATALOG in the knowledge base listing every category, subcategory, brand, and browse URL. Use it to guide customers — especially for broad questions like "what do you carry?" or "do you have tires?" Link them to the relevant category page (e.g. [Street Helmets](https://performancecycle.com/helmets/street/)) alongside specific products when helpful.
- MULTI-TURN REFINEMENTS: When a customer narrows their choice (e.g. "offroad only", "the cheaper one", "in black"), consider ALL products you've already discussed — not just products with that exact word in the name. For example, MX products are offroad products, sport products work for track, touring products work for long rides. Use your product knowledge, not just literal name matching.
- MATCH PRODUCTS TO USE CASE: When the customer has stated a riding style, bike type, or use case, ONLY recommend products that genuinely fit. Do NOT show touring tires to a track rider, or dual-sport tires for a supersport bike. If the available products don't match the stated need, say so honestly and suggest they contact the shop for specific fitment.
- NEVER GUESS SIZES OR FITMENT: Do NOT guess, assume, or recommend specific tire sizes, wheel dimensions, part fitment numbers, or compatibility with specific bike models unless that info is explicitly in the product data you have. Instead, ask the customer what size or fitment they need, then recommend the right product type/model. Our catalog lists tire models but not individual sizes — recommend by model and let the customer confirm sizing on the product page.
- When answering return or exchange questions, ALWAYS include clickable links to the [Returns & Exchanges page](https://performancecycle.com/returns-exchanges/) and the [Return Form](https://performancecycle.com/content/Online%20Return%20Form.pdf).

## BEHAVIOR RULES

${AI_BEHAVIOR_RULES.map((r, i) => `${i + 1}. ${r.rule}`).join("\n\n")}
`;

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

  if (detectedColor) {
    system += `\n## COLOR PREFERENCE DETECTED\n`;
    system += `The customer wants products in **${detectedColor.toUpperCase()}**.

TAGS IN THE RELEVANT PRODUCTS SECTION:
- [COLOR MATCH: ${detectedColor.toUpperCase()}] — this product IS available in ${detectedColor}. The exact matching variant labels are listed on a line starting with "${detectedColor.toUpperCase()} VARIANTS:". You MUST treat this as factual truth.
- [OTHER COLORS ONLY] — this product does NOT come in ${detectedColor}.

ABSOLUTE RULES (violating these breaks the customer's trust):
- If a product is tagged [COLOR MATCH: ${detectedColor.toUpperCase()}], NEVER say it doesn't come in ${detectedColor}. Cite the "${detectedColor.toUpperCase()} VARIANTS:" line when presenting it.
- LEAD with [COLOR MATCH] products. Only mention [OTHER COLORS ONLY] products if zero color matches exist.
- If NO products are tagged [COLOR MATCH], say so honestly and list what colors ARE available from the products shown.\n`;
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

  if (contextProduct) {
    system += `\n## CURRENT PRODUCT (from page context — FULL DETAILS)\n\n`;
    system += formatProductForPrompt(contextProduct);
    system += `\n\nYou have complete data for this product. Use it to answer questions about stock, sizing, colors, price, and compatibility.\n`;
  }

  if (knowledge.length > 0) {
    system += `\n## KNOWLEDGE BASE\n\n`;
    for (const entry of knowledge) {
      system += `### ${entry.topic.replace(/_/g, " ").toUpperCase()}\n${entry.content}\n\n`;
    }
  }

  const expandedColorSet = detectedColor
    ? new Set(expandColorQuery(detectedColor).map((c) => c.toLowerCase()))
    : null;

  function renderProductEntry(p: BCProduct): string {
    const tags: string[] = [];
    let matchingLabels: string[] = [];
    if (detectedColor && expandedColorSet) {
      const isMatch = productHasColor(p, expandedColorSet);
      if (isMatch) {
        matchingLabels = getMatchingColorLabels(p, expandedColorSet);
        tags.push(`[COLOR MATCH: ${detectedColor.toUpperCase()}]`);
      } else {
        tags.push(`[OTHER COLORS ONLY]`);
      }
    }
    if (detectedFeatures.length > 0) {
      for (const f of detectedFeatures) {
        if (productMentionsFeature(p, f)) {
          tags.push(`[${f.toUpperCase()} MATCH]`);
        }
      }
    }
    if (p.availability === "disabled") {
      tags.push(`[IN STORE ONLY]`);
    } else {
      const noTracking = p.inventory_tracking === "none";
      const inStock = noTracking || p.inventory_level > 0;
      tags.push(inStock ? `[IN STOCK]` : `[OUT OF STOCK]`);
    }
    let out = tags.join(" ") + " " + formatProductForPrompt(p);
    if (detectedColor && matchingLabels.length > 0) {
      out += `\n  ${detectedColor.toUpperCase()} VARIANTS: ${matchingLabels.join(", ")}`;
    }
    return out;
  }

  if (displayProducts.length > 0) {
    system += `\n## RELEVANT PRODUCTS FROM CATALOG\n\n`;
    for (const p of displayProducts) {
      system += renderProductEntry(p) + `\n\n`;
    }
  } else {
    system += `\n## NO PRODUCTS FOUND FOR THIS QUERY\n`;
    system += `The product search returned no results for this message. This does NOT mean the store doesn't carry the item — it may just mean the search terms didn't match. DO NOT tell the customer to call the store or visit in person. Instead, ask them to be more specific (brand, product type, size, etc.) so you can search again. Performance Cycle carries over 5,000 products across helmets, jackets, boots, gloves, tires, parts, accessories, and more. CHECK THE STORE CATALOG in the knowledge base above — it lists every category and brand we carry. Use it to suggest relevant category browse links and confirm whether we likely stock what the customer is looking for.\n`;
  }

  if (pairingResults.length > 0) {
    system += `\n## PRODUCT PAIRINGS (recommended accessories/companions)\n\n`;
    for (const pr of pairingResults) {
      if (pr.product) {
        system += `- ${formatProductForPrompt(pr.product)} [${pr.pairing.pairingType.replace(/_/g, " ")}]\n\n`;
      }
    }
  }

  const conversationMessages: { role: "user" | "assistant"; content: string }[] =
    history
      .filter((m: Message) => m.role !== "customer" || m.content !== latestMessage)
      .map((m: Message) => ({
        role: m.role === "customer" ? ("user" as const) : ("assistant" as const),
        content: m.content,
      }));

  conversationMessages.push({ role: "user", content: latestMessage });

  const inlineSKU = extractSKUFromText(latestMessage);
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
