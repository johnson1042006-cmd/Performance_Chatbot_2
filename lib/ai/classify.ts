/**
 * Phase 2b routing/classification layer (Jacob #2).
 *
 * A deterministic classify→dispatch step ahead of generation: Sonnet makes
 * ONLY the first routing decision of a conversation; Haiku still executes
 * every tool call and every customer-facing reply. Each category carries its
 * own dispatch directive — fitment categories require bike year/make/model
 * before specific parts are recommended, which is what closes the
 * "no clarifying questions" gap systematically.
 *
 * Fallback rule (decided 7/9/2026): if the classification comes back
 * low-confidence or the call errors out, classifyRouting returns null and the
 * turn proceeds exactly as if this layer didn't exist (the current Haiku-only
 * path). This failure mode NEVER escalates to a human — escalation stays
 * reserved for the Phase 2a triggers.
 *
 * Gated behind USE_ROUTING_CLASSIFIER=true (same rollout pattern as
 * USE_AI_TOOLS) so production behavior is unchanged until the flag is set.
 */

import Anthropic from "@anthropic-ai/sdk";
import { log, serializeError } from "@/lib/log";

let _client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!_client) {
    _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  }
  return _client;
}

/** Sonnet handles routing only — never customer-facing text. */
const CLASSIFIER_MODEL = () =>
  process.env.ROUTING_CLASSIFIER_MODEL || "claude-sonnet-5";
const CLASSIFIER_MAX_TOKENS = 300;

export function routingClassifierEnabled(): boolean {
  return process.env.USE_ROUTING_CLASSIFIER === "true";
}

/**
 * Sonnet classifies the FIRST AI turn of a conversation only (locked
 * decision 7/6/2026: one routing decision per conversation). Later turns
 * carry the directive's effect through conversation history.
 */
export function shouldClassifyTurn(hasPriorAiMessage: boolean): boolean {
  return routingClassifierEnabled() && !hasPriorAiMessage;
}

export const ROUTING_CATEGORIES = [
  "tire_fitment",
  "parts_fitment",
  "product_browse",
  "order_support",
  "policy_info",
  "human_request",
  "other",
] as const;

export type RoutingCategory = (typeof ROUTING_CATEGORIES)[number];

export const ROUTING_FIELDS = [
  "bike_year",
  "bike_make",
  "bike_model",
  "order_email",
  "order_number",
] as const;

export type RoutingField = (typeof ROUTING_FIELDS)[number];

export interface RoutingClassification {
  category: RoutingCategory;
  confidence: "high" | "medium" | "low";
  /** Required fields for the category that the message does NOT contain. */
  missingFields: RoutingField[];
}

const CLASSIFIER_SYSTEM = `You are a routing classifier for a motorcycle gear shop's support chat. Categorize the customer's FIRST message so the reply agent can be dispatched correctly. Reply ONLY by calling the classify tool.

Categories:
- tire_fitment: tires for a specific motorcycle (fit/size/replacement for a bike).
- parts_fitment: bike-specific mechanical parts — chains, sprockets, brake pads, filters, plastics — where fitment depends on the customer's exact bike.
- product_browse: shopping for gear or products where bike fitment is not required (helmets, jackets, gloves, boots, luggage, oil by spec, electronics, general "do you carry X").
- order_support: an order they placed — status, tracking, returns of a specific order.
- policy_info: store hours, location, services offered, return/exchange policy, general store questions.
- human_request: explicitly asks for a human/agent/person.
- other: greetings, small talk, or anything that fits nothing above.

missing_fields: for tire_fitment/parts_fitment report which of bike_year/bike_make/bike_model the message does NOT state; for order_support report order_email/order_number if absent; otherwise empty.

confidence: high when the category is obvious; medium when plausible but ambiguous; low when you are guessing.`;

const CLASSIFY_TOOL: Anthropic.Tool = {
  name: "classify",
  description: "Report the routing classification for the customer's message.",
  input_schema: {
    type: "object" as const,
    properties: {
      category: { type: "string", enum: [...ROUTING_CATEGORIES] },
      confidence: { type: "string", enum: ["high", "medium", "low"] },
      missing_fields: {
        type: "array",
        items: { type: "string", enum: [...ROUTING_FIELDS] },
      },
    },
    required: ["category", "confidence"],
  },
};

function parseClassification(input: unknown): RoutingClassification | null {
  if (!input || typeof input !== "object") return null;
  const obj = input as Record<string, unknown>;
  const category = obj.category as RoutingCategory;
  const confidence = obj.confidence as RoutingClassification["confidence"];
  if (!ROUTING_CATEGORIES.includes(category)) return null;
  if (!["high", "medium", "low"].includes(confidence)) return null;
  const missingFields = Array.isArray(obj.missing_fields)
    ? (obj.missing_fields.filter((f) =>
        ROUTING_FIELDS.includes(f as RoutingField)
      ) as RoutingField[])
    : [];
  return { category, confidence, missingFields };
}

/**
 * Classify the conversation's opening message. Returns null on ANY failure
 * mode — API error, malformed output, or low confidence — which callers must
 * treat as "run the current Haiku-only path unchanged".
 */
