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
import { rewriteStoreHours } from "./storeHours";
import { assessConfidence, assessSentiment } from "./quality";
import {
  assessToolDataOutcome,
  containsOffer,
  decideEscalationReason,
  detectPuntSentences,
  replyAlreadyReadsAsHandoff,
  scrubReply,
  shouldPauseForEscalation,
} from "./escalationMode";
import {
  pauseAi,
  persistHandoffMessage,
  HANDOFF_HUMAN_COMING,
  HANDOFF_AFTER_HOURS,
} from "@/lib/sessions/aiPause";
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
  autoEscalated: {
    reason: string;
    agentsOnline: boolean;
    /** Phase 2a: true when this escalation also paused the session's AI. */
    paused: boolean;
  } | null;
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

/**
 * The AI message BEFORE this turn's reply — used by the mode (a)/(b) split
 * to detect whether the bot previously OFFERED the information it now can't
 * deliver. Only queried on the low-confidence/no-data branch.
 */
async function loadPreviousAiMessage(
  sessionId: string,
  excludeMessageId: string
): Promise<string | null> {
  const rows = await db
    .select({ id: messages.id, content: messages.content })
    .from(messages)
    .where(and(eq(messages.sessionId, sessionId), eq(messages.role, "ai")))
    .orderBy(desc(messages.sentAt))
    .limit(2);
  const prior = rows.find((r) => r.id !== excludeMessageId);
  return prior?.content ?? null;
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
  const useTools = aiToolsEnabled();

  // Single deterministic transform applied to BOTH the streamed and the
  // persisted copy so they stay byte-identical for ChatWidget reconciliation:
  //  1. rewriteStoreHours — canonical hours (item 1.1).
  //  2. scrubReply — remove passive-punt and search-narration sentences
  //     (Phase 2a): prompt rules don't reliably stop the model from writing
  //     "give the team a call at 303-744-2011" even when escalation fires
  //     underneath, so the sentence is stripped from the visible reply.
  //     Sentence-level scrubbing is only safe on the tools path, where the
  //     full final answer arrives in ONE onToken call (same limitation as
  //     the hours guard); the token-by-token non-tools path skips it.
  //  3. If scrubbing empties the reply entirely (the whole reply was a
  //     punt), substitute the active-handoff copy — the handoff-append step
  //     below then sees the reply already reads as a handoff and skips the
  //     duplicate.
  const transformOutbound = (text: string): string => {
    const hoursFixed = rewriteStoreHours(text);
    if (!useTools) return hoursFixed;
    const { cleaned } = scrubReply(hoursFixed, latestMessage);
    if (cleaned.length > 0) return cleaned;
    return agentsOnline ? HANDOFF_HUMAN_COMING : HANDOFF_AFTER_HOURS;
  };

  // Track whether any tokens actually reached the SSE client. Used by the
  // post-generation takeover check: if nothing streamed, we can abort
  // cleanly; if the customer already saw text, persist it so the transcript
  // matches what was shown.
  let tokensEmitted = false;
  const guardedStream = stream
    ? {
        onToken: (text: string) => {
          tokensEmitted = true;
          // Correct the STREAMED copy with the same transform applied to the
          // persisted copy below, so the live text byte-matches the saved
          // message. ChatWidget.mergeRealMessage reconciles the streaming bubble
          // against the Pusher message by exact content equality; if the two
          // differed it would show the streamed (wrong) text AND a duplicate
          // corrected bubble. The tools path emits the full final answer in one
          // onToken call, so the whole reply is visible here.
          stream.onToken(transformOutbound(text));
        },
        onToolUse: stream.onToolUse,
      }
    : undefined;

  const { system, conversationMessages } = await buildPrompt(
    sessionId,
    latestMessage,
    pageContext as never,
    latestMessageRaw,
    agentsOnline
  );

  const toolCalls: ToolCallEvent[] = [];

  const isTechAirServiceRequest =
    /tech.?air/i.test(latestMessage) &&
    /\b(service|send.+in|recharge|recertif|deployed|expir|replac|fix|broken|warranty|repair|fired)\b/i.test(latestMessage);

  const rawAiResponse = await callClaude(system, conversationMessages, {
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

  // `assessedText` is the hours-corrected but UN-scrubbed reply — confidence
  // and punt detection run on what the model actually wrote (a scrubbed-away
  // hedge or punt sentence must still count as an escalation signal).
  // `aiResponse` is the customer-facing copy: same transform the streamed
  // copy already went through in guardedStream.onToken, so the two stay
  // byte-identical for ChatWidget reconciliation.
  const assessedText = rewriteStoreHours(rawAiResponse);
  const aiResponse = transformOutbound(rawAiResponse);

  // Post-generation takeover check: a human may have claimed mid-stream.
  // If nothing was shown to the customer yet, abort without persisting so
  // the AI never barges into a human-owned conversation. If tokens already
  // streamed, persist so the transcript matches what the customer saw.
  if (!tokensEmitted && (await humanOwnsSession(sessionId))) {
    log.info("ai.run.aborted_human_takeover", { requestId, sessionId });
    throw makeHumanTakeoverError();
  }

  const confidence = assessConfidence(assessedText);
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
  // Phase 2a: a reply that punts the customer to the phone/contact form for
  // something the bot should have answered is an escalation trigger in its
  // own right — the punt phrasings ("suggest you call the shop…") often
  // score high on the confidence heuristic and would otherwise slip through
  // (observed live, 7/2/2026). Detection runs on the PRE-scrub text: the
  // punt sentence has already been stripped from aiResponse.
  const isPassivePunt =
    detectPuntSentences(assessedText, latestMessage).length > 0;
  const shouldEscalate =
    sentiment.score === -1 ||
    confidence.confidence === "low" ||
    aiEscalatedViaTool ||
    isExplicitHumanRequest ||
    isTechAirServiceRequest ||
    isPassivePunt;
  if (shouldEscalate) {
    // Phase 2a mode split. The two new reasons refine what used to collapse
    // into "unsupported": mode (a) no_data — the bot has nothing to answer
    // with; mode (b) undeliverable_offer — same, but the bot's previous
    // message offered the info it now can't deliver. The prior-message
    // lookup only runs on that branch, so other triggers cost no extra query.
    const toolDataOutcome = assessToolDataOutcome(toolCalls);
    const baseTriggerHit =
      sentiment.score === -1 || isExplicitHumanRequest || isTechAirServiceRequest;
    let priorAiOffer = false;
    if (
      !baseTriggerHit &&
      ((confidence.confidence === "low" && toolDataOutcome !== "got_data") ||
        isPassivePunt)
    ) {
      priorAiOffer = containsOffer(
        await loadPreviousAiMessage(sessionId, savedMessage.id)
      );
    }
    const reason = decideEscalationReason({
      sentimentScore: sentiment.score,
      confidence: confidence.confidence,
      isExplicitHumanRequest,
      isTechAirServiceRequest,
      toolDataOutcome,
      priorAiOffer,
      replyIsPunt: isPassivePunt,
    });
    // Pause policy (Antonio 7/2/2026): pause on no_data, undeliverable_offer,
    // explicit_request, frustrated_customer, and tool-initiated escalations;
    // bare low confidence with data in hand stays notify-only.
    const shouldPause = shouldPauseForEscalation(reason, aiEscalatedViaTool);

    const already = await hasAutoEscalated(sessionId);
    if (!already) {
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
            isPassivePunt,
            toolDataOutcome,
            paused: shouldPause,
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

      autoEscalated = { reason, agentsOnline, paused: shouldPause };
    }

    // Pause even when the once-per-session notify already fired (e.g. the
    // bot hit a second wall after a pause timed out) — suppression must hold
    // every time, notification stays deduped. The active-handoff message is
    // skipped when the model's own reply already reads as a handoff.
    if (shouldPause) {
      try {
        await pauseAi(sessionId, reason);
        if (!replyAlreadyReadsAsHandoff(aiResponse)) {
          await persistHandoffMessage(sessionId, agentsOnline);
        }
      } catch (err) {
        log.warn("ai.run.pause_failed", {
          requestId,
          sessionId,
          error: serializeError(err),
        });
      }
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
