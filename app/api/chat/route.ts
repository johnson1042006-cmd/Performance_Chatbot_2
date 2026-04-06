import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { messages, sessions } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getPusher } from "@/lib/pusher/server";
import { getProductBySKU, getProductByName } from "@/lib/bigcommerce/client";
import { extractSKUFromText } from "@/lib/search/productSearch";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { message, sessionId, pageContext, role = "customer", agentName } = body;

    if (!message || !sessionId) {
      return NextResponse.json(
        { error: "message and sessionId are required" },
        { status: 400 }
      );
    }

    if (role === "agent") {
      const authSession = await getServerSession(authOptions);
      if (!authSession?.user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
    }

    const [session] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .limit(1);

    if (!session) {
      return NextResponse.json(
        { error: "Session not found" },
        { status: 404 }
      );
    }

    // Enrich page context with live BC data when available
    let enrichedContext = pageContext;
    if (role === "customer" && pageContext) {
      enrichedContext = { ...pageContext };

      if (pageContext.productSku) {
        const bcProduct = await getProductBySKU(pageContext.productSku);
        if (bcProduct) {
          enrichedContext.bcProductId = bcProduct.id;
          enrichedContext.bcProductName = bcProduct.name;
          enrichedContext.bcPrice = bcProduct.calculated_price || bcProduct.price;
          enrichedContext.bcStock = bcProduct.inventory_level;
        }
      } else if (pageContext.productName) {
        const bcProducts = await getProductByName(pageContext.productName);
        if (bcProducts.length > 0) {
          const match = bcProducts[0];
          enrichedContext.bcProductId = match.id;
          enrichedContext.bcProductName = match.name;
          enrichedContext.bcPrice = match.calculated_price || match.price;
          enrichedContext.bcStock = match.inventory_level;
        }
      }

      await db
        .update(sessions)
        .set({ pageContext: enrichedContext })
        .where(eq(sessions.id, sessionId));
    }

    // Check if message text contains a SKU pattern and note it
    let productMention = null;
    if (role === "customer") {
      const detectedSKU = extractSKUFromText(message);
      if (detectedSKU) {
        const skuProduct = await getProductBySKU(detectedSKU);
        if (skuProduct) {
          productMention = {
            sku: skuProduct.sku,
            name: skuProduct.name,
            price: skuProduct.calculated_price || skuProduct.price,
            inStock: skuProduct.inventory_level > 0,
          };
        }
      }
    }

    const [savedMessage] = await db
      .insert(messages)
      .values({
        sessionId,
        role,
        content: message,
        pageContext: role === "customer" ? enrichedContext : undefined,
      })
      .returning();

    try {
      const pusher = getPusher();
      await pusher.trigger(`session-${sessionId}`, "new-message", {
        id: savedMessage.id,
        role: savedMessage.role,
        content: savedMessage.content,
        sentAt: savedMessage.sentAt,
        pageContext: savedMessage.pageContext,
        agentName,
        productMention,
      });

      await pusher.trigger("dashboard", "session-update", {
        sessionId,
        lastMessage: savedMessage.content,
        role: savedMessage.role,
        pageContext: enrichedContext,
        productMention,
      });
    } catch (pusherError) {
      console.error("Pusher error (non-fatal):", pusherError);
    }

    return NextResponse.json({
      message: savedMessage,
      sessionStatus: session.status,
      productMention,
    });
  } catch (error) {
    console.error("Chat API error:", error);
    return NextResponse.json(
      { error: "Failed to process message" },
      { status: 500 }
    );
  }
}
