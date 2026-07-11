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
  /\bwant (me to|to know|to see|more|(the |any )?(details|specs|info))\b/i,
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
 * Punt-sentence detector — Jacob's core complaint verbatim: "it should
 * connect them to us rather than just telling them to call." Prompt rules
 * (no_call_store) demonstrably don't stop the model from punting, so this
 * is a deterministic escalation trigger. Enforcement is full handoff-copy
 * replacement of the visible reply once the escalation pauses (see runAi),
 * same principle as rewriteStoreHours.
 *
 * A SENTENCE is a punt when it contains:
 *  (1) a redirect marker — the store phone number, "call the team/store",
 *      or the contact form; AND
 *  (2) either an in-sentence deflection cue (the bot deferring the check:
 *      "suggest you call", "they can confirm", "to ask if…") OR the
 *      customer's question was an availability/product question ("do you
 *      have X?") — where a phone redirect IS the punt regardless of how
 *      politely it's phrased (live-test miss, 7/2/2026: "I can also suggest
 *      you call the shop … or check our Parts section" admits nothing).
 * Hours/contact-info answers stay safe: their phone sentence has no
 * deflection cue and hours questions aren't availability questions.
 *
 * A detection miss is cushioned by the other escalation triggers
 * (low-confidence + no-data, frustration, explicit request, tool-initiated);
 * a false positive replaces a healthy reply with the handoff copy AND
 * pauses the session, so the safety pins in the tests matter more than
 * the coverage pins.
 */
const PUNT_REDIRECT_RE =
  /303[\s.\-]?744[\s.\-]?2011|\bcall(ing)? (the )?(team|store|shop|us|them)\b|\bgive (us|them|the (team|shop|store)) a (call|ring)\b|\bcontact form\b/i;
