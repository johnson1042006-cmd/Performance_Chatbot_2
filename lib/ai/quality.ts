/**
 * Phase 3 quality heuristics. Pure functions — no I/O — so they can be
 * computed inline at AI message insert time and unit-tested without
 * mocking the database or Anthropic SDK.
 *
 * - `assessConfidence(aiText)` examines the AI's response for hedging
 *   language and returns a coarse confidence label.
 * - `assessSentiment(recentCustomerMessages)` looks at the last few
 *   customer messages for frustration / appreciation markers.
 *
 * Both heuristics are deliberately conservative — false positives on
 * "low" / -1 trigger an auto-escalation, so the markers should be ones
 * that very rarely appear in healthy conversations.
 */

export type Confidence = "high" | "medium" | "low";
export type Sentiment = -1 | 0 | 1;

const LOW_CONFIDENCE_PATTERNS: { re: RegExp; reason: string }[] = [
  { re: /\bI don'?t have\b/i, reason: "phrase: I don't have" },
  { re: /\bI'?m not sure\b/i, reason: "phrase: I'm not sure" },
  { re: /\bcouldn'?t find\b/i, reason: "phrase: couldn't find" },
  {
    re: /\byou might want to call\b/i,
    reason: "phrase: you might want to call",
  },
];

const MEDIUM_CONFIDENCE_PATTERNS: { re: RegExp; reason: string }[] = [
  { re: /\(based on\)/i, reason: "phrase: (based on)" },
  { re: /\bapproximately\b/i, reason: "phrase: approximately" },
];

// A markdown product link is the strongest "we actually have product data"
// signal in the response. When present, `medium` markers fall back to high.
const PRODUCT_DATA_SIGNAL = /\]\(https?:\/\/[^)]*\/products?\//i;

export function assessConfidence(aiText: string): {
  confidence: Confidence;
  reasons: string[];
} {
  const text = aiText || "";
  const lowReasons = LOW_CONFIDENCE_PATTERNS.filter(({ re }) => re.test(text)).map(
    (m) => m.reason
  );
  if (lowReasons.length > 0) {
    return { confidence: "low", reasons: lowReasons };
  }

  const mediumReasons = MEDIUM_CONFIDENCE_PATTERNS.filter(({ re }) =>
    re.test(text)
  ).map((m) => m.reason);
  if (mediumReasons.length > 0 && !PRODUCT_DATA_SIGNAL.test(text)) {
    return { confidence: "medium", reasons: mediumReasons };
  }

  return { confidence: "high", reasons: [] };
}

// Order matters for reasons readability only; matching is independent.
// "ALL CAPS run >=8 chars" matches eight or more uppercase letters in
// sequence, allowing whitespace between words ("WHAT THE HELL" hits 11
// caps). Pure punctuation/numbers between caps don't count.
const FRUSTRATION_PATTERNS: { re: RegExp; reason: string }[] = [
  { re: /!!/, reason: "double exclamation" },
  { re: /[A-Z](?:[\s]*[A-Z]){7,}/, reason: "ALL CAPS run >=8 chars" },
  { re: /\bthis is ridiculous\b/i, reason: "phrase: this is ridiculous" },
  { re: /\btalk to a person\b/i, reason: "phrase: talk to a person" },
  { re: /\b(just stop|stop it|stop wasting|make it stop)\b/i, reason: "phrase: stop" },
  { re: /\buseless\b/i, reason: "phrase: useless" },
  { re: /\bfine[.!]*\s*$|\bfine,? whatever\b|\bfine then\b/i, reason: "phrase: fine" },
  { re: /\bwhere is my order\b/i, reason: "phrase: where is my order" },
  { re: /\bstill haven'?t received\b/i, reason: "phrase: still haven't received" },
  { re: /\bno one is responding\b/i, reason: "phrase: no one is responding" },
  { re: /\bspeak to a manager\b/i, reason: "phrase: speak to a manager" },
  { re: /\bthird time\b/i, reason: "phrase: third time" },
];

// Phase 2a (approved 7/2/2026): DIRECT frustration — the customer explicitly
// saying the bot is failing them. Unlike the ambient markers above, ONE
// direct hit scores -1 immediately (no 2-of-4 threshold): "this isn't
// helping, I just need a real answer" must escalate on the first message.
const DIRECT_FRUSTRATION_PATTERNS: { re: RegExp; reason: string }[] = [
  { re: /\b(isn'?t|is not|not|ain'?t) helping\b/i, reason: "direct: isn't helping" },
  { re: /\b(need|get|want|give me) (a|an) (real|actual|straight|proper|direct) answer\b/i, reason: "direct: need a real answer" },
  { re: /\bnot what I asked\b/i, reason: "direct: not what I asked" },
  { re: /\byou'?re not (listening|understanding|getting it|helping)\b/i, reason: "direct: you're not listening" },
  { re: /\bgetting (us |me )?nowhere\b/i, reason: "direct: getting nowhere" },
];

const POSITIVE_PATTERNS: { re: RegExp; reason: string }[] = [
  { re: /\bthanks\b/i, reason: "phrase: thanks" },
  { re: /\bgreat\b/i, reason: "phrase: great" },
  { re: /\bthat helps\b/i, reason: "phrase: that helps" },
];

function messageHasFrustration(text: string): string[] {
  return FRUSTRATION_PATTERNS.filter(({ re }) => re.test(text)).map((m) => m.reason);
}

function messageHasPositive(text: string): string[] {
  return POSITIVE_PATTERNS.filter(({ re }) => re.test(text)).map((m) => m.reason);
}

/**
 * `recentCustomerMessages` should be in chronological order; we look at the
 * last 4. Score is -1 if ANY of the last 4 carries a DIRECT frustration
 * marker (single message suffices), or if 2 or more of the last 4 have an
 * ambient frustration marker; otherwise +1 if any of them carry a positive
 * marker; otherwise 0.
 */
export function assessSentiment(recentCustomerMessages: string[]): {
  score: Sentiment;
  reasons: string[];
} {
  const last4 = recentCustomerMessages.slice(-4).map((s) => s || "");

  const directHits = last4.flatMap((m) =>
    DIRECT_FRUSTRATION_PATTERNS.filter(({ re }) => re.test(m)).map((p) => p.reason)
  );
  if (directHits.length > 0) {
    return { score: -1, reasons: Array.from(new Set(directHits)) };
  }

  const frustrationHits = last4.map((m) => messageHasFrustration(m));
  const negativeCount = frustrationHits.filter((h) => h.length > 0).length;

  if (negativeCount >= 2) {
    const reasons = frustrationHits
      .map((hits, i) =>
        hits.length > 0 ? `msg[-${last4.length - i}]: ${hits.join(", ")}` : null
      )
      .filter((r): r is string => r !== null);
    return { score: -1, reasons };
  }

  const positiveHits = last4.flatMap((m) => messageHasPositive(m));
  if (positiveHits.length > 0) {
    return { score: 1, reasons: Array.from(new Set(positiveHits)) };
  }

  return { score: 0, reasons: [] };
}
