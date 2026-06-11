/**
 * Format a timestamp as a short human-relative string, e.g. "just now",
 * "3 minutes ago", "3 days ago". Pair with the absolute date in a `title`
 * attribute so hovering reveals the exact time.
 */
export function formatRelativeTime(
  input: string | number | Date,
  now: Date = new Date()
): string {
  const then = new Date(input);
  const diffMs = now.getTime() - then.getTime();
  const diffSec = Math.round(diffMs / 1000);

  if (!Number.isFinite(diffSec)) return "";
  if (diffSec < 0) return "just now";

  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ["year", 60 * 60 * 24 * 365],
    ["month", 60 * 60 * 24 * 30],
    ["week", 60 * 60 * 24 * 7],
    ["day", 60 * 60 * 24],
    ["hour", 60 * 60],
    ["minute", 60],
  ];

  for (const [unit, secondsInUnit] of units) {
    const value = Math.floor(diffSec / secondsInUnit);
    if (value >= 1) {
      return value === 1 ? `1 ${unit} ago` : `${value} ${unit}s ago`;
    }
  }

  return "just now";
}