const PUNT_DEFLECTION_RE =
  /\b(suggest(s|ing)? (that )?(you )?call|recommend (you )?(call|calling|giving)|to ask (if|whether|directly|about)|ask (them |us )?directly|they('ll| will| can| could) (confirm|check|tell|help|give|answer|share|provide|walk you|talk you|go over|run (you )?through|fill you in|look into|sort|set you up|get back|point you)|can walk you through|get back to you|check with|to (confirm|check) (if|whether|what|availability|stock)|or check (our|the)|for (current )?(stock|availability|pricing)|(may|might) be able to|not finding|can'?t confirm|couldn'?t find|don'?t have|don'?t carry)\b/i;

/**
 * Self-serve page redirect — the third punt shape (live-test miss,
 * 7/3/2026): "You can see the full specs including top speed on the
 * product page: [link]". A page-redirect sentence is a punt ONLY when the
 * reply as a whole admits a data gap (REPLY_ADMITS_GAP_RE) or the customer
 * asked an availability question — otherwise the very common healthy
 * pattern "here's the answer, and here's the product page for more" would
 * escalate + pause on false positives.
 *
 * Accepted tradeoff (Antonio, 7/3/2026): an unhedged COLD page-redirect
 * punt — "Check the product page for top speed" with no admission anywhere
 * in the reply — still slips through. In every observed live punt the model
 * admits the gap, so the admission gate is the right side of the tradeoff.
 */
const PAGE_REDIRECT_RE =
  /\b(you can|you'?ll) (see|find|view|read|check( out)?)\b[^.!?]*\b(product page|listing|on (our|the) (web)?site)\b/i;
const REPLY_ADMITS_GAP_RE =
  /\b(cut off|truncated|incomplete|not (showing|loading|seeing)|can'?t (see|pull up|access|find)|couldn'?t find|don'?t have|isn'?t (showing|loading|coming up)|not coming (up|through))\b/i;
/** "do you have/carry X?"-style questions. Hours/location questions are
 *  excluded — "do you have weekend hours?" is not an availability question. */
const AVAILABILITY_QUESTION_RE =
  /\b(do you (guys )?(have|carry|stock|sell)|got any|have any|carry any|in stock|availability|is (this|that|it) available)\b/i;
const HOURS_LOCATION_RE =
  /\b(hours?|open|closed?|closing|location|address|directions?)\b/i;

/** no_search_narration enforcement — sentences that reveal the retrieval
 *  process ("That search didn't return helmets — it grabbed race gear") or
 *  the bot's internal data view ("the product description I'm seeing is
 *  cut off", live-test miss 7/3/2026). */
const NARRATION_RE =
  /\b(the |that |my |our )?(catalog )?search( results?)? (didn'?t|did not|returned|picked up|grabbed|pulled( up)?|found|came back|is(n'?t)? (pulling|finding|returning|picking)|leans?)\b|\bmy (current )?results\b|\bthe results (are pulling|came back|show)\b|\bwhat came up in (the|my) search\b|\b(description|listing|product (data|info)|details?|specs?) (I'?m|I am|we'?re) (seeing|getting|pulling)\b|\b(description|listing|details?|specs?)[^.!?]{0,40}\b(is|are|looks?) (cut off|truncated|incomplete)\b/i;

function customerAskedAvailability(latestMessage: string | null | undefined): boolean {
  if (!latestMessage) return false;
  return (
    AVAILABILITY_QUESTION_RE.test(latestMessage) &&
    !HOURS_LOCATION_RE.test(latestMessage)
  );
}

function splitIntoSentences(line: string): string[] {
  return line.split(/(?<=[.!?])\s+/);
}

/**
 * Escalation-trigger view of the classification: any punt sentence in the
 * reply means the bot deflected instead of connecting.
 *
 * Structural fix (Antonio, 7/3/2026): punt sentences are DETECTED but no
 * longer individually removed. Once escalation pauses the session, runAi
 * replaces the ENTIRE visible reply with the deterministic handoff copy —
 * same principle as the hours guard. So a pattern miss here costs one
 * redundant trigger layer, not a phone number in a customer-visible reply.
 */
export function detectPuntSentences(
  reply: string,
  latestCustomerMessage: string | null | undefined
): string[] {
  const availability = customerAskedAvailability(latestCustomerMessage);
  const replyAdmitsGap = REPLY_ADMITS_GAP_RE.test(reply);
  const puntSentences: string[] = [];
  for (const line of reply.split("\n")) {
    for (const sentence of splitIntoSentences(line)) {
      const isPhonePunt =
        PUNT_REDIRECT_RE.test(sentence) &&
        (PUNT_DEFLECTION_RE.test(sentence) || availability);
      const isPagePunt =
        PAGE_REDIRECT_RE.test(sentence) && (replyAdmitsGap || availability);
      if (isPhonePunt || isPagePunt) puntSentences.push(sentence);
    }
  }
  return puntSentences;
}

export interface NarrationScrubResult {
  /** Reply with narration sentences removed. May be "" when the whole reply
   *  was narration — runAi treats that as a punt-equivalent no_data trigger,
   *  so the handoff copy replaces it. */
  cleaned: string;
  narrationSentences: string[];
}

/**
 * no_search_narration enforcement for NON-pausing replies. Unlike punt
 * phrasing (unbounded), narration is a bounded vocabulary — the sentence
 * must reference the retrieval process itself — so sentence-level removal
 * stays maintainable here. Pausing replies never reach the customer at all
 * (full handoff-copy replacement), so this only guards replies the bot is
 * allowed to keep talking through.
 */
export function scrubNarration(reply: string): NarrationScrubResult {
  const narrationSentences: string[] = [];
  const outLines = reply.split("\n").map((line) =>
    splitIntoSentences(line)
      .filter((sentence) => {
        if (NARRATION_RE.test(sentence)) {
          narrationSentences.push(sentence);
          return false;
        }
        return true;
      })
      .join(" ")
  );

  const cleaned = outLines
    .join("\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { cleaned, narrationSentences };
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

/** Everything the pause verdict depends on — deliberately WITHOUT
 *  priorAiOffer, see escalationWillPause. */
export interface PausePredicateSignals {
  sentimentScore: number;
  confidence: string;
  isExplicitHumanRequest: boolean;
  isTechAirServiceRequest: boolean;
  toolDataOutcome: ToolDataOutcome;
  replyIsPunt: boolean;
  aiEscalatedViaTool: boolean;
}

/**
 * Will this turn's escalation pause the AI? Synchronously computable —
 * `priorAiOffer` (the one async signal) only toggles the reason label
 * between no_data and undeliverable_offer, both of which pause, so the
 * verdict is invariant to it. runAi's outbound transform calls this at
 * stream time to decide full handoff-copy replacement, and the escalation
 * block reaches the same verdict through decideEscalationReason +
 * shouldPauseForEscalation — one derivation, no drift.
 */
export function escalationWillPause(s: PausePredicateSignals): boolean {
  const reason = decideEscalationReason({ ...s, priorAiOffer: false });
  return shouldPauseForEscalation(reason, s.aiEscalatedViaTool);
}

/**
 * Fitment preserve fix (Antonio, 7/11/2026 — live production bug): the
 * service_handoff rule REQUIRES the model to share what we carry and then
 * call escalate_to_human(reason='complex_fitment') in the same turn, and the
 * 2b fitment directive reinforces exactly that shape on full year/make/model
 * openers. Full handoff-copy replacement then wiped the rule-mandated
 * product content, leaving only the generic handoff line.
 *
 * Pause reasons whose pausing turn may KEEP the model's reply (with the
 * handoff line appended) when it contains real product recommendations.
 * ONLY complex_fitment qualifies — its reply is valuable by design. Every
 * other pause reason (no_data, undeliverable_offer, explicit_request,
 * frustrated_customer, …) has no good content to preserve and keeps full
 * replacement.
 */
export const PRESERVE_REPLY_PAUSE_REASONS = new Set(["complex_fitment"]);

/**
 * Deterministic "the reply contains real product recommendations" proxy:
 * the base rules require a price with every product recommendation, so a
 * customer-visible $ amount is the reliable marker. The prompt's RELEVANT
 * PRODUCTS section is how product data usually reaches a fitment reply —
 * buildPrompt runs the catalog search BEFORE the model call — so a turn
 * with real products in the reply often has NO data-tool calls at all
 * (observed in the live repro: escalate_to_human was the only tool call).
 */
const PRODUCT_PRICE_RE = /\$\s?\d/;

export function replyContainsProductContent(
  reply: string | null | undefined
): boolean {
  if (!reply) return false;
  return PRODUCT_PRICE_RE.test(reply);
}

export interface PreserveReplySignals {
  /** Validated reason from this turn's successful escalate_to_human tool
   *  call, or null when the tool didn't fire. */
  toolEscalationReason: string | null;
  sentimentScore: number;
  isExplicitHumanRequest: boolean;
  isTechAirServiceRequest: boolean;
  toolDataOutcome: ToolDataOutcome;
}

/**
 * Is this pausing turn ELIGIBLE for reply preservation (handoff line
 * appended) instead of full replacement? True ONLY when the tool's
 * complex_fitment call is the sole cause of the pause:
 *  - no independent pause trigger (frustration, explicit human request,
 *    Tech-Air service) — those customers asked for a person, not products;
 *  - EXCEPT when a data tool ran and explicitly found nothing — then any
 *    price in the reply is fabricated and full replacement stays the safe
 *    default. ("no_tools_ran" is the NORMAL preserve shape: fitment openers
 *    get the catalog search pre-rendered into the prompt, so the model
 *    often answers without any data-tool round.)
 * Bare low confidence WITH retrieved data is notify-only and never pauses
 * on its own, so it cannot be a hidden co-trigger here.
 *
 * Eligibility is only half the decision: the caller must then sanitize the
 * reply (scrubPreservedReply) and verify priced product content SURVIVED
 * the scrub (replyContainsProductContent) — otherwise full replacement.
 */
export function shouldPreserveReplyWithHandoff(
  s: PreserveReplySignals
): boolean {
  if (
    !s.toolEscalationReason ||
    !PRESERVE_REPLY_PAUSE_REASONS.has(s.toolEscalationReason)
  ) {
    return false;
  }
  if (
    s.sentimentScore === -1 ||
    s.isExplicitHumanRequest ||
    s.isTechAirServiceRequest
  ) {
    return false;
  }
  return s.toolDataOutcome !== "no_data";
}

/**
 * Sanitize a reply that is about to be PRESERVED on a complex_fitment
 * pausing turn: remove narration AND individual punt sentences.
 *
 * Rationale: the service_handoff rule's own mandated copy invites a phone
 * fallback ("If you'd rather not wait, you can also call…"), and models
 * phrase it in ways the punt detector flags. On the 7/3 full-replacement
 * paths a punt anywhere kills the whole reply — but on a preserve turn the
 * reply also carries real product content the customer should keep, and a
 * deterministic handoff line is appended AFTER it, so a punt sentence here
 * is a redundant redirect, not a dead end. Sentence-level removal is the
 * right cost/benefit on THIS path only: a pattern miss leaves a phone
 * mention next to real products and an active handoff (low harm), while
 * full replacement re-creates the original bug (products wiped).
 */
export function scrubPreservedReply(
  reply: string,
  latestCustomerMessage: string | null | undefined
): string {
  const punts = new Set(detectPuntSentences(reply, latestCustomerMessage));
  const withoutPunts =
    punts.size === 0
      ? reply
      : reply
          .split("\n")
          .map((line) =>
            splitIntoSentences(line)
              .filter((sentence) => !punts.has(sentence))
              .join(" ")
          )
          .join("\n")
          .replace(/[ \t]+\n/g, "\n")
          .replace(/\n{3,}/g, "\n\n")
          .trim();
  return scrubNarration(withoutPunts).cleaned;
}
