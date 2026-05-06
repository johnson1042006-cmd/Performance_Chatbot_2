import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { messages, sessions, knowledgeBase } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getPusher } from "@/lib/pusher/server";
import { getProductBySKU, getProductByName } from "@/lib/bigcommerce/client";
import { extractSKUFromText } from "@/lib/search/productSearch";
import { anyAgentsOnline } from "@/lib/presence";
import {
  recordCustomerActivity,
  claimByAi,
} from "@/lib/sessions/state";
import { buildPrompt } from "@/lib/ai/buildPrompt";
import { callClaude, CALL_CLAUDE_ERROR_MESSAGE } from "@/lib/ai/callClaude";

const DEFAULT_FALLBACK_SECONDS = 60;

async function getBotSettings(): Promise<{
  aiEnabled: boolean;
  fallbackTimerSeconds: number;
}> {
  try {
    const [entry] = await db
      .select()
      .from(knowledgeBase)
      .where(eq(knowledgeBase.topic, "bot_settings"))
      .limit(1);
    if (!entry) return { aiEnabled: true, fallbackTimerSeconds: DEFAULT_FALLBACK_SECONDS };
    const parsed = JSON.parse(entry.content);
    return {
      aiEnabled: parsed.aiEnabled ?? true,
      fallbackTimerSeconds: Math.min(300, Math.max(10, Number(parsed.fallbackTimerSeconds) || DEFAULT_FALLBACK_SECONDS)),
    };
  } catch {
    return { aiEnabled: true, fallbackTimerSeconds: DEFAULT_FALLBACK_SECONDS };
  }
}

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

    // Bump customer activity timestamp
    if (role === "customer") {
      await recordCustomerActivity(sessionId);
    }

    // Check if message text contains a SKU pattern
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

    // ── Queue / claim decision for customer messages ──────────────────────
    if (role !== "customer") {
      return NextResponse.json({
        message: savedMessage,
        sessionStatus: session.status,
        productMention,
      });
    }

    // If already claimed by a human, nothing more to do
    if (session.claimedByKind === "human") {
      return NextResponse.json({
        message: savedMessage,
        sessionStatus: "active_human",
        productMention,
      });
    }

    // If already claimed by AI, the existing session is being handled
    if (session.claimedByKind === "ai") {
      return NextResponse.json({
        message: savedMessage,
        sessionStatus: "active_ai",
        productMention,
      });
    }

    // Session is unclaimed — decide what to do
    const botSettings = await getBotSettings();

    if (!botSettings.aiEnabled) {
      // AI is off: just queue, never auto-respond
      return NextResponse.json({
        message: savedMessage,
        sessionStatus: "waiting",
        queued: true,
        productMention,
      });
    }

    // AI is on: check agent presence
    const agentsOnline = await anyAgentsOnline();

    if (!agentsOnline) {
      // No agents — AI claims immediately
      const won = await claimByAi(sessionId);
      if (won) {
        // Fire AI response inline
        try {
          const { system, conversationMessages } = await buildPrompt(
            sessionId,
            message,
            enrichedContext
          );
          const aiResponse = await callClaude(system, conversationMessages);
          const [aiMsg] = await db
            .insert(messages)
            .values({ sessionId, role: "ai", content: aiResponse })
            .returning();

          const pusher = getPusher();
          await pusher.trigger(`session-${sessionId}`, "new-message", {
            id: aiMsg.id,
            role: "ai",
            content: aiMsg.content,
            sentAt: aiMsg.sentAt,
          });
          await pusher.trigger("dashboard", "session-update", {
            sessionId,
            lastMessage: aiMsg.content,
            role: "ai",
          });
          await pusher.trigger(`session-${sessionId}`, "session-claimed", {
            kind: "ai",
          });
          await pusher.trigger("dashboard", "session-claimed", {
            sessionId,
            kind: "ai",
          });

          return NextResponse.json({
            message: savedMessage,
            aiMessage: aiMsg,
            sessionStatus: "active_ai",
            productMention,
          });
        } catch (err) {
          console.error("Inline AI response failed:", err);
        }
      }
      return NextResponse.json({
        message: savedMessage,
        sessionStatus: "active_ai",
        productMention,
      });
    }

    // Agents are online: set AI claim due time and let humans have first crack
    const dueAt = new Date(Date.now() + botSettings.fallbackTimerSeconds * 1000);
    await db
      .update(sessions)
      .set({ aiClaimDueAt: dueAt })
      .where(eq(sessions.id, sessionId));

    return NextResponse.json({
      message: savedMessage,
      sessionStatus: "waiting",
      queued: true,
      aiClaimDueAtMs: dueAt.getTime(),
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
