/**
 * Postgres-backed fixed-window rate limiter.
 *
 * Each (key, windowStart) pair gets one row in `rate_limit_buckets`. Each
 * call performs a single round-trip via `INSERT ... ON CONFLICT DO UPDATE
 * SET count = count + 1`, returning the post-increment count. We reject the
 * request when the count exceeds `max`. Old buckets sit in the table until
 * a separate sweep removes them — that's fine because lookups are scoped
 * to the current window.
 *
 * Fail-open on DB errors: a transient Neon hiccup must not 500 the API.
 * Logged at warn level so it's visible without alarming.
 */
import { db } from "@/lib/db";
import { rateLimitBuckets } from "@/lib/db/schema";
import { sql } from "drizzle-orm";
import { log, serializeError } from "@/lib/log";

export interface EnforceResult {
  ok: boolean;
  retryAfter?: number;
}

export async function enforce(
  key: string,
  max: number,
  windowSeconds: number
): Promise<EnforceResult> {
  // Dev-only bypass for traffic that originates from localhost. The Playwright
  // dev server has no upstream proxy, so browser-driven requests come in as
  // ::1 / 127.0.0.1 (Next.js dev synthesizes x-forwarded-for from the socket)
  // or — when no header is set at all — as the literal "unknown". Either way
  // they all collapse onto a single bucket and bot-quality.spec.ts /
  // hallucination.spec.ts (each creating dozens of sessions in a tight window)
  // would tank on the 5/60s ceiling. Production traffic always carries a real
  // client IP from Vercel's edge, so this branch never fires there. Synthetic
  // IPs used by security.spec.ts (e.g. 203.0.113.42) still hit the real
  // limiter, so the 21st-call 429 assertion still holds.
  if (process.env.NODE_ENV !== "production" && isLocalKey(key)) {
    return { ok: true };
  }

  const windowMs = windowSeconds * 1000;
  const now = Date.now();
  const windowStart = new Date(Math.floor(now / windowMs) * windowMs);

  try {
    const [row] = await db
      .insert(rateLimitBuckets)
      .values({ key, windowStart, count: 1 })
      .onConflictDoUpdate({
        target: [rateLimitBuckets.key, rateLimitBuckets.windowStart],
        set: { count: sql`${rateLimitBuckets.count} + 1` },
      })
      .returning({ count: rateLimitBuckets.count });

    const count = row?.count ?? 1;
    if (count > max) {
      const retryAfter = Math.max(
        1,
        Math.ceil((windowStart.getTime() + windowMs - now) / 1000)
      );
      return { ok: false, retryAfter };
    }
    return { ok: true };
  } catch (err) {
    log.warn("rate_limit.enforce_failed", {
      key,
      max,
      windowSeconds,
      error: serializeError(err),
    });
    return { ok: true };
  }
}

/**
 * Pull a stable client IP from a Next.js request. Vercel sets
 * `x-forwarded-for` as a comma-separated list with the client at index 0.
 */
export function getClientIp(req: Request): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
  );
}

const LOCAL_SUFFIXES = [":unknown", ":::1", ":127.0.0.1", ":localhost"];

function isLocalKey(key: string): boolean {
  return LOCAL_SUFFIXES.some((suffix) => key.endsWith(suffix));
}
