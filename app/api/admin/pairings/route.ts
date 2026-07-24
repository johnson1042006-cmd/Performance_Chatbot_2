import { NextRequest, NextResponse } from "next/server";
import { getStaffSession } from "@/lib/auth";
import { passwordResetGate } from "@/lib/auth/passwordResetGate";
import { db } from "@/lib/db";
import { productPairings, products } from "@/lib/db/schema";
import { alias } from "drizzle-orm/pg-core";
import { eq } from "drizzle-orm";
import { log, serializeError } from "@/lib/log";

export async function GET() {
  const requestId = crypto.randomUUID();
  try {
    const session = await getStaffSession();
    const resetDenied = passwordResetGate(session);
    if (resetDenied) return resetDenied;
    if (!session?.user || session.user.role !== "store_manager") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const primaryProducts = alias(products, "primary_products");
    const pairedProducts = alias(products, "paired_products");

    const rows = await db
      .select({
        id: productPairings.id,
        primarySku: productPairings.primarySku,
        pairedSku: productPairings.pairedSku,
        pairingType: productPairings.pairingType,
        primaryName: primaryProducts.name,
        pairedName: pairedProducts.name,
      })
      .from(productPairings)
      .leftJoin(primaryProducts, eq(productPairings.primarySku, primaryProducts.sku))
      .leftJoin(pairedProducts, eq(productPairings.pairedSku, pairedProducts.sku));

    const pairings = rows.map((r) => ({
      ...r,
      primaryName: r.primaryName ?? "Unknown",
      pairedName: r.pairedName ?? "Unknown",
    }));

    return NextResponse.json({ pairings });
  } catch (error) {
    log.error("admin.pairings_get_failed", { requestId, error: serializeError(error) });
    return NextResponse.json(
      { error: "Failed to fetch pairings" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  const requestId = crypto.randomUUID();
  try {
    const session = await getStaffSession();
    const resetDenied = passwordResetGate(session);
    if (resetDenied) return resetDenied;
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
    log.error("admin.pairings_post_failed", { requestId, error: serializeError(error) });
    return NextResponse.json(
      { error: "Failed to create pairing" },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  const requestId = crypto.randomUUID();
  try {
    const session = await getStaffSession();
    const resetDenied = passwordResetGate(session);
    if (resetDenied) return resetDenied;
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
    log.error("admin.pairings_delete_failed", { requestId, error: serializeError(error) });
    return NextResponse.json(
      { error: "Failed to delete pairing" },
      { status: 500 }
    );
  }
}
