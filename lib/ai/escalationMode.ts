/**
 * Phase 2a escalation mode split — pure decision logic, no I/O.
 *
 * Distinguishes the two escalation modes at runtime:
 *  - mode (a) `no_data`             — the bot has nothing to answer with
 *    (low-confidence reply AND this turn's data tools returned nothing, or
 *    never ran). The 5w40-oil case.
 *  - mode (b) `undeliverable_offer` — same no-data condition, but the bot's
 *    PREVIOUS message offered the information it now can't deliver (the
 *    "stage 2 M2 top speed" case). Detected by a deterministic regex over
 *    the prior AI message — no extra model call.
 *
 * Bare low confidence WITH retrieved data stays `unsupported` and is
 * notify-only (no pause): the confidence heuristic alone is too crude to
 * silence the bot on.
 *
 * Kept free of DB/SDK imports so it can be unit-tested directly and later
 * swapped for the Phase 2b router's category output without touching the
 * suppression machinery.
 */

export type ToolDataOutcome = "got_data" | "no_data" | "no_tools_ran";

/** Tools whose output constitutes "the bot has data to answer with". */
const DATA_TOOLS = new Set([
  "search_products",
  "get_product_details",
  "get_product_by_variant_sku",
  "lookup_order",
]);

interface ToolCallLike {
  name: string;
  output?: unknown;
  isError?: boolean;
}

function toolReturnedData(name: string, output: unknown): boolean {
  if (!output || typeof output !== "object") return false;
  const o = output as Record<string, unknown>;
  if (name === "search_products") {
    return typeof o.count === "number" && o.count > 0;
  }
  return o.found === true;
}

export function assessToolDataOutcome(toolCalls: ToolCallLike[]): ToolDataOutcome {
  const dataCalls = toolCalls.filter((tc) => DATA_TOOLS.has(tc.name));
  if (dataCalls.length === 0) return "no_tools_ran";
  return dataCalls.some((tc) => !tc.isError && toolReturnedData(tc.name, tc.output))
    ? "got_data"
    : "no_data";
}

/**
 * Did an AI message offer to provide information? Deterministic patterns for
 * the "want me to pull up the specs?" family. Conservative on purpose —
 * a missed offer degrades mode (b) to mode (a), which behaves identically
 * for the customer; a false positive only mislabels the dashboard reason.
 */
const AI_OFFER_PATTERNS: RegExp[] = [
  /\bwould you like (to know|to see|me to|more|the|details|specs)\b/i,
  /\bwant (me to|to know|to see|the specs|the details|more info)\b/i,
  /\bdo you want (me to|to know|the|more)\b/i,
  /\bI can (also )?(look up|pull up|get you|share|tell you|find|check)\b/i,
  /\bhappy to (share|pull up|look up|provide|get)\b/i,
  /\binterested in (the )?(specs|details|more)\b/i,
  /\blet me know if you('d| would)? like\b/i,
  /\bjust ask if you\b/i,
];

export function containsOffer(aiText: string | null | undefined): boolean {
  if (!aiText) return false;
  return AI_OFFER_PATTERNS.some((re) => re.test(aiText));
}

/**
 * Reasons that pause the AI (Antonio's aggressiveness decision, 7/2/2026):
 * pause on no_data, undeliverable_offer, explicit_request,
 * frustrated_customer, and anything tool-initiated (complex_fitment,
 * policy_exception, tech_air_service arrive via the tool or server routing).
 * `unsupported` (bare low confidence with data in hand) stays notify-only.
 */
export const PAUSE_REASONS = new Set([
  "no_data",
  "undeliverable_offer",
  "explicit_request",
  "frustrated_customer",
  "tech_air_service",
  "complex_fitment",
  "policy_exception",
]);

/**
 * Passive-punt classifier — Jacob's core complaint verbatim: "it should
 * connect them to us rather than just telling them to call." A reply is a
 * punt only when BOTH fire:
 *  (1) a redirect marker — the store phone number, "call the team/store",
 *      or the contact form; AND
 *  (2) an inability/deferral marker — the bot admitting it can't answer and
 *      deflecting the check to the customer.
 * Requiring both keeps legitimate contact-info answers (store hours replies
 * include the phone number) from false-positiving.
 */
const PUNT_REDIRECT_RE =
  /303[\s.\-]?744[\s.\-]?2011|\bcall(ing)? (the )?(team|store|shop|us|them)\b|\bgive (us|them) a (call|ring)\b|\bcontact form\b/i;
const PUNT_INABILITY_RE =
  /\b(not finding|can'?t confirm|don'?t carry|couldn'?t find|don'?t have|not showing up in my|outside our|ask (them )?directly|to ask (if|whether)|check with|they (may|might) be able|point you in the right direction|get back to you|confirm (if|whether|what))\b/i;

export function replyIsPassivePunt(aiText: string): boolean {
  return PUNT_REDIRECT_RE.test(aiText) && PUNT_INABILITY_RE.test(aiText);
}

export interface EscalationReasonSignals {
  sentimentScore: number;
  confidence: string;
  isExplicitHumanRequest: boolean;
  isTechAirServiceRequest: boolean;
  toolDataOutcome: ToolDataOutcome;
  priorAiOffer: boolean;
  /** Reply classified as a passive punt (see replyIsPassivePunt). */
  replyIsPunt: boolean;
}

export type EscalationDecisionReason =
  | "frustrated_customer"
  | "explicit_request"
  | "tech_air_service"
  | "undeliverable_offer"
  | "no_data"
  | "unsupported";

/** Precedence mirrors the pre-2a derivation; the two new reasons slot in
 *  where "unsupported" used to swallow every low-confidence case. A passive
 *  punt counts as no-data regardless of tool outcome — the bot telling the
 *  customer to call/check themselves IS the admission it couldn't answer,
 *  even when a search returned (irrelevant) hits. */
export function decideEscalationReason(
  s: EscalationReasonSignals
): EscalationDecisionReason {
  if (s.sentimentScore === -1) return "frustrated_customer";
  if (s.isExplicitHumanRequest) return "explicit_request";
  if (s.isTechAirServiceRequest) return "tech_air_service";
  if (
    (s.confidence === "low" && s.toolDataOutcome !== "got_data") ||
    s.replyIsPunt
  ) {
    return s.priorAiOffer ? "undeliverable_offer" : "no_data";
  }
  return "unsupported";
}

export function shouldPauseForEscalation(
  reason: string,
  aiEscalatedViaTool: boolean
): boolean {
  return aiEscalatedViaTool || PAUSE_REASONS.has(reason);
}

/**
 * True when the AI's own reply already reads as an active handoff
 * ("Connecting you to a teammate…"), so appending the canned handoff
 * message would duplicate it.
 */
const HANDOFF_ALREADY_RE =
  /\b(connect(ing)? you|get(ting)? (someone|a teammate|one of our)|team ?(member|mate)? (will|monitors)|service team monitors|specialist on our team|be with you (shortly|in a moment)|hang tight)\b/i;

export function replyAlreadyReadsAsHandoff(aiText: string): boolean {
  return HANDOFF_ALREADY_RE.test(aiText);
}
