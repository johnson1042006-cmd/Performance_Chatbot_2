import { db } from "@/lib/db";
import { messages, knowledgeBase } from "@/lib/db/schema";
import { eq, asc } from "drizzle-orm";
import { searchProducts } from "@/lib/search/productSearch";
import { findPairings } from "@/lib/search/pairingSearch";
import { AI_BEHAVIOR_RULES } from "./rules";
import type { Message } from "@/lib/db/schema";

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

export async function buildPrompt(
  sessionId: string,
  latestMessage: string,
  pageContext?: PageContext | null
): Promise<PromptResult> {
  const [history, knowledge, productResults, pairingResults] =
    await Promise.all([
      db
        .select()
        .from(messages)
        .where(eq(messages.sessionId, sessionId))
        .orderBy(asc(messages.sentAt)),
      db.select().from(knowledgeBase),
      searchProducts(latestMessage),
      pageContext?.productSku
        ? findPairings(pageContext.productSku)
        : Promise.resolve([]),
    ]);

  let system = `You are the Performance Cycle live chat assistant. Performance Cycle is a motorcycle gear, parts, and accessories retailer. You help customers find products, answer questions about inventory, returns, service, and provide expert advice on motorcycle gear.

Be friendly, knowledgeable, and concise. Use a conversational tone. Format product details clearly.

## CRITICAL BEHAVIOR RULES

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

  if (knowledge.length > 0) {
    system += `\n## KNOWLEDGE BASE\n\n`;
    for (const entry of knowledge) {
      system += `### ${entry.topic.replace(/_/g, " ").toUpperCase()}\n${entry.content}\n\n`;
    }
  }

  if (productResults.length > 0) {
    system += `\n## RELEVANT PRODUCTS FROM CATALOG\n\n`;
    for (const p of productResults.slice(0, 10)) {
      system += `- **${p.name}** (SKU: ${p.sku}) — $${p.price}\n`;
      system += `  Category: ${p.category} | Stock: ${p.stockQty} | Colors: ${(p.colorTags || []).join(", ") || "N/A"}\n`;
      if (p.description)
        system += `  ${p.description.substring(0, 200)}${p.description.length > 200 ? "..." : ""}\n`;
      system += `\n`;
    }
  }

  if (pairingResults.length > 0) {
    system += `\n## PRODUCT PAIRINGS\n\n`;
    for (const pr of pairingResults) {
      if (pr.product) {
        system += `- **${pr.product.name}** (SKU: ${pr.product.sku}) — $${pr.product.price} [${pr.pairing.pairingType.replace(/_/g, " ")}]\n`;
      }
    }
    system += `\n`;
  }

  const conversationMessages: { role: "user" | "assistant"; content: string }[] =
    history
      .filter((m: Message) => m.role !== "customer" || m.content !== latestMessage)
      .map((m: Message) => ({
        role: m.role === "customer" ? ("user" as const) : ("assistant" as const),
        content: m.content,
      }));

  conversationMessages.push({ role: "user", content: latestMessage });

  return { system, conversationMessages };
}
