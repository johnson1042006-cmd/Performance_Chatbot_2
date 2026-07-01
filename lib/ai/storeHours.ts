/**
 * Single source of truth for Performance Cycle store hours, plus a deterministic
 * post-generation guard that rewrites any hours-like statement in AI output to
 * the canonical string. Imported by:
 *   - lib/ai/rules.ts  (the HIGH no-footer rule embeds CANONICAL_STORE_HOURS)
 *   - lib/ai/runAi.ts  (guards both the streamed and the persisted AI reply)
 *
 * Why a guard and not just a prompt rule: the store_hours KB entry already holds
 * the correct values and buildPrompt injects them every turn, yet the model still
 * drifts ("Sat 9–5", "Sat–Fri") when it appends hours as an unsolicited footer.
 * The guard makes the wire format deterministic. Do NOT edit the store_hours KB
 * entry — this constant mirrors it (Mon–Sat 9–6, Sunday closed). No timezone:
 * Colorado is MDT for ~8 months of the year, so a hard-coded "MST" is wrong.
 */

export const CANONICAL_STORE_HOURS =
  "Monday–Saturday: 9 AM–6 PM · Sunday: Closed";

// A weekday name or common abbreviation, optionally plural ("Sundays").
const DAY =
  /\b(?:mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)s?\b/i;

// A clock-time RANGE: "9–5", "9 to 6", "9 AM–5 PM", "10:30 AM to 6 PM".
// Endpoints capped at 1–12 so multi-digit counts ("24-48") can't match, and a
// trailing duration unit ("2-3 days", "9 to 5 business days", "24-48 hours") is
// excluded so shipping / turnaround copy is never treated as store hours.
const RANGE =
  /\b(?:1[0-2]|[1-9])(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)?\s*(?:[–—-]|to)\s*(?:1[0-2]|[1-9])(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)?\b(?!\s*(?:day|days|week|weeks|hour|hours|min|mins|minute|minutes|business))/i;

const STATE = /\b(?:closed|open)\b/i;
const HOURS_WORD = /\bhours?\b/i;

// Holiday names, month names, and bare date ordinals ("4th", "1st"). A line that
// mentions any of these is a holiday/closure exception, not generic footer drift.
const HOLIDAY_OR_DATE =
  /\b(?:holidays?|january|february|march|april|may|june|july|august|september|october|november|december|independence day|fourth of july|memorial day|labor day|thanksgiving|christmas|new year|easter|\d{1,2}(?:st|nd|rd|th))\b/i;

/** True when a single line reads as a store-hours statement. */
function isHoursLine(line: string): boolean {
  // Holiday / specific-date context is never generic footer drift, but it IS a
  // closure exception ("closed Monday for the holiday", "closed July 4th"). The
  // canonical weekly line shows Saturday as open, so rewriting those would
  // wrongly assert the store is open — bail out.
  if (HOLIDAY_OR_DATE.test(line)) return false;

  const hasDay = DAY.test(line);
  const hasRange = RANGE.test(line);
  const hasState = STATE.test(line);
  const hasHoursWord = HOURS_WORD.test(line);
  // Rule 1: a weekday paired with a time range, an open/closed state, or the
  //         word "hours" — "Saturday 9 AM–5 PM", "Sat 9–5", "closed Sundays".
  // Rule 2: an open/closed state or "hours" paired with a time RANGE (a span,
  //         never a lone timestamp) — "we're open 9 AM to 6 PM" with no weekday,
  //         while leaving "open, placed at 9 AM" untouched.
  return (
    (hasDay && (hasRange || hasState || hasHoursWord)) ||
    ((hasState || hasHoursWord) && hasRange)
  );
}

/**
 * Replace every store-hours statement in `text` with CANONICAL_STORE_HOURS.
 * Operates line by line and collapses a contiguous run of hours lines (e.g. a
 * 7-day bullet list) into a single canonical line. Idempotent: the canonical
 * line maps back to itself. Non-hours lines — "ships in 2-3 days", "takes about
 * 1 hour", "Saturday track day at 9 AM", holiday closures — pass through.
 */
export function rewriteStoreHours(text: string): string {
  if (!text) return text;
  const lines = text.split("\n");
  const out: string[] = [];
  let inRun = false;
  for (const line of lines) {
    if (isHoursLine(line)) {
      if (!inRun) {
        out.push(CANONICAL_STORE_HOURS); // collapse the run to one line
        inRun = true;
      }
    } else {
      out.push(line);
      inRun = false;
    }
  }
  return out.join("\n");
}
