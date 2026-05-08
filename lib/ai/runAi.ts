/**
 * Phase 3 shared AI persistence helper. Used by:
 *  - app/api/chat/route.ts (inline AI path: existing AI claim + AI auto-claim)
 *  - app/api/chat/ai-fallback/route.ts (queued sweep / cron)
 *  - lib/sessions/state.ts processDueAiClaims (cron sweep)
 *
 * Responsibilities (in order):
 *   1. buildPrompt
 *   2. callClaude (with tools when USE_AI_TOOLS=true)
 *      - tool calls are persisted as chat_events rows (type "tool_call")
 *      - streaming hook forwards tokens + tool_use events to the caller
 *   3. compute confidence + sentiment heuristics
 *   4. insert messages row with confidence + sentiment
 *   5. fire Pusher new-message (session) + session-update (dashboard)
 *   6. auto-escalate at most once per session when sentiment === -1 OR
 *      confidence === "low"; emits "request-contact" when no agents online
 *
 * Returns the saved AI message and the metadata needed by callers.
 */

import { db } from "@/lib/db";
import { messages, chatEvents } from "@/lib/db/schema";
import { and, eq, desc } from "drizzle-orm";
import { getPusher } from "@/lib/pusher/server";
import { buildPrompt } from "./buildPrompt";
import { callClaude, type ToolCallEvent } from "./callClaude";
import { tools as toolCatalog, toolHandlers, escalateToHuman } from "./tools";
import { assessConfidence, assessSentiment } from "./quality";
import { anyAgentsOnline } from "@/lib/presence";
import { log, serializeError } from "@/lib/log";

interface RunAiOptions {
  sessionId: string;
  latestMessage: string;
  latestMessageRaw?: string;
  pageContext?: Record<string, unknown> | null;
  requestId?: string;
  /** When set, callClaude streams tokens through this controller. */
  stream?: {
    onToken: (text: string) => void;
    onToolUse: (e: { name: string; input: unknown }) => void;
  };
}

interface RunAiResult {
  message: typeof messages.$inferSelect;
  confidence: ReturnType<typeof assessConfidence>;
  sentiment: ReturnType<typeof assessSentiment>;
  autoEscalated: { reason: string; agentsOnline: boolean } | null;
  toolCalls: ToolCallEvent[];
}

function aiToolsEnabled(): boolean {
  return process.env.USE_AI_TOOLS === "true";
}

async function loadRecentCustomerMessages(sessionId: string): Promise<string[]> {
  // Pull the last ~8 customer rows so assessSentiment can take the last 4
  // (some may be redacted/empty after PII filtering).
  const rows = await db
    .select({ content: messages.content })
    .from(messages)
    .where(and(eq(messages.sessionId, sessionId), eq(messages.role, "customer")))
    .orderBy(desc(messages.sentAt))
    .limit(8);
  return rows.reverse().map((r) => r.content);
}

async function hasAutoEscalated(sessionId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: chatEvents.id })
    .from(chatEvents)
    .where(
      and(
        eq(chatEvents.sessionId, sessionId),
        eq(chatEvents.type, "auto_escalated")
      )
    )
    .limit(1);
  return !!row;
}

