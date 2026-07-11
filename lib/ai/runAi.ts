/**
 * Phase 3 shared AI persistence helper. Used by:
 *  - app/api/chat/route.ts (inline AI path: existing AI claim + AI auto-claim)
 *  - app/api/chat/ai-fallback/route.ts (queued sweep / cron)
 *  - lib/sessions/state.ts processDueAiClaims (cron sweep)
 *
 * Responsibilities (in order):
 *   1. compute sentiment + request-classification signals (pre-call, so the
 *      outbound transform can decide handoff replacement at stream time)
 *   2. buildPrompt
 *   3. callClaude (with tools when USE_AI_TOOLS=true)
 *      - tool calls are persisted as chat_events rows (type "tool_call")
 *      - streaming hook forwards tokens + tool_use events to the caller
 *   4. compute confidence; on a pausing turn the visible reply is REPLACED
 *      with the deterministic handoff copy (structural fix, 7/3/2026)
 *   5. insert messages row with confidence + sentiment
 *   6. fire Pusher new-message (session) + session-update (dashboard)
 *   7. auto-escalate (notify once per session; pause per Phase 2a policy)
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
  escalationWillPause,
  replyContainsProductContent,
  scrubNarration,
  shouldPauseForEscalation,
  shouldPreserveReplyWithHandoff,
} from "./escalationMode";
import {
  pauseAi,
  persistHandoffMessage,
  HANDOFF_HUMAN_COMING,
  HANDOFF_AFTER_HOURS,
} from "@/lib/sessions/aiPause";
import {
  classifyRouting,
  routingClassifierEnabled,
  routingDirective,
  shouldClassifyTurn,
} from "./classify";
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

async function hasPriorAiMessage(sessionId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: messages.id })
    .from(messages)
    .where(and(eq(messages.sessionId, sessionId), eq(messages.role, "ai")))
    .limit(1);
  return !!row;
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

  // Escalation signals hoisted BEFORE the model call: the outbound transform
  // needs the full pause verdict synchronously at stream time (structural
  // fix, 7/3/2026 — a pausing turn's visible reply is REPLACED with the
  // handoff copy, not scrubbed sentence by sentence). The customer's latest
  // message is persisted by the caller before runAiTurn, so computing
  // sentiment here matches the old post-generation result.
  const recentCustomer = await loadRecentCustomerMessages(sessionId);
  const sentiment = assessSentiment(recentCustomer);
  const isExplicitHumanRequest = EXPLICIT_HUMAN_REQUEST_PATTERNS.some((re) =>
    re.test(latestMessage)
  );
  const isTechAirServiceRequest =
    /tech.?air/i.test(latestMessage) &&
    /\b(service|send.+in|recharge|recertif|deployed|expir|replac|fix|broken|warranty|repair|fired)\b/i.test(latestMessage);

  // Populated by onToolCall as tool rounds complete. On the tools path the
  // final answer arrives in ONE onToken call AFTER every tool round, so the
  // transform below reads a fully-populated array at call time.
  const toolCalls: ToolCallEvent[] = [];

  // A reply is punt-equivalent when it contains a punt sentence, or (tools
  // path) when scrubbing narration leaves nothing — a reply that is nothing
  // but retrieval narration has nothing to answer with. Shared by the
  // transform's pause verdict and the escalation block so they cannot drift.
  const replyIsPuntEquivalent = (assessed: string): boolean =>
    detectPuntSentences(assessed, latestMessage).length > 0 ||
    (useTools && scrubNarration(assessed).cleaned.length === 0);

  const willPauseThisTurn = (assessed: string): boolean =>
    escalationWillPause({
      sentimentScore: sentiment.score,
      confidence: assessConfidence(assessed).confidence,
      isExplicitHumanRequest,
      isTechAirServiceRequest,
      toolDataOutcome: assessToolDataOutcome(toolCalls),
      replyIsPunt: replyIsPuntEquivalent(assessed),
      aiEscalatedViaTool: toolCalls.some(
        (tc) => tc.name === "escalate_to_human" && !tc.isError
      ),
    });

  // The VALIDATED reason from this turn's escalate_to_human tool call (the
  // handler normalizes unknown reasons to "unsupported" in its output);
  // null when the tool didn't fire. Drives the complex_fitment preserve
  // branch in transformOutbound.
  const toolEscalationReason = (): string | null => {
    const call = toolCalls.find(
      (tc) => tc.name === "escalate_to_human" && !tc.isError
    );
    if (!call) return null;
    const fromOutput = (call.output as { reason?: unknown } | null)?.reason;
    if (typeof fromOutput === "string") return fromOutput;
    const fromInput = (call.input as { reason?: unknown } | null)?.reason;
    return typeof fromInput === "string" ? fromInput : null;
  };

  // Single deterministic transform applied to BOTH the streamed and the
  // persisted copy so they stay byte-identical for ChatWidget reconciliation:
  //  1. rewriteStoreHours — canonical hours (item 1.1).
  //  2. Full handoff-copy replacement when this turn's escalation will pause
  //     the AI (structural fix, 7/3/2026): no punt phrasing, phone number,
  //     or self-serve redirect can reach the customer on a pausing turn,
  //     regardless of how the model worded it. Replaces the old sentence-
  //     level punt scrub, which required predicting every punt phrasing.
  //  3. Otherwise, narration-only scrub (bounded vocabulary, still safe to
  //     police per sentence).
  //  Only safe on the tools path, where the full final answer arrives in
  //  ONE onToken call (same limitation as the hours guard); the
  //  token-by-token non-tools path passes through and the escalation block
  //  appends the handoff message instead.
  const transformOutbound = (text: string): string => {
    const hoursFixed = rewriteStoreHours(text);
    if (!useTools) return hoursFixed;
    if (willPauseThisTurn(hoursFixed)) {
      const handoff = agentsOnline ? HANDOFF_HUMAN_COMING : HANDOFF_AFTER_HOURS;
      // Fitment preserve fix (7/11/2026): when the pause is caused solely by
      // the rule-mandated escalate_to_human(reason='complex_fitment') call
      // and the reply contains real product recommendations (data retrieved,
      // not a punt/non-answer), keep the model's content and append the
      // handoff line — full replacement was wiping the product options the
      // service_handoff rule requires the model to show. Every other pause
      // reason keeps full replacement.
      if (
        shouldPreserveReplyWithHandoff({
          toolEscalationReason: toolEscalationReason(),
          sentimentScore: sentiment.score,
          isExplicitHumanRequest,
          isTechAirServiceRequest,
          toolDataOutcome: assessToolDataOutcome(toolCalls),
          replyIsPunt: replyIsPuntEquivalent(hoursFixed),
          replyHasProductContent: replyContainsProductContent(hoursFixed),
        })
      ) {
        const cleaned = scrubNarration(hoursFixed).cleaned;
        if (cleaned.length > 0) return `${cleaned}\n\n${handoff}`;
      }
      return handoff;
    }
    return scrubNarration(hoursFixed).cleaned;
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

  // Phase 2b: Sonnet routes the FIRST AI turn of a conversation only. Any
  // classifier failure or low-confidence result returns null and the turn
  // proceeds exactly as the Haiku-only path (locked fallback, 7/9/2026 —
  // never an escalation trigger). Flag-gated; zero extra queries when off.
  let directive: string | null = null;
  let includeProductContext = false;
  if (routingClassifierEnabled()) {
    try {
      if (shouldClassifyTurn(await hasPriorAiMessage(sessionId))) {
        const classification = await classifyRouting(latestMessage, {
          requestId,
          sessionId,
        });
        if (classification) {
          directive = routingDirective(classification);
          // Full year/make/model fitment opener: pre-render the catalog
          // search into the prompt even in tool mode. The model frequently
          // escalates (complex_fitment) without searching first, and a
          // directive can't make it show products it never retrieved —
          // deterministic injection can (fitment preserve gate, 7/11/2026).
          includeProductContext =
            (classification.category === "tire_fitment" ||
              classification.category === "parts_fitment") &&
            classification.missingFields.length === 0;
        }
      }
    } catch (err) {
      // Defensive: even an unexpected throw in the gating query must not
      // break the turn — fall back to the unrouted path.
      log.warn("ai.classify.gate_failed", {
        requestId,
        sessionId,
        error: serializeError(err),
      });
    }
  }

  const { system, conversationMessages } = await buildPrompt(
    sessionId,
    latestMessage,
    pageContext as never,
    latestMessageRaw,
    agentsOnline,
    directive,
    { includeProductContext }
  );

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

  // `assessedText` is the hours-corrected but UNREPLACED reply — confidence
  // and punt detection run on what the model actually wrote (a replaced-away
  // hedge or punt must still count as an escalation signal). `aiResponse` is
  // the customer-facing copy: same transform the streamed copy already went
  // through in guardedStream.onToken (possibly the handoff copy verbatim on
  // a pausing turn), so the two stay byte-identical for ChatWidget
  // reconciliation.
  const assessedText = rewriteStoreHours(rawAiResponse);
  const aiResponse = transformOutbound(rawAiResponse);

  // TEMP DIAGNOSTIC (fitment preserve gate, 7/11/2026) — remove before merge.
  // On pausing turns, record what the model actually wrote and which preserve
  // signal gated the outcome, so gate failures are attributable.
  if (useTools && willPauseThisTurn(assessedText)) {
    log.info("ai.pause.reply_transform_debug", {
      requestId,
      sessionId,
      toolEscalationReason: toolEscalationReason(),
      replyIsPunt: replyIsPuntEquivalent(assessedText),
      replyHasProductContent: replyContainsProductContent(assessedText),
      toolDataOutcome: assessToolDataOutcome(toolCalls),
      preserved: aiResponse !== HANDOFF_HUMAN_COMING && aiResponse !== HANDOFF_AFTER_HOURS,
      rawExcerpt: assessedText.slice(0, 400),
    });
  }

  // Post-generation takeover check: a human may have claimed mid-stream.
  // If nothing was shown to the customer yet, abort without persisting so
  // the AI never barges into a human-owned conversation. If tokens already
  // streamed, persist so the transcript matches what the customer saw.
  if (!tokensEmitted && (await humanOwnsSession(sessionId))) {
    log.info("ai.run.aborted_human_takeover", { requestId, sessionId });
    throw makeHumanTakeoverError();
  }

  const confidence = assessConfidence(assessedText);

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
  const aiEscalatedViaTool = toolCalls.some(
    (tc) => tc.name === "escalate_to_human" && !tc.isError
  );

  let autoEscalated: RunAiResult["autoEscalated"] = null;
  // Phase 2a: a reply that punts the customer to the phone/contact form for
  // something the bot should have answered is an escalation trigger in its
  // own right — the punt phrasings ("suggest you call the shop…") often
  // score high on the confidence heuristic and would otherwise slip through
  // (observed live, 7/2/2026). Detection runs on the PRE-replacement text
  // via the same predicate the outbound transform used, so this block and
  // the visible reply always agree on whether the turn pauses.
  const isPassivePunt = replyIsPuntEquivalent(assessedText);
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
    // every time, notification stays deduped. On the tools path the saved
    // message already IS the handoff copy (transformOutbound replaced it),
    // so no separate handoff message is appended; the non-tools path can't
    // replace mid-stream, so it appends one instead.
    if (shouldPause) {
      try {
        await pauseAi(sessionId, reason);
        if (!useTools) {
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
