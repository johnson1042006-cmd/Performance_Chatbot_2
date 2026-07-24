import { NextRequest } from "next/server";
import { getStaffSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { sessions } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { log } from "@/lib/log";

/** Cookie name carrying the raw session token, namespaced per session. */
export function sessionTokenCookieName(sessionId: string): string {
  return `pc_st_${sessionId}`;
}

/** 7 days, in seconds. */
export const SESSION_TOKEN_MAX_AGE = 60 * 60 * 24 * 7;

/** Generate a fresh raw token and its SHA-256 hash for storage. */
export function generateSessionToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString("base64url");
  return { raw, hash: hashSessionToken(raw) };
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Read the raw token from the request, in priority order:
 *   1. pc_st_<sessionId> cookie
 *   2. x-session-token header
 *   3. ?st= query param (used by navigator.sendBeacon, which can't set headers)
 */
function extractToken(req: NextRequest, sessionId: string): string | null {
  const cookie = req.cookies.get(sessionTokenCookieName(sessionId))?.value;
  if (cookie) return cookie;
  const header = req.headers.get("x-session-token");
  if (header) return header;
  const st = req.nextUrl.searchParams.get("st");
  if (st) return st;
  return null;
}

function constantTimeHashEqual(aHex: string, bHex: string): boolean {
  const a = Buffer.from(aHex, "hex");
  const b = Buffer.from(bHex, "hex");
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(a, b);
}

/**
 * Does this request prove ownership of an EXISTING session by presenting its
 * current token (cookie / x-session-token / ?st=)? Given the session's stored
 * hash so the caller (which already loaded the row) avoids a second query.
 *
 * Unlike verifySessionAccess this deliberately does NOT grant staff access and
 * does NOT honor the legacy null-hash grace: it exists for the session-resume
 * path, where adopting a stranger's open session must require the actual token,
 * not merely knowing the (URL-borne, integrator-settable) customerIdentifier.
 */
export function requestOwnsSession(
  req: NextRequest,
  sessionId: string,
  tokenHash: string | null
): boolean {
  if (!tokenHash) return false;
  const provided = extractToken(req, sessionId);
  if (!provided) return false;
  return constantTimeHashEqual(hashSessionToken(provided), tokenHash);
}

/**
 * Authorize access to a customer session. Returns true when EITHER:
 *   (a) the request carries a valid NextAuth staff session, OR
 *   (b) the request carries the matching session token.
 *
 * Legacy grace: sessions created before the token_hash column existed have a
 * null hash — access is allowed and logged so in-flight sessions don't break
 * at deploy time.
 */
export async function verifySessionAccess(
  req: NextRequest,
  sessionId: string
): Promise<boolean> {
  const authSession = await getStaffSession();
  if (
    authSession?.user &&
    (authSession.user.role === "store_manager" ||
      authSession.user.role === "support_agent")
  ) {
    return true;
  }

  let tokenHash: string | null;
  try {
    const [row] = await db
      .select({ tokenHash: sessions.tokenHash })
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .limit(1);
    if (!row) return false;
    tokenHash = row.tokenHash;
  } catch {
    // Malformed sessionId (not a UUID) or DB error — deny.
    return false;
  }

  if (tokenHash === null) {
    log.warn("session.token_legacy_grace", { sessionId });
    return true;
  }

  const provided = extractToken(req, sessionId);
  if (!provided) return false;
  return constantTimeHashEqual(hashSessionToken(provided), tokenHash);
}
