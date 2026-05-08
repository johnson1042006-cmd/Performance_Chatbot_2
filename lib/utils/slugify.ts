/**
 * Phase 5 helper: convert a customer question into a knowledge_base.topic
 * slug. Constraints:
 *   - kebab-case lowercase a-z 0-9
 *   - <= 60 chars
 *   - never empty (falls back to "untitled-faq" if input is all noise)
 *
 * The companion `dedupSlug` adds a `-2`, `-3`, … suffix until the slug
 * isn't already taken; callers pass an `existing` set to check against.
 */
const MAX = 60;

export function slugify(input: string): string {
  if (!input) return "untitled-faq";
  const cleaned = input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['’`]+/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const trimmed = cleaned.slice(0, MAX).replace(/-+$/g, "");
  return trimmed || "untitled-faq";
}

function isStringSet(x: unknown): x is ReadonlySet<string> {
  return typeof x === "object" && x !== null && typeof (x as { has?: unknown }).has === "function";
}

export function dedupSlug(
  slug: string,
  existing: ReadonlyArray<string> | ReadonlySet<string>
): string {
  const has = (s: string): boolean =>
    isStringSet(existing) ? existing.has(s) : (existing as ReadonlyArray<string>).indexOf(s) !== -1;
  if (!has(slug)) return slug;
  let i = 2;
  while (i < 1000) {
    const suffix = `-${i}`;
    const base =
      slug.length + suffix.length > MAX
        ? slug.slice(0, MAX - suffix.length).replace(/-+$/g, "")
        : slug;
    const candidate = `${base}${suffix}`;
    if (!has(candidate)) return candidate;
    i++;
  }
  return `${slug}-${Date.now()}`;
}
