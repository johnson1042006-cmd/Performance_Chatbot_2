import { NextRequest, NextResponse } from "next/server";
import { getStaffSession } from "@/lib/auth";
import { passwordResetGate } from "@/lib/auth/passwordResetGate";
import { db } from "@/lib/db";
import { messages, sessions, knowledgeBase } from "@/lib/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { buildPrompt } from "@/lib/ai/buildPrompt";
import { callClaude } from "@/lib/ai/callClaude";
import { tools as toolCatalog, toolHandlers } from "@/lib/ai/tools";
import { enforce } from "@/lib/rateLimit";
import { log, serializeError } from "@/lib/log";

export const dynamic = "force-dynamic";

const SUGGEST_INSTRUCTION = `\n\n## AGENT SUGGESTED REPLY MODE\n\nAn agent is reviewing this chat and wants a SUGGESTED next reply. Output only the reply text. No preamble. Under 80 words. Match the agent's tone if prior agent messages exist.\n`;

async function getAiEnabled(): Promise<boolean> {
  try {
    const [entry] = await db
      .select()
      .from(knowledgeBase)
      .where(eq(knowledgeBase.topic, "bot_settings"))
      .limit(1);
    if (!entry) return true;
    const parsed = JSON.parse(entry.content);
    return parsed.aiEnabled !== false;
  } catch {
    return true;
  }
}

/**
 * Phase 4 AI suggest-reply endpoint. Generates a draft response for the
 * agent to review, edit, and send. Does NOT persist anything — no messages
 * row, no chat_events row, no Pusher broadcast. Per-agent rate-limited at
 * 30 / hour using the existing Phase 1 rate-limit table.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const requestId = crypto.randomUUID();
  try {
    const auth = await getStaffSession();
    const resetDenied = passwordResetGate(auth);
    if (resetDenied) return resetDenied;
    if (!auth?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const aiEnabled = await getAiEnabled();
    if (!aiEnabled) {
      return NextResponse.json(
        { error: "AI is disabled in bot settings" },
        { status: 503 }
      );
    }

    // Per-agent rate limit: 30 suggestions per hour.
    const rl = await enforce(`ai-suggest:${auth.user.id}`, 30, 3600, {
      failClosed: true,
    });
    if (!rl.ok) {
      return NextResponse.json(
        { error: "rate_limited", retryAfter: rl.retryAfter ?? 60 },
        {
          status: 429,
          headers: { "Retry-After": String(rl.retryAfter ?? 60) },
        }
      );
    }

    const [session] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, params.id))
      .limit(1);
    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    // Pull the most recent customer message to seed the prompt with the
    // exact text we want a reply to.
    const [latestCustomer] = await db
      .select({ content: messages.content })
      .from(messages)
      .where(
        and(eq(messages.sessionId, params.id), eq(messages.role, "customer"))
      )
      .orderBy(desc(messages.sentAt))
      .limit(1);

    const latestMessage = latestCustomer?.content ?? "";

    const { system, conversationMessages } = await buildPrompt(
      params.id,
      latestMessage,
      session.pageContext as never,
      latestMessage,
      true
    );

    const wrappedSystem = system + SUGGEST_INSTRUCTION;
    const useTools = process.env.USE_AI_TOOLS === "true";

    const suggestion = await callClaude(wrappedSystem, conversationMessages, {
      ...(useTools
        ? {
            tools: toolCatalog,
            toolHandlers,
            ctx: { sessionId: params.id, requestId },
          }
        : {}),
    });

    return NextResponse.json({ suggestion });
  } catch (error) {
    log.error("sessions.ai_suggest_failed", {
      requestId,
      sessionId: params.id,
      error: serializeError(error),
    });
    return NextResponse.json(
      { error: "Failed to generate suggestion" },
      { status: 500 }
    );
  }
}
