import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { productPairings, products } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user || session.user.role !== "store_manager") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const pairings = await db.select().from(productPairings);

    const enriched = await Promise.all(
      pairings.map(async (p) => {
        const [primary] = await db
          .select()
          .from(products)
          .where(eq(products.sku, p.primarySku))
          .limit(1);
        const [paired] = await db
          .select()
          .from(products)
          .where(eq(products.sku, p.pairedSku))
          .limit(1);
        return {
          ...p,
          primaryName: primary?.name || "Unknown",
          pairedName: paired?.name || "Unknown",
        };
      })
    );

    return NextResponse.json({ pairings: enriched });
  } catch (error) {
    console.error("Pairings GET error:", error);
    return NextResponse.json(
      { error: "Failed to fetch pairings" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user || session.user.role !== "store_manager") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { primarySku, pairedSku, pairingType } = body;

    if (!primarySku || !pairedSku || !pairingType) {
      return NextResponse.json(
        { error: "primarySku, pairedSku, and pairingType are required" },
        { status: 400 }
      );
    }

    const [pairing] = await db
      .insert(productPairings)
      .values({ primarySku, pairedSku, pairingType })
      .returning();

    return NextResponse.json({ pairing });
  } catch (error) {
    console.error("Pairings POST error:", error);
    return NextResponse.json(
      { error: "Failed to create pairing" },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user || session.user.role !== "store_manager") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    await db.delete(productPairings).where(eq(productPairings.id, id));
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Pairings DELETE error:", error);
    return NextResponse.json(
      { error: "Failed to delete pairing" },
      { status: 500 }
    );
  }
}