export async function runAiTurn(opts: RunAiOptions): Promise<RunAiResult> {
  const {
    sessionId,
    latestMessage,
    latestMessageRaw,
    pageContext,
    requestId,
    stream,
  } = opts;

  // Look up agent presence ONCE per turn so buildPrompt can tell the model
  // whether it's safe to promise human follow-up. Same value is reused below
  // for the auto-escalation branch — saves a duplicate query and guarantees
  // the prompt and the escalation routing agree on what "online" means.
  const agentsOnline = await anyAgentsOnline();

  const { system, conversationMessages } = await buildPrompt(
    sessionId,
    latestMessage,
    pageContext as never,
    latestMessageRaw,
    agentsOnline
  );

  const useTools = aiToolsEnabled();
  const toolCalls: ToolCallEvent[] = [];

  const aiResponse = await callClaude(system, conversationMessages, {
    ...(useTools
      ? {
          tools: toolCatalog,
          toolHandlers,
          ctx: { sessionId, requestId },
        }
      : {}),
    ...(stream ? { stream } : {}),
    onToolCall: useTools
      ? async (e) => {
          toolCalls.push(e);
          log.info("ai.tool_call", {
            requestId,
            sessionId,
            name: e.name,
            durationMs: e.durationMs,
            isError: e.isError,
          });
          try {
            await db.insert(chatEvents).values({
              sessionId,
              type: "tool_call",
              metadata: {
                name: e.name,
                input: e.input as object,
                output: e.output as object,
                durationMs: e.durationMs,
                isError: e.isError,
              },
            });
          } catch (err) {
            log.warn("ai.tool_call_persist_failed", {
              requestId,
              sessionId,
              error: serializeError(err),
            });
          }
        }
      : undefined,
  });

  const confidence = assessConfidence(aiResponse);
  const recentCustomer = await loadRecentCustomerMessages(sessionId);
  const sentiment = assessSentiment(recentCustomer);

  const [savedMessage] = await db
    .insert(messages)
    .values({
      sessionId,
      role: "ai",
      content: aiResponse,
      confidence: confidence.confidence,
      sentiment: sentiment.score,
    })
    .returning();

  try {
    const pusher = getPusher();
    await pusher.trigger(`session-${sessionId}`, "new-message", {
      id: savedMessage.id,
      role: "ai",
      content: savedMessage.content,
      sentAt: savedMessage.sentAt,
    });
    await pusher.trigger("dashboard", "session-update", {
      sessionId,
      lastMessage: savedMessage.content,
      role: "ai",
      confidence: confidence.confidence,
      sentiment: sentiment.score,
    });
  } catch (pusherError) {
    log.warn("ai.run.pusher_failed", {
      requestId,
      sessionId,
      error: serializeError(pusherError),
    });
  }

  // Auto-escalation: at most once per session.
  let autoEscalated: RunAiResult["autoEscalated"] = null;
  const shouldEscalate =
    sentiment.score === -1 || confidence.confidence === "low";
  if (shouldEscalate) {
    const already = await hasAutoEscalated(sessionId);
    if (!already) {
      const reason: "frustrated_customer" | "unsupported" =
        sentiment.score === -1 ? "frustrated_customer" : "unsupported";
      try {
        await escalateToHuman(sessionId, reason, "normal");
      } catch (err) {
        log.warn("ai.run.auto_escalate_failed", {
          requestId,
          sessionId,
          error: serializeError(err),
        });
      }
      try {
        await db.insert(chatEvents).values({
          sessionId,
          type: "auto_escalated",
          metadata: {
            reason,
            confidence: confidence.confidence,
            sentiment: sentiment.score,
            confidenceReasons: confidence.reasons,
            sentimentReasons: sentiment.reasons,
          },
        });
      } catch (err) {
        log.warn("ai.run.auto_escalate_event_persist_failed", {
          requestId,
          sessionId,
          error: serializeError(err),
        });
      }

      try {
        const pusher = getPusher();
        if (agentsOnline) {
          // aiClaimDueAt was already cleared by escalateToHuman; nudge the
          // dashboard list to refresh so this session bubbles up.
          await pusher.trigger("dashboard", "session-update", {
            sessionId,
            autoEscalated: true,
            reason,
          });
        } else {
          // No teammates available — ask the widget to render the
          // email-capture form.
          await pusher.trigger(`session-${sessionId}`, "request-contact", {
            reason,
          });
        }
      } catch (err) {
        log.warn("ai.run.auto_escalate_pusher_failed", {
          requestId,
          sessionId,
          error: serializeError(err),
        });
      }

      autoEscalated = { reason, agentsOnline };
    }
  }

  return {
    message: savedMessage,
    confidence,
    sentiment,
    autoEscalated,
    toolCalls,
  };
}

/**
 * Persist a final AI message that was already streamed (so callers don't
 * end up double-calling Claude). Used by the SSE branch when the response
 * was streamed token-by-token via runAiTurn's `stream` option.
 *
 * In the current implementation, runAiTurn already persists+notifies
 * after the stream completes, so this is effectively a no-op pass-through
 * exposed to make the SSE generator easier to reason about.
 */
export type { RunAiResult };
