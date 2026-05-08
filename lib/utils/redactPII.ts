/**
 * Redact PII from customer-facing text before persisting.
 *
 * Order matters: cards and SSNs are stripped first so that long digit runs
 * can't be eaten by the phone-number pass. The store's own number
 * (303-744-2011) is preserved in any common formatting so the AI can still
 * point customers at it.
 *
 * IMPORTANT: this function is only safe to apply to CUSTOMER messages. Agent
 * and AI messages must never be redacted — agents quote policy text that may
 * legitimately contain digit runs that look like cards/SSNs, and the AI may
 * need to repeat the store phone number verbatim.
 */

const STORE_PHONE_DIGITS = "3037442011";

// Anchored so the trailing separator can't be swallowed (`\d` after
// `[ -]?` ensures the match always ends on a digit). 13–19 digits total.
const CARD_RE = /\b\d(?:[ -]?\d){12,18}\b/g;
const SSN_RE = /\b\d{3}-\d{2}-\d{4}\b/g;
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
// Optional +1 / 1 country prefix, optional area-code parens, single separator
// between groups (space, dot, or dash). Anchored so leading whitespace is
// never consumed (otherwise a replacement would eat the preceding space).
const PHONE_RE = /(?:\+1[\s.\-]?|1[\s.\-])?\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4}\b/g;

export function redactPII(text: string): { redacted: string; hits: string[] } {
  if (typeof text !== "string" || text.length === 0) {
    return { redacted: text ?? "", hits: [] };
  }

  const hits: string[] = [];
  let out = text;

  out = out.replace(CARD_RE, (match) => {
    const digits = match.replace(/[^\d]/g, "");
    if (digits.length < 13 || digits.length > 19) return match;
    hits.push("card");
    return "[CARD]";
  });

  out = out.replace(SSN_RE, () => {
    hits.push("ssn");
    return "[SSN]";
  });

  out = out.replace(EMAIL_RE, () => {
    hits.push("email");
    return "[EMAIL]";
  });

  out = out.replace(PHONE_RE, (match) => {
    let digits = match.replace(/[^\d]/g, "");
    if (digits.length === 11 && digits.startsWith("1")) {
      digits = digits.slice(1);
    }
    if (digits.length !== 10) return match;
    if (digits === STORE_PHONE_DIGITS) return match;
    hits.push("phone");
    return "[PHONE]";
  });

  const uniqueHits = Array.from(new Set(hits)).sort();
  return { redacted: out, hits: uniqueHits };
}
