/**
 * Phase 3 Anthropic tool catalog. Exports an Anthropic-format `Tool[]` plus
 * a matching `toolHandlers` map keyed by tool name. Handlers wrap the
 * existing search / catalog / order infrastructure so the tool-use loop in
 * `lib/ai/callClaude.ts` stays I/O-light and easy to test.
 *
 * IMPORTANT: tools are only ever surfaced to the model when
 * `process.env.USE_AI_TOOLS === "true"`. The non-tool path stays byte-for-byte
 * identical to today.
 */

import type Anthropic from "@anthropic-ai/sdk";
import { db } from "@/lib/db";
import { sessions } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getPusher } from "@/lib/pusher/server";
import { DASHBOARD_CHANNEL } from "@/lib/pusher/channels";
import { searchProducts } from "@/lib/search/productSearch";
import {
  getProductBySKU,
  getProductById,
  formatProductForPrompt,
  type BCProduct,
  type BCVariant,
} from "@/lib/bigcommerce/client";
import { lookupOrder } from "@/lib/orders/lookup";
import { sendEscalationPush } from "@/lib/push/send";
import { log, serializeError } from "@/lib/log";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ToolCtx {
  sessionId: string;
  requestId?: string;
}

export type ToolHandler = (
  input: Record<string, unknown>,
  ctx: ToolCtx
) => Promise<unknown>;

// ---------------------------------------------------------------------------
// Tool input/output helpers
// ---------------------------------------------------------------------------

interface CompactProduct {
  name: string;
  sku: string;
  price: number;
  stock: string;
  url: string | null;
  description: string;
}

function productUrl(p: BCProduct): string | null {
  return p.custom_url?.url
    ? `https://performancecycle.com${p.custom_url.url}`
    : null;
}

function stockLabel(p: BCProduct): string {
  if (p.inventory_tracking === "none") return "in stock";
  if (p.inventory_level <= 0) return "out of stock";
  if (p.inventory_level <= 5) return `low stock (${p.inventory_level} left)`;
  return `in stock (${p.inventory_level})`;
}

function compactProduct(p: BCProduct): CompactProduct {
  const price = p.sale_price || p.calculated_price || p.price;
  const desc = (p.description || "")
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return {
    name: p.name,
    sku: p.sku,
    price,
    stock: stockLabel(p),
    url: productUrl(p),
    description: desc.slice(0, 240),
  };
}

function asNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v.replace(/[^0-9.\-]/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function asStr(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

function asBool(v: unknown): boolean {
  return v === true || v === "true" || v === 1 || v === "1";
}

function variantHasColor(variant: BCVariant, color: string): boolean {
  const lower = color.toLowerCase();
  return variant.option_values.some(
    (o) =>
      o.label.toLowerCase().includes(lower) ||
      o.option_display_name.toLowerCase().includes(lower)
  );
}

// ---------------------------------------------------------------------------
// `get_product_by_variant_sku` — variant SKU resolver
// ---------------------------------------------------------------------------
//
// Customer pastes a variant SKU from an invoice (e.g. "0101155-XL"); BC's
// product page exposes the parent SKU only. Strategy:
//   1. Hit BC's `/v3/catalog/variants?sku=…` (returns the variant row with
//      its `product_id`), then `getProductById` to load the parent.
//   2. Fall back to paginating `/v3/catalog/products?include=variants` and
//      matching variants on miss (rate-limited by BC; capped at a few pages).

async function fetchVariantBySku(sku: string): Promise<{ product_id: number } | null> {
  const url = new URL(
    `https://api.bigcommerce.com/stores/${process.env.BIGCOMMERCE_STORE_HASH}/v3/catalog/variants`
  );
  url.searchParams.set("sku", sku);
  url.searchParams.set("limit", "1");
  try {
    const res = await fetch(url.toString(), {
      headers: {
        "X-Auth-Token": process.env.BIGCOMMERCE_ACCESS_TOKEN!,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      next: { revalidate: 60 },
    });
    if (!res.ok) return null;
    const json = await res.json();
    const data = Array.isArray(json?.data) ? json.data : [];
    if (data.length === 0) return null;
    const row = data[0] as { product_id?: number };
    return row.product_id ? { product_id: row.product_id } : null;
  } catch {
    return null;
  }
}

async function paginateForVariantSku(
  sku: string,
  maxPages = 3
): Promise<BCProduct | null> {
  const target = sku.trim().toLowerCase();
  for (let page = 1; page <= maxPages; page++) {
    const url = new URL(
      `https://api.bigcommerce.com/stores/${process.env.BIGCOMMERCE_STORE_HASH}/v3/catalog/products`
    );
    url.searchParams.set("include", "variants,images");
    url.searchParams.set("limit", "250");
    url.searchParams.set("page", String(page));
    try {
      const res = await fetch(url.toString(), {
        headers: {
          "X-Auth-Token": process.env.BIGCOMMERCE_ACCESS_TOKEN!,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        next: { revalidate: 60 },
      });
      if (!res.ok) return null;
      const json = await res.json();
      const list = Array.isArray(json?.data) ? (json.data as BCProduct[]) : [];
      if (list.length === 0) return null;
      const hit = list.find((p) =>
        (p.variants || []).some((v) => v.sku?.trim().toLowerCase() === target)
      );
      if (hit) return hit;
      if (list.length < 250) return null;
    } catch {
      return null;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Static knowledge URLs
// ---------------------------------------------------------------------------

const HELMET_SIZING_URL = "https://performancecycle.com/helmet-sizing-guide/";
const TIRE_SERVICES_URL = "https://performancecycle.com/tire-and-wheel-services/";

// ---------------------------------------------------------------------------
// Escalation
// ---------------------------------------------------------------------------

const ESCALATION_REASONS = [
  "complex_fitment",
  "frustrated_customer",
  "explicit_request",
  "policy_exception",
  "tech_air_service",
  "unsupported",
] as const;

type EscalationReason = (typeof ESCALATION_REASONS)[number];

const ESCALATION_URGENCIES = ["normal", "high"] as const;
type EscalationUrgency = (typeof ESCALATION_URGENCIES)[number];

/**
 * Clears the AI claim deadline, fires the dashboard `escalation-requested`
 * Pusher event, and returns a short confirmation string. The caller (route
 * layer) is responsible for any session-channel events (e.g. request-contact)
 * needed for the email-capture form.
 */
export async function escalateToHuman(
  sessionId: string,
  reason: EscalationReason,
  urgency: EscalationUrgency = "normal"
): Promise<string> {
  await db
    .update(sessions)
    .set({ aiClaimDueAt: null })
    .where(eq(sessions.id, sessionId));

  try {
    await getPusher().trigger(DASHBOARD_CHANNEL, "escalation-requested", {
      sessionId,
      reason,
      urgency,
    });
  } catch (err) {
    log.warn("ai.tools.escalation_pusher_failed", {
      sessionId,
      error: serializeError(err),
    });
  }

  // Web Push: reach agents on their device even when no dashboard tab is open.
  // Best-effort and self-contained — never throws into the escalation flow.
  try {
    await sendEscalationPush({ sessionId, reason, urgency });
  } catch (err) {
    log.warn("ai.tools.escalation_push_failed", {
      sessionId,
      error: serializeError(err),
    });
  }

  if (reason === "tech_air_service") {
    return "Connecting you with a Tech-Air specialist on our team — they'll be with you shortly.";
  }
  if (reason === "frustrated_customer") {
    return "Connecting you to a teammate now. Sorry for the trouble.";
  }
  return "Connecting you to a teammate now — they'll have full context.";
}

// ---------------------------------------------------------------------------
// Tool catalog (Anthropic-format)
// ---------------------------------------------------------------------------

export const tools: Anthropic.Tool[] = [
  {
    name: "search_products",
    description:
      "Search the Performance Cycle catalog. Use BEFORE naming any product not on the " +
      "current page or already in conversation history. CRITICAL: when the customer mentions " +
      "a specific product by name (e.g. 'badlands pro', 'corsair x', 'supertech m10'), " +
      "pass ONLY those distinctive name tokens as the query — do NOT add words from earlier " +
      "in the conversation (brand, product type, use case). Adding context words to a " +
      "specific-product query degrades name matching. Use the productType filter separately " +
      "if you need to scope. Optional filters narrow results by product type (helmet, jacket, " +
      "boots, gloves, suit, airbag, exhaust, etc.), maximum budget, color, and in-stock-only.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Free-text search query — what the customer is looking for.",
        },
        productType: {
          type: "string",
          description: "Optional product type to bias the result list (helmet, jacket, gloves, boots, suit, airbag, exhaust, …).",
        },
        budgetMax: {
          type: "number",
          description: "Optional maximum price (USD). Filters out products above this price.",
        },
        color: {
          type: "string",
          description: "Optional color filter (e.g. 'matte black', 'red'). Re-ranks colorway matches.",
        },
        inStockOnly: {
          type: "boolean",
          description: "When true, drop products that are out of stock at the master level.",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "get_product_details",
    description:
      "Get the full details for a product (price, stock, all variants) by its parent product SKU. Call BEFORE quoting price, stock, or variant info to the customer.",
    input_schema: {
      type: "object",
      properties: {
        sku: { type: "string", description: "Parent product SKU." },
      },
      required: ["sku"],
    },
  },
  {
    name: "get_product_by_variant_sku",
    description:
      "Resolve a variant-level SKU (e.g. one a customer copies from an invoice) to its parent product. Use when get_product_details returned nothing for a SKU.",
    input_schema: {
      type: "object",
      properties: {
        variantSku: { type: "string", description: "Variant SKU as printed on the invoice or label." },
      },
      required: ["variantSku"],
    },
  },
  {
    name: "lookup_order",
    description:
      "Look up an order by customer email + order number. Returns the order status, total, items shipped, and any tracking links.",
    input_schema: {
      type: "object",
      properties: {
        email: { type: "string", description: "Customer email address used at checkout." },
        orderId: { type: "number", description: "Numeric order id." },
      },
      required: ["email", "orderId"],
    },
  },
  {
    name: "lookup_helmet_sizing",
    description:
      "Return the canonical helmet sizing guide URL. Use whenever a customer asks how a helmet fits or what size to buy.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "lookup_tire_services",
    description:
      "Return the tire and wheel services page URL. Use whenever a customer asks about tire mounting, balancing, or related shop services.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "escalate_to_human",
    description:
      "Hand the conversation off to a human teammate. Use for VIN-level fitment, suspension setup, custom service work, frustrated customers, or any Tech-Air service question.",
    input_schema: {
      type: "object",
      properties: {
        reason: {
          type: "string",
          enum: [...ESCALATION_REASONS],
          description: "Why we're escalating.",
        },
        urgency: {
          type: "string",
          enum: [...ESCALATION_URGENCIES],
          description: "Routing urgency. Defaults to 'normal'.",
        },
      },
      required: ["reason"],
    },
  },
];

// ---------------------------------------------------------------------------
// Tool handlers
// ---------------------------------------------------------------------------

export const toolHandlers: Record<string, ToolHandler> = {
  async search_products(input) {
    const query = asStr(input.query) || "";
    const productType = asStr(input.productType);
    const budgetMax = asNum(input.budgetMax);
    const color = asStr(input.color);
    const inStockOnly = asBool(input.inStockOnly);

    const composedQuery = [color, productType, query]
      .filter((s): s is string => !!s)
      .join(" ")
      .trim();

    const { products } = await searchProducts(composedQuery || query);

    let filtered = products;
    if (productType) {
      const lt = productType.toLowerCase();
      filtered = filtered.filter(
        (p) =>
          p.name.toLowerCase().includes(lt) ||
          (p.description || "").toLowerCase().includes(lt)
      );
      if (filtered.length === 0) filtered = products;
    }
    if (budgetMax !== null) {
      filtered = filtered.filter((p) => {
        const price = p.sale_price || p.calculated_price || p.price;
        return price > 0 && price <= budgetMax;
      });
    }
    if (color) {
      const lc = color.toLowerCase();
      filtered = filtered
        .map((p) => {
          const matchedVariant = (p.variants || []).some((v) => variantHasColor(v, lc));
          const nameMatch = p.name.toLowerCase().includes(lc);
          return { p, score: (matchedVariant ? 2 : 0) + (nameMatch ? 1 : 0) };
        })
        .sort((a, b) => b.score - a.score)
        .map((r) => r.p);
    }
    if (inStockOnly) {
      filtered = filtered.filter(
        (p) => p.inventory_tracking === "none" || p.inventory_level > 0
      );
    }

    return {
      count: Math.min(filtered.length, 8),
      products: filtered.slice(0, 8).map(compactProduct),
    };
  },

  async get_product_details(input) {
    const sku = asStr(input.sku);
    if (!sku) return { error: "sku is required" };
    const product = await getProductBySKU(sku);
    if (!product) return { found: false };
    return {
      found: true,
      product: compactProduct(product),
      formatted: formatProductForPrompt(product),
      variants: (product.variants || []).map((v) => ({
        sku: v.sku,
        inventory_level: v.inventory_level,
        price: v.price ?? v.sale_price ?? null,
        options: v.option_values.map((o) => `${o.option_display_name}: ${o.label}`),
      })),
    };
  },

  async get_product_by_variant_sku(input) {
    const variantSku = asStr(input.variantSku);
    if (!variantSku) return { error: "variantSku is required" };

    const direct = await fetchVariantBySku(variantSku);
    let product: BCProduct | null = null;
    if (direct?.product_id) {
      product = await getProductById(direct.product_id);
    }
    if (!product) {
      product = await paginateForVariantSku(variantSku);
    }
    if (!product) return { found: false };

    const matchedVariant = (product.variants || []).find(
      (v) => v.sku?.trim().toLowerCase() === variantSku.trim().toLowerCase()
    );
    return {
      found: true,
      product: compactProduct(product),
      matchedVariant: matchedVariant
        ? {
            sku: matchedVariant.sku,
            inventory_level: matchedVariant.inventory_level,
            options: matchedVariant.option_values.map(
              (o) => `${o.option_display_name}: ${o.label}`
            ),
          }
        : null,
    };
  },

  async lookup_order(input) {
    const email = asStr(input.email);
    const orderId = asNum(input.orderId);
    if (!email || !orderId) return { error: "email and orderId are required" };
    const result = await lookupOrder(email, orderId);
    if (!result.found || !result.order) return { found: false };
    return {
      found: true,
      summary: result.summary,
      order: {
        id: result.order.id,
        status: result.order.status,
        statusId: result.order.status_id,
        itemsShipped: result.order.items_shipped,
        itemsTotal: result.order.items_total,
      },
    };
  },

  async lookup_helmet_sizing() {
    return {
      url: HELMET_SIZING_URL,
      note: "Reply with a markdown link to this URL and ask the customer for their head measurement (cm) so we can confirm the right size.",
    };
  },

  async lookup_tire_services() {
    return {
      url: TIRE_SERVICES_URL,
      note: "Reply with a markdown link to this URL and offer to pass the request to the service team if they want a quote.",
    };
  },

  async escalate_to_human(input, ctx) {
    const rawReason = asStr(input.reason);
    const reason = (ESCALATION_REASONS as readonly string[]).includes(rawReason || "")
      ? (rawReason as EscalationReason)
      : "unsupported";
    const rawUrgency = asStr(input.urgency);
    const urgency = (ESCALATION_URGENCIES as readonly string[]).includes(rawUrgency || "")
      ? (rawUrgency as EscalationUrgency)
      : "normal";
    const message = await escalateToHuman(ctx.sessionId, reason, urgency);
    return { ok: true, reason, urgency, message };
  },
};