export async function classifyRouting(
  latestMessage: string,
  opts?: { requestId?: string; sessionId?: string }
): Promise<RoutingClassification | null> {
  const trimmed = (latestMessage || "").trim();
  if (!trimmed) {
    // A blank opener means the CALLER lost the customer's message (the
    // sweep path did exactly this, 7/12/2026) — make it visible instead of
    // masquerading as "the classifier ran and chose not to route".
    log.warn("ai.classify.empty_input_skipped", {
      requestId: opts?.requestId,
      sessionId: opts?.sessionId,
    });
    return null;
  }

  let result: RoutingClassification | null = null;
  try {
    const response = await getClient().messages.create({
      model: CLASSIFIER_MODEL(),
      max_tokens: CLASSIFIER_MAX_TOKENS,
      system: CLASSIFIER_SYSTEM,
      tools: [CLASSIFY_TOOL],
      tool_choice: { type: "tool", name: "classify" },
      messages: [{ role: "user", content: trimmed.slice(0, 2000) }],
    });
    const toolUse = response.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
    );
    result = toolUse ? parseClassification(toolUse.input) : null;
    if (!result) {
      log.warn("ai.classify.malformed_output", {
        requestId: opts?.requestId,
        sessionId: opts?.sessionId,
      });
      return null;
    }
  } catch (err) {
    // Locked fallback: classification errors fall back to the Haiku-only
    // path silently — never escalate for this failure mode.
    log.warn("ai.classify.call_failed", {
      requestId: opts?.requestId,
      sessionId: opts?.sessionId,
      error: serializeError(err),
    });
    return null;
  }

  if (result.confidence === "low") {
    log.info("ai.classify.low_confidence_fallback", {
      requestId: opts?.requestId,
      sessionId: opts?.sessionId,
      category: result.category,
    });
    return null;
  }

  log.info("ai.classify.routed", {
    requestId: opts?.requestId,
    sessionId: opts?.sessionId,
    category: result.category,
    confidence: result.confidence,
    missingFields: result.missingFields,
  });
  return result;
}

const FIELD_LABELS: Record<RoutingField, string> = {
  bike_year: "bike year",
  bike_make: "bike make",
  bike_model: "bike model",
  order_email: "the email used on the order",
  order_number: "the order number",
};

/**
 * Deterministic per-category dispatch text appended to the system prompt as
 * a ## ROUTING DIRECTIVE section. Returns null when the category needs no
 * directive (the base prompt already covers it).
 */
export function routingDirective(
  classification: RoutingClassification
): string | null {
  const { category, missingFields } = classification;
  const missing = missingFields.map((f) => FIELD_LABELS[f]);

  switch (category) {
    case "tire_fitment":
    case "parts_fitment": {
      const partLabel =
        category === "tire_fitment" ? "tires" : "bike-specific parts";
      if (missing.length > 0) {
        return `This conversation opened with a ${partLabel} fitment question, and the customer has NOT yet provided: ${missing.join(", ")}. In ONE message, do BOTH: (1) show the relevant options we carry from the RELEVANT PRODUCTS section with prices and links, presented by model — do NOT claim any of them fits the customer's bike yet; and (2) ask ONE friendly question collecting the missing details (year, make, and model together). Never guess sizes or fitment. Once they answer, narrow to what fits and route exact-fit confirmation to the service team.`;
      }
      // Same show-AND-route shape as the missing-fields branch above (the
      // 2b gate fix, 155786d): "route to the service team" alone reads to
      // the model as the WHOLE job and it skips the product recommendations
      // (observed live + in the fitment-preserve gate, 7/11/2026). Both
      // halves must land in one message. Phrased tool-agnostically: in tool
      // mode (USE_AI_TOOLS) there is NO pre-rendered RELEVANT PRODUCTS
      // section — the model must call search_products itself, and on turns
      // where it skipped straight to escalate_to_human it had no product
      // data to show (the gate's 4/6 only-handoff failures).
      return `This conversation opened with a ${partLabel} fitment question and the customer has already stated their bike. In ONE message, do BOTH: (1) SHOW the matching options we carry with prices and links — if product data is not already in front of you, call the search_products tool FIRST to retrieve it; never guess sizes or claim exact fitment for their specific bike; and (2) tell them our service team will jump in right here to confirm exact fitment, following the fitment rules (including the required escalate_to_human tool call with reason='complex_fitment'). Never reply with only a handoff and no products — show what we carry, then hand off.`;
    }
    case "order_support": {
      if (missing.length > 0) {
        return `This conversation is about an existing order, and the customer has NOT yet provided: ${missing.join(", ")}. Ask for the missing details in ONE question so the order can be looked up. Do not speculate about order status without a lookup.`;
      }
      return `This conversation is about an existing order and the customer has provided lookup details. Use them to check the order before answering; do not speculate about status.`;
    }
    case "policy_info":
      return `This conversation opened with a store policy/info question. Answer directly from the KNOWLEDGE BASE sections; do not pivot to product recommendations unless asked.`;
    case "human_request":
      // Phase 2a's explicit-human-request trigger owns this path; no extra
      // prompt directive needed.
      return null;
    case "product_browse":
    case "other":
      return null;
  }
}
