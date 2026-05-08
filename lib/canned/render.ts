/**
 * Phase 4 placeholder substitution for canned-reply bodies. Manager-authored
 * templates may contain {customer_name}, {agent_name}, and {store_phone}
 * tokens; we replace them server-side at fetch time so the dropdown the
 * agent sees is already personalized to the active session.
 *
 * Kept intentionally simple — exact-token replace, no nested templating, no
 * conditionals. If we later add more placeholders, extend the map.
 */

export const STORE_PHONE = "303-744-2011";

export interface RenderContext {
  customerName?: string | null;
  agentName?: string | null;
}

export function renderCannedBody(
  body: string,
  ctx: RenderContext
): string {
  const customer =
    typeof ctx.customerName === "string" && ctx.customerName.trim().length > 0
      ? ctx.customerName.trim()
      : "there";
  const agent =
    typeof ctx.agentName === "string" && ctx.agentName.trim().length > 0
      ? ctx.agentName.trim()
      : "";
  return body
    .replaceAll("{customer_name}", customer)
    .replaceAll("{agent_name}", agent)
    .replaceAll("{store_phone}", STORE_PHONE);
}
