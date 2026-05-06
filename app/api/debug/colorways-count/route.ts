import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { productColorways } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const rows = await db.select().from(productColorways);
  const blue = rows.filter((r) => r.colorwayLower.includes("blue")).length;
  return NextResponse.json({
    total: rows.length,
    blueCount: blue,
    sample: rows.slice(0, 3).map((r) => ({
      productName: r.productName,
      colorway: r.colorway,
    })),
  });
}
