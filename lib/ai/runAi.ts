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
import { messages, chatEvents, sessions } from "@/lib/db/schema";
import { and, eq, desc } from "drizzle-orm";
import { getPusher } from "@/lib/pusher/server";
import { sessionChannel, DASHBOARD_CHANNEL } from "@/lib/pusher/channels";
import { buildPrompt } from "./buildPrompt";
import {
  callClaude,
  CALL_CLAUDE_ERROR_MESSAGE,
  type ToolCallEvent,
} from "./callClaude";
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

/**
 * Typed error thrown when an AI turn is aborted because a human agent claimed
 * the session mid-turn. Callers should treat this as a clean no-op (the human
 * will reply), NOT as an AI failure that warrants a fallback message.
 */
export function makeHumanTakeoverError(): Error & { isHumanTakeover: true } {
  const err = new Error("AI turn aborted: human agent took over") as Error & {
    isHumanTakeover: true;
  };
  err.isHumanTakeover = true;
  return err;
}

export function isHumanTakeoverError(err: unknown): boolean {
  return (
    !!err &&
    typeof err === "object" &&
    (err as { isHumanTakeover?: boolean }).isHumanTakeover === true
  );
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

  // Track whether any tokens actually reached the SSE client. Used by the
  // post-generation takeover check: if nothing streamed, we can abort
  // cleanly; if the customer already saw text, persist it so the transcript
  // matches what was shown.
  let tokensEmitted = false;
  const guardedStream = stream
    ? {
        onToken: (text: string) => {
          tokensEmitted = true;
          stream.onToken(text);
        },
        onToolUse: stream.onToolUse,
      }
    : undefined;

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

  const isTechAirServiceRequest =
    /tech.?air/i.test(latestMessage) &&
    /\b(service|send.+in|recharge|recertif|deployed|expir|replac|fix|broken|warranty|repair|fired)\b/i.test(latestMessage);

  const aiResponse = await callClaude(system, conversationMessages, {
    ...(useTools
      ? {
          tools: toolCatalog,
          toolHandlers,
          ctx: { sessionId, requestId },
        }
      : {}),
    ...(guardedStream ? { stream: guardedStream } : {}),
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

  // Post-generation takeover check: a human may have claimed mid-stream.
  // If nothing was shown to the customer yet, abort without persisting so
  // the AI never barges into a human-owned conversation. If tokens already
  // streamed, persist so the transcript matches what the customer saw.
  if (!tokensEmitted && (await humanOwnsSession(sessionId))) {
    log.info("ai.run.aborted_human_takeover", { requestId, sessionId });
    throw makeHumanTakeoverError();
  }

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
    await pusher.trigger(sessionChannel(sessionId), "new-message", {
      id: savedMessage.id,
      role: "ai",
      content: savedMessage.content,
      sentAt: savedMessage.sentAt,
    });
    await pusher.trigger(DASHBOARD_CHANNEL, "session-update", {
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
  //
  // Five triggers (any one is sufficient):
  //  1. sentiment.score === -1     — 2+ frustrated messages in last 4
  //  2. confidence === "low"       — AI hedged on the answer
  //  3. aiEscalatedViaTool         — Claude called escalate_to_human tool
  //  4. isExplicitHumanRequest     — customer explicitly asked for a person
  //  5. isTechAirServiceRequest    — service routing (escalation is server-side
  //                                  because callClaude discards pre-tool text,
  //                                  so Claude just provides links; we escalate here)
  //
  // When the tool already fired escalateToHuman (trigger 3) we skip the
  // duplicate call to avoid double-clearing aiClaimDueAt and double-emitting
  // escalation-requested, but we still insert the auto_escalated chat event
  // and fire the correct per-session Pusher event so the widget can render
  // EmailCaptureForm or the connecting banner.
  const EXPLICIT_HUMAN_REQUEST_PATTERNS: RegExp[] = [
    /\b(real|actual|live) (human|person)\b/i,
    /\btalk to (a |an )?(human|person|agent|rep|representative|teammate|team\s*member|staff|employee|associate|someone)\b/i,
    /\bspeak (to|with) (a |an )?(human|person|agent|rep|representative|manager|teammate|team\s*member|staff|employee|associate|someone)\b/i,
    /\bchat with (a |an )?(human|person|agent|rep|representative|teammate|team\s*member|staff|someone)\b/i,
    /\bconnect (me )?(to|with) (a |an )?(human|person|agent|rep|representative|teammate|team\s*member|staff|someone)\b/i,
    /\bget (me )?(a |an )?(human|person|agent|rep|teammate|team\s*member|manager)\b/i,
    /\blive agent\b/i,
    /\bhuman agent\b/i,
    /\b(customer )?service rep(resentative)?\b/i,
  ];
  const aiEscalatedViaTool = toolCalls.some(
    (tc) => tc.name === "escalate_to_human" && !tc.isError
  );
  const isExplicitHumanRequest = EXPLICIT_HUMAN_REQUEST_PATTERNS.some((re) =>
    re.test(latestMessage)
  );

  let autoEscalated: RunAiResult["autoEscalated"] = null;
  const shouldEscalate =
    sentiment.score === -1 ||
    confidence.confidence === "low" ||
    aiEscalatedViaTool ||
    isExplicitHumanRequest ||
    isTechAirServiceRequest;
  if (shouldEscalate) {
    const already = await hasAutoEscalated(sessionId);
    if (!already) {
      const reason: "frustrated_customer" | "unsupported" | "explicit_request" | "tech_air_service" =
        sentiment.score === -1
          ? "frustrated_customer"
          : isExplicitHumanRequest
          ? "explicit_request"
          : isTechAirServiceRequest
          ? "tech_air_service"
          : "unsupported";
      // Skip escalateToHuman when the tool already called it this turn —
      // aiClaimDueAt was already cleared and escalation-requested already
      // fired on the dashboard channel.
      if (!aiEscalatedViaTool) {
        try {
          await escalateToHuman(sessionId, reason, "normal");
        } catch (err) {
          log.warn("ai.run.auto_escalate_failed", {
            requestId,
            sessionId,
            error: serializeError(err),
          });
        }
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
            aiEscalatedViaTool,
            isExplicitHumanRequest,
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
          await pusher.trigger(DASHBOARD_CHANNEL, "session-update", {
            sessionId,
            autoEscalated: true,
            reason,
          });
        } else {
          // No teammates available — ask the widget to render the
          // email-capture form.
          await pusher.trigger(sessionChannel(sessionId), "request-contact", {
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
 * Last-resort recovery when runAiTurn throws: persist a visible fallback AI
 * message and fan it out over Pusher so the customer never sees dead air.
 * Returns the saved message, or null if even the fallback insert failed
 * (callers should then surface an explicit error in the HTTP response).
 */
export async function persistFallbackAiMessage(
  sessionId: string,
  requestId?: string
): Promise<typeof messages.$inferSelect | null> {
  let saved: typeof messages.$inferSelect;
  try {
    const [row] = await db
      .insert(messages)
      .values({
        sessionId,
        role: "ai",
        content: CALL_CLAUDE_ERROR_MESSAGE,
        confidence: "low",
      })
      .returning();
    saved = row;
  } catch (err) {
    log.error("ai.fallback_message_persist_failed", {
      requestId,
      sessionId,
      error: serializeError(err),
    });
    return null;
  }

  try {
    const pusher = getPusher();
    await pusher.trigger(sessionChannel(sessionId), "new-message", {
      id: saved.id,
      role: "ai",
      content: saved.content,
      sentAt: saved.sentAt,
    });
    await pusher.trigger(DASHBOARD_CHANNEL, "session-update", {
      sessionId,
      lastMessage: saved.content,
      role: "ai",
      confidence: "low",
    });
  } catch (err) {
    log.warn("ai.fallback_message_pusher_failed", {
      requestId,
      sessionId,
      error: serializeError(err),
    });
  }

  return saved;
}

/**
 * True when a human agent currently owns the session. Checked by runAiTurn
 * before calling Claude and again before persisting so an in-flight AI turn
 * can't barge into a chat a human just took over.
 */
async function humanOwnsSession(sessionId: string): Promise<boolean> {
  const [row] = await db
    .select({ claimedByKind: sessions.claimedByKind })
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .limit(1);
  return row?.claimedByKind === "human";
}

export type { RunAiResult };
