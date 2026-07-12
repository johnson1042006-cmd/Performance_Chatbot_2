import { NextRequest, NextResponse } from "next/server";
import { findPairings } from "@/lib/search/pairingSearch";
import { enforce, getClientIp } from "@/lib/rateLimit";
import { log, serializeError } from "@/lib/log";

// This endpoint is intentionally public (storefront product pages call it
// cross-origin). Each SKU fans out to up to ~21 BigCommerce REST lookups, so
// an unbounded `skus` list + no rate limit is a cost-amplification lever:
// distinct/garbage SKUs bypass the CDN cache and can exhaust BigCommerce quota.
const MAX_SKUS = 10;
const PAIRINGS_RATE_LIMIT = 30; // requests per window per IP
const PAIRINGS_RATE_WINDOW = 60; // seconds

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

function formatResult(r: Awaited<ReturnType<typeof findPairings>>[number]) {
  const p = r.product!;
  const price = p.sale_price || p.calculated_price || p.price;
  const thumbnail =
    p.images?.find((img) => img.is_thumbnail)?.url_standard ??
    p.images?.[0]?.url_standard ??
    null;

  return {
    sku: p.sku,
    name: p.name,
    price,
    salePrice: p.sale_price || null,
    image: thumbnail,
    url: p.custom_url?.url
      ? `https://performancecycle.com${p.custom_url.url}`
      : null,
    pairingType: r.pairing.pairingType,
  };
}

export async function GET(req: NextRequest) {
  const requestId = crypto.randomUUID();
  try {
    const ip = getClientIp(req);
    const rl = await enforce(
      `pairings:${ip}`,
      PAIRINGS_RATE_LIMIT,
      PAIRINGS_RATE_WINDOW
    );
    if (!rl.ok) {
      return NextResponse.json(
        { error: "rate_limited" },
        {
          status: 429,
          headers: {
            ...CORS_HEADERS,
            "Retry-After": String(rl.retryAfter ?? PAIRINGS_RATE_WINDOW),
          },
        }
      );
    }

    const singleSku = req.nextUrl.searchParams.get("sku");
    const multiSkus = req.nextUrl.searchParams.get("skus");

    let skuList: string[] = [];
    if (singleSku) {
      skuList.push(singleSku);
    } else if (multiSkus) {
      skuList.push(
        ...multiSkus.split(",").map((s) => s.trim()).filter(Boolean)
      );
    }

    if (skuList.length === 0) {
      return NextResponse.json(
        { error: "sku or skus query parameter is required" },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    // Cap the fan-out. A genuine product page / cart sends a handful of SKUs;
    // anything past MAX_SKUS is dropped (logged) rather than driving hundreds
    // of parallel BigCommerce lookups from one request.
    if (skuList.length > MAX_SKUS) {
      log.warn("pairings.sku_list_truncated", {
        requestId,
        received: skuList.length,
        cap: MAX_SKUS,
      });
      skuList = skuList.slice(0, MAX_SKUS);
    }

    const allResults = await Promise.all(skuList.map((s) => findPairings(s)));

    const seen = new Set<string>();
    const pairings: ReturnType<typeof formatResult>[] = [];

    for (const results of allResults) {
      for (const r of results) {
        if (!r.product) continue;
        if (seen.has(r.product.sku)) continue;
        seen.add(r.product.sku);
        pairings.push(formatResult(r));
      }
    }

    return NextResponse.json(
      { pairings },
      {
        headers: {
          ...CORS_HEADERS,
          "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
        },
      }
    );
  } catch (error) {
    log.error("pairings.public_get_failed", { requestId, error: serializeError(error) });
    return NextResponse.json(
      { error: "Failed to fetch pairings" },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
