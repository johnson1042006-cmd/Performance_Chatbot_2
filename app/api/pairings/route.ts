import { NextRequest, NextResponse } from "next/server";
import { findPairings } from "@/lib/search/pairingSearch";

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
  try {
    const singleSku = req.nextUrl.searchParams.get("sku");
    const multiSkus = req.nextUrl.searchParams.get("skus");

    const skuList: string[] = [];
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
    console.error("Public pairings GET error:", error);
    return NextResponse.json(
      { error: "Failed to fetch pairings" },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
