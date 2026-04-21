import { db } from "@/lib/db";
import { messages, knowledgeBase } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";
import { searchProducts, extractSKUFromText, extractKeywords, productHasColor, getMatchingColorLabels } from "@/lib/search/productSearch";
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

  if (productResults.length > 0) {
    system += `\n## RELEVANT PRODUCTS FROM CATALOG\n\n`;
    for (const p of productResults.slice(0, 10)) {
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
