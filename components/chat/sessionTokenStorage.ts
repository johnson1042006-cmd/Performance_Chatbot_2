/**
 * Client-side persistence of the raw session token, keyed by customerIdentifier,
 * in the widget origin's localStorage.
 *
 * Why: the resume POST to /api/sessions proves ownership of an existing session
 * so a stranger who only knows the customerIdentifier cannot adopt it. The
 * server checks the pc_st_<id> cookie first, but that cookie is SameSite=None
 * and the storefront widget runs in a cross-site iframe, so browsers that block
 * or partition third-party cookies (Safari ITP, Firefox ETP-strict, Chrome
 * partitioning) may not present it on a fresh load. Persisting the token here
 * lets the widget send it via the x-session-token header on resume as a
 * FALLBACK, so legitimate same-device/same-browser customers keep their
 * conversation. The cookie remains the primary/preferred check server-side.
 *
 * All access is defensive: localStorage can be absent (SSR) or throw (privacy
 * mode / blocked storage) and must never surface into the widget.
 */
const STORAGE_PREFIX = "pc-st:";

function getStore(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

export function tokenStorageKey(customerIdentifier: string): string {
  return `${STORAGE_PREFIX}${customerIdentifier}`;
}

/** Read the persisted token for this customer, or null if none/unavailable. */
export function readStoredSessionToken(customerIdentifier: string): string | null {
  if (!customerIdentifier) return null;
  const store = getStore();
  if (!store) return null;
  try {
    return store.getItem(tokenStorageKey(customerIdentifier)) || null;
  } catch {
    return null;
  }
}

/**
 * Persist the (possibly rotated) token for this customer. No-ops silently when
 * storage is unavailable — resume then falls back to the pc_st_<id> cookie only.
 */
export function writeStoredSessionToken(
  customerIdentifier: string,
  token: string
): void {
  if (!customerIdentifier || !token) return;
  const store = getStore();
  if (!store) return;
  try {
    store.setItem(tokenStorageKey(customerIdentifier), token);
  } catch {
    // Non-fatal.
  }
}
