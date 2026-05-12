const SERVICE_INTENT =
  /\b(service|send (?:it |my |the )?in|ship (?:it |my |the )?(?:in|back)|recharge|recertif|post[\s-]?deploy|deployed|expired?|expir(?:e|ation|y)|replac[ei]|fix|broken|warranty|repair|fired|set off|went off|gone off)\b/i;

/**
 * Returns true only when the message contains a Tech-Air mention AND a clear
 * service intent (sending in, recharging, deployed, expired, etc.).
 *
 * Shopping/comparison queries ("show me tech-air airbags", "tech-air 5 vs 10")
 * return false and fall through to the AI, which has an airbag_categorization
 * rule for product recommendations.
 *
 * The legacy phrase "airbag service" always triggers regardless of context, to
 * preserve backward compatibility.
 */
export function detectTechAirServiceIntent(text: string): boolean {
  const lower = text.toLowerCase();
  const trimmed = text.trim();
  const mentions =
    lower.includes("tech-air") ||
    lower.includes("tech air") ||
    lower.includes("techair");
  return lower.includes("airbag service") || (mentions && SERVICE_INTENT.test(trimmed));
}
