import { NextResponse } from "next/server";
import { searchProducts, productHasColor } from "@/lib/search/productSearch";
import { expandColorQuery } from "@/lib/search/colorSynonyms";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

export async function GET() {
  const expanded = new Set(expandColorQuery("blue").map(c => c.toLowerCase()));

  let colorwaySQL: unknown = null;
  let colorwaySQLError: string | null = null;
  try {
    const rows = await db.execute(
      sql`SELECT DISTINCT bc_product_id, product_name FROM product_colorways WHERE colorway_lower LIKE ${'%blue%'} AND product_name ILIKE ${'%helmet%'} LIMIT 5`
    );
    colorwaySQL = Array.isArray(rows) ? rows.slice(0, 5) : (rows as Record<string, unknown[]>).rows?.slice(0, 5) ?? rows;
  } catch (e: unknown) {
    colorwaySQLError = e instanceof Error ? e.message : String(e);
  }

  let searchResult: unknown = null;
  let searchError: string | null = null;
  try {
    const { products, detectedColor } = await searchProducts("show me a blue street helmet");
    searchResult = {
      detectedColor,
      total: products.length,
      top5: products.slice(0, 5).map(p => ({
        name: p.name,
        hasColor: productHasColor(p, expanded),
        variantCount: p.variants?.length ?? 0,
      })),
    };
  } catch (e: unknown) {
    searchError = e instanceof Error ? e.message : String(e);
  }

  return NextResponse.json({ colorwaySQL, colorwaySQLError, searchResult, searchError });
}
