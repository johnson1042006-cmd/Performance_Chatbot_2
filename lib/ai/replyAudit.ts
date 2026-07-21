/**
 * Reply link/bold audit — Phase A5 measurement (7/20/2026).
 *
 * Pure text scanner over the model's reply, feeding the `ai.reply_link_audit`
 * telemetry: does the model keep the `[**Name**](url)` markdown link when it
 * surfaces a product, or does it drop to bare bold? Measurement only — the
 * Phase E decision (deterministic auto-linker vs. accept-as-is) keys off the
 * recurrence rate this produces.
 */

export interface ReplyLinkAudit {
  /** [text](url) spans in the reply */
  linkCount: number;
  /** bold spans in the reply */
  boldCount: number;
  /** bold spans NOT inside any markdown link's text */
  unlinkedBoldCount: number;
  /** shown products whose key phrase appears anywhere in the reply */
  productsMentioned: number;
  /** shown products whose key phrase appears inside a link's text */
  productsLinked: number;
  /** key phrases mentioned but never linked (the Phase E failure mode) */
  unlinkedProducts: string[];
}

// Generic type nouns models often drop when shortening a product name
// ("the Shoei RF-1400" for "Shoei RF-1400 Helmet") — trimmed from the tail
// of the key phrase so shortened mentions still count.
const GENERIC_TAIL_NOUNS = new Set([
  "helmet", "helmets", "jacket", "jackets", "glove", "gloves",
  "boot", "boots", "pant", "pants", "tire", "tires", "vest", "vests",
]);

/**
 * A product's "key phrase": lowercase, leading model-year token stripped,
 * first three words, trailing generic type noun trimmed. Catches shortened
 * mentions ("Michelin Road 6" for "Michelin Road 6 Sport Touring Tires",
 * "Klim Marrakesh" for "2023 Klim Marrakesh Jacket").
 */
export function productKeyPhrase(name: string): string {
  const words = name
    .toLowerCase()
    .replace(/^(19|20)\d{2}\s+/, "")
    .trim()
    .split(/\s+/)
    .slice(0, 3);
  while (words.length > 1 && GENERIC_TAIL_NOUNS.has(words[words.length - 1])) {
    words.pop();
  }
  return words.join(" ");
}

const LINK_RE = /\[([^\]]*)\]\(([^)\s]+)\)/g;
const BOLD_RE = /\*\*([^*]+?)\*\*/g;

export function auditReplyLinks(
  reply: string,
  productNames: string[]
): ReplyLinkAudit {
  const replyLower = reply.toLowerCase();

  // Link spans for bold containment: the [text] portion (catches
  // "[**Name**](url)") and the full [text](url) span (catches the
  // "**[Name](url)**" format the model also produces — both are working
  // links, neither is the Phase E failure mode).
  const linkTexts: string[] = [];
  const linkTextRanges: Array<[number, number]> = [];
  const linkFullRanges: Array<[number, number]> = [];
  let m: RegExpExecArray | null;
  LINK_RE.lastIndex = 0;
  while ((m = LINK_RE.exec(reply)) !== null) {
    linkTexts.push(m[1].toLowerCase());
    linkTextRanges.push([m.index + 1, m.index + 1 + m[1].length]);
    linkFullRanges.push([m.index, m.index + m[0].length]);
  }

  let boldCount = 0;
  let unlinkedBoldCount = 0;
  BOLD_RE.lastIndex = 0;
  while ((m = BOLD_RE.exec(reply)) !== null) {
    boldCount++;
    const start = m.index;
    const end = m.index + m[0].length;
    const insideLink = linkTextRanges.some(
      ([ls, le]) => start >= ls && end <= le
    );
    const wrapsLink = linkFullRanges.some(
      ([ls, le]) => ls >= start && le <= end
    );
    if (!insideLink && !wrapsLink) unlinkedBoldCount++;
  }

  const phrases = Array.from(
    new Set(productNames.map(productKeyPhrase).filter((p) => p.length > 0))
  );
  const mentioned = phrases.filter((p) => replyLower.includes(p));
  const linked = mentioned.filter((p) =>
    linkTexts.some((t) => t.includes(p))
  );
  const unlinkedProducts = mentioned.filter((p) => !linked.includes(p));

  return {
    linkCount: linkTexts.length,
    boldCount,
    unlinkedBoldCount,
    productsMentioned: mentioned.length,
    productsLinked: linked.length,
    unlinkedProducts,
  };
}
