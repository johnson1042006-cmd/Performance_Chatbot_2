/**
 * Phase 4 SLA pill helper. The dashboard uses a 3-tier color scale based
 * on time since last customer message:
 *   green  < 30s
 *   amber  30s — 120s
 *   red    > 120s
 *
 * `seconds` is computed at render time from `sessions.lastCustomerActivityAt`,
 * which already exists in schema and is updated by recordCustomerActivity()
 * whenever the embed sends a message.
 */

export type SlaTier = "green" | "amber" | "red";

export function slaTier(seconds: number): SlaTier {
  if (seconds < 30) return "green";
  if (seconds <= 120) return "amber";
  return "red";
}

export function slaText(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return s > 0 ? `${m}m ${s}s` : `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h`;
}

export function slaColorClass(tier: SlaTier): string {
  switch (tier) {
    case "green":
      return "bg-emerald-100 text-emerald-700 border-emerald-200";
    case "amber":
      return "bg-amber-100 text-amber-700 border-amber-200";
    case "red":
      return "bg-red-100 text-red-700 border-red-200";
  }
}

export function slaAriaLabel(seconds: number): string {
  return `Last customer message ${slaText(seconds)} ago (${slaTier(
    seconds
  )} SLA)`;
}
