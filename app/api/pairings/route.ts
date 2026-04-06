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

export async function GET(req: NextRequest) {
  try {
    const sku = req.nextUrl.searchParams.get("sku");
    if (!sku) {
      return NextResponse.json(
        { error: "sku query parameter is required" },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    const results = await findPairings(sku);

    const pairings = results
      .filter((r) => r.product)
      .map((r) => {
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
      });

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
