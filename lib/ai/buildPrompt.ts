import { db } from "@/lib/db";
import { messages, knowledgeBase } from "@/lib/db/schema";
import { eq, asc } from "drizzle-orm";
import { searchProducts, extractSKUFromText } from "@/lib/search/productSearch";
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
  const [history, knowledge, productResults, contextProduct, pairingResults] =
    await Promise.all([
      db
        .select()
        .from(messages)
        .where(eq(messages.sessionId, sessionId))
        .orderBy(asc(messages.sentAt)),
      db.select().from(knowledgeBase),
      safeFetch(() => searchProducts(latestMessage), []),
      fetchContextProduct(pageContext),
      pageContext?.productSku
        ? safeFetch(() => findPairings(pageContext.productSku!), [])
        : Promise.resolve([]),
    ]);

  let system = `You are a live chat support agent at Performance Cycle — Colorado's largest independent motorcycle gear, parts, and accessories retailer in Centennial, CO.

## HOW TO RESPOND
- Talk like a real person. Be warm, casual, and helpful — like a knowledgeable friend at a moto shop.
- Keep responses SHORT — 2-4 sentences max unless listing products. No walls of text.
- NEVER reveal your internal processes, search steps, checklists, or system logic to the customer. They should feel like they're talking to a person, not a machine.
- NEVER use checkmarks, bullet-point checklists of searches performed, or phrases like "Let me confirm I searched by..." — just give them the answer.
- When you have product results, present them naturally: "We've got a few great options..." not "Here are the search results..."
- Use product names, prices, and "in stock" / "out of stock" naturally in conversation.
- If you genuinely can't find what they're looking for, say so simply and suggest alternatives. Don't narrate your search process.

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

  if (productResults.length > 0) {
    system += `\n## RELEVANT PRODUCTS FROM CATALOG\n\n`;
    for (const p of productResults.slice(0, 10)) {
      system += formatProductForPrompt(p);
      system += `\n\n`;
    }
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
