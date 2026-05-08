/**
 * Phase 4 Vercel-IP-geolocation extractor. Vercel sets these headers on
 * every request that reaches a function (Edge or Node runtime), so we read
 * them directly instead of touching the edge-only `req.geo` API. Locally
 * (and in any non-Vercel env) the headers are absent and we return all
 * nulls — the caller wraps the call in try/catch and skips persistence.
 *
 * NOTE: city / region come URL-encoded (e.g. "Mountain%20View") so we
 * decode them before persistence.
 */

export interface GeoFields {
  city: string | null;
  region: string | null;
  country: string | null;
}

export function extractGeoFromHeaders(req: Request): GeoFields {
  const out: GeoFields = { city: null, region: null, country: null };
  try {
    const city = req.headers.get("x-vercel-ip-city");
    const region = req.headers.get("x-vercel-ip-country-region");
    const country = req.headers.get("x-vercel-ip-country");
    if (city) out.city = decodeURIComponent(city).slice(0, 80) || null;
    if (region) out.region = decodeURIComponent(region).slice(0, 80) || null;
    if (country) out.country = decodeURIComponent(country).slice(0, 80) || null;
  } catch {
    // Bad URL-encoded value — fall through with whatever we have.
  }
  return out;
}

export function hasAnyGeo(geo: GeoFields): boolean {
  return !!(geo.city || geo.region || geo.country);
}
