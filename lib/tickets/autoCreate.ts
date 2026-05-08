/**
 * Auto-create a support ticket when a chat session closes in a state that
 * suggests follow-up is needed:
 *   - latest customer sentiment is negative,
 *   - or the session has an `auto_escalated` chat_event,
 *   - or the tagger persisted `resolved=false`.
 *
 * Mirrors `lib/ai/tagger.ts`:
 *   - In-process semaphore caps concurrent runs per Lambda.
 *   - Fire-and-forget — close paths never block on auto-create.
 *   - Failure is logged but never thrown.
 *
 * Test hook: `TICKET_AUTO_CREATE_TEST_MODE=1` short-circuits the recent-
 * messages query into a deterministic outcome so Playwright e2e specs can
 * assert "the ticket was created" without flaking on Anthropic latency or
 * tagger order-of-operations.
 */
import { db } from "@/lib/db";
import {
  chatEvents,
  knowledgeBase,
  messages,
  sessions,
  tickets,
  customerContacts,
} from "@/lib/db/schema";
import { and, asc, desc, eq, gt } from "drizzle-orm";
import { getPusher } from "@/lib/pusher/server";
import { log, serializeError } from "@/lib/log";
import { slaHoursToMs, type SlaWindowsHours } from "./sla";
import type {
  TicketPriority,
  TicketSource,
  Ticket,
} from "@/lib/db/schema";
import { sendTicketCreatedEmail } from "@/lib/email/templates/ticket-created";

const sem = { active: 0, max: 5 };

interface BotSettingsForTicketing {
  autoTicketOnEscalation?: boolean;
  autoTicketEmailEnabled?: boolean;
  slaWindowsHours?: Partial<SlaWindowsHours>;
}

const DEFAULT_TICKETING_SETTINGS: Required<BotSettingsForTicketing> = {
  autoTicketOnEscalation: true,
  autoTicketEmailEnabled: true,
  slaWindowsHours: { urgent: 2, high: 4, normal: 24, low: 72 },
};

async function loadTicketingSettings(): Promise<Required<BotSettingsForTicketing>> {
  try {
    const [row] = await db
      .select()
      .from(knowledgeBase)
      .where(eq(knowledgeBase.topic, "bot_settings"))
      .limit(1);
    if (!row) return DEFAULT_TICKETING_SETTINGS;
    const parsed = JSON.parse(row.content) as BotSettingsForTicketing;
    return {
      autoTicketOnEscalation:
        parsed.autoTicketOnEscalation ??
        DEFAULT_TICKETING_SETTINGS.autoTicketOnEscalation,
      autoTicketEmailEnabled:
        parsed.autoTicketEmailEnabled ??
        DEFAULT_TICKETING_SETTINGS.autoTicketEmailEnabled,
      slaWindowsHours: {
        ...DEFAULT_TICKETING_SETTINGS.slaWindowsHours,
        ...(parsed.slaWindowsHours ?? {}),
      },
    };
  } catch {
    return DEFAULT_TICKETING_SETTINGS;
  }
}

interface DecisionContext {
  hasNegativeSentiment: boolean;
  hasAutoEscalated: boolean;
  hasLowConfidence: boolean;
  unresolvedByTagger: boolean;
}

interface DecisionResult {
  shouldCreate: boolean;
  priority: TicketPriority;
}

/**
 * Decision matrix:
 *   - any of {neg-sentiment, auto-escalated, tagger.resolved===false} → create
 *   - urgent  if (neg sentiment) OR (auto-escalated && low confidence)
 *   - high    if auto-escalated OR low confidence
 *   - normal  otherwise (tagger said unresolved but no escalation signals)
 */
export function decideAutoTicket(ctx: DecisionContext): DecisionResult {
  const shouldCreate =
    ctx.hasNegativeSentiment || ctx.hasAutoEscalated || ctx.unresolvedByTagger;
  if (!shouldCreate) return { shouldCreate: false, priority: "normal" };

  let priority: TicketPriority;
  if (ctx.hasNegativeSentiment) priority = "urgent";
  else if (ctx.hasAutoEscalated) priority = "high";
  else if (ctx.hasLowConfidence) priority = "high";
  else priority = "normal";

  return { shouldCreate: true, priority };
}

function isTestMode(): boolean {
  return process.env.TICKET_AUTO_CREATE_TEST_MODE === "1";
}

interface FirstCustomerMessage {
  content: string;
}

async function loadFirstCustomerMessage(
  sessionId: string
): Promise<string | null> {
  const [row] = await db
    .select({ content: messages.content })
    .from(messages)
    .where(and(eq(messages.sessionId, sessionId), eq(messages.role, "customer")))
    .orderBy(asc(messages.sentAt))
    .limit(1);
  return (row as FirstCustomerMessage | undefined)?.content ?? null;
}

async function loadCustomerContact(
  sessionId: string
): Promise<{ email: string | null; name: string | null }> {
  // Prefer the most recent consented capture; fall back to the session's
  // mirrored copies.
  const [contact] = await db
    .select({
      email: customerContacts.email,
      name: customerContacts.name,
      consent: customerContacts.consent,
    })
    .from(customerContacts)
    .where(eq(customerContacts.sessionId, sessionId))
    .orderBy(desc(customerContacts.capturedAt))
    .limit(1);
  if (contact?.email && contact.consent) {
    return { email: contact.email, name: contact.name ?? null };
  }
  const [s] = await db
    .select({
      email: sessions.customerEmail,
      name: sessions.customerName,
    })
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .limit(1);
  return { email: s?.email ?? null, name: s?.name ?? null };
}

interface DbSessionRow {
  id: string;
  intent: string | null;
  resolved: boolean | null;
  customerEmail: string | null;
  customerName: string | null;
  startedAt: Date;
}

/**
 * The actual ticket-creation runner. Caller is responsible for
 * incrementing/decrementing the semaphore. Returns the inserted ticket
 * (or null when no ticket was created — already exists, settings off,
 * decision negative, etc.).
 */
export async function runAutoTicket(sessionId: string): Promise<Ticket | null> {
  const settings = await loadTicketingSettings();
  if (!settings.autoTicketOnEscalation) {
    log.info("tickets.auto_create_disabled_by_settings", { sessionId });
    return null;
  }

  // Dedupe — never create a second auto-ticket for the same session.
  const [existing] = await db
    .select({ id: tickets.id })
    .from(tickets)
    .where(eq(tickets.sessionId, sessionId))
    .limit(1);
  if (existing) {
    log.info("tickets.auto_create_dedupe_hit", {
      sessionId,
      ticketId: existing.id,
    });
    return null;
  }

  const [sessionRow] = (await db
    .select({
      id: sessions.id,
      intent: sessions.intent,
      resolved: sessions.resolved,
      customerEmail: sessions.customerEmail,
      customerName: sessions.customerName,
      startedAt: sessions.startedAt,
    })
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .limit(1)) as DbSessionRow[];
  if (!sessionRow) {
    log.warn("tickets.auto_create_session_missing", { sessionId });
    return null;
  }

  let decision: DecisionResult;

  if (isTestMode()) {
    // Deterministic outcome for e2e: any session that has a customer
    // message containing the marker word "frustrated" becomes urgent.
    const sample = await loadFirstCustomerMessage(sessionId);
    const lower = (sample ?? "").toLowerCase();
    if (lower.includes("frustrated") || lower.includes("angry")) {
      decision = { shouldCreate: true, priority: "urgent" };
    } else if (lower.includes("escalate")) {
      decision = { shouldCreate: true, priority: "high" };
    } else if (sessionRow.resolved === false) {
      decision = { shouldCreate: true, priority: "normal" };
    } else {
      decision = { shouldCreate: false, priority: "normal" };
    }
  } else {
    // Look up the recent escalation/sentiment signals.
    let hasNegativeSentiment = false;
    let hasLowConfidence = false;
    try {
      const recent = await db
        .select({
          sentiment: messages.sentiment,
          confidence: messages.confidence,
        })
        .from(messages)
        .where(eq(messages.sessionId, sessionId))
        .orderBy(desc(messages.sentAt))
        .limit(20);
      for (const m of recent) {
        if (m.sentiment !== null && m.sentiment !== undefined && m.sentiment <= -1) {
          hasNegativeSentiment = true;
        }
        if (m.confidence === "low") hasLowConfidence = true;
      }
    } catch (error) {
      log.warn("tickets.auto_create_signals_load_failed", {
        sessionId,
        error: serializeError(error),
      });
    }

    let hasAutoEscalated = false;
    try {
      const sinceCutoff = new Date(
        sessionRow.startedAt instanceof Date
          ? sessionRow.startedAt.getTime() - 1000
          : Date.now() - 24 * 60 * 60 * 1000
      );
      const events = await db
        .select({ type: chatEvents.type })
        .from(chatEvents)
        .where(
          and(
            eq(chatEvents.sessionId, sessionId),
            gt(chatEvents.createdAt, sinceCutoff)
          )
        );
      hasAutoEscalated = events.some((e) => e.type === "auto_escalated");
    } catch (error) {
      log.warn("tickets.auto_create_events_load_failed", {
        sessionId,
        error: serializeError(error),
      });
    }

    decision = decideAutoTicket({
      hasNegativeSentiment,
      hasAutoEscalated,
      hasLowConfidence,
      unresolvedByTagger: sessionRow.resolved === false,
    });
  }

  if (!decision.shouldCreate) {
    log.info("tickets.auto_create_decision_skip", { sessionId });
    return null;
  }

  // Subject — first customer message, sliced to 120 chars.
  const firstMsg = await loadFirstCustomerMessage(sessionId);
  const subject = (
    firstMsg && firstMsg.trim().length > 0
      ? firstMsg.trim()
      : "Follow-up requested from chat"
  ).slice(0, 120);

  const contact = await loadCustomerContact(sessionId);

  const dueAt = new Date(
    Date.now() + slaHoursToMs(decision.priority, settings.slaWindowsHours)
  );

  let inserted: Ticket | null = null;
  try {
    const rows = (await db
      .insert(tickets)
      .values({
        sessionId,
        subject,
        status: "open",
        priority: decision.priority,
        category: sessionRow.intent ?? null,
        source: "auto" as TicketSource,
        customerEmail: contact.email,
        customerName: contact.name,
        dueAt,
        metadata: {
          autoCreatedFromSession: sessionId,
          decision: { ...decision },
        },
      })
      .returning()) as Ticket[];
    inserted = rows[0] ?? null;
  } catch (error) {
    log.warn("tickets.auto_create_insert_failed", {
      sessionId,
      error: serializeError(error),
    });
    return null;
  }
  if (!inserted) return null;

  // Log a chat_events row for the timeline.
  try {
    await db.insert(chatEvents).values({
      sessionId,
      type: "ticket_created",
      metadata: {
        ticketId: inserted.id,
        ticketNumber: inserted.ticketNumber,
        source: "auto",
        priority: decision.priority,
      },
    });
  } catch (error) {
    log.warn("tickets.auto_create_chat_event_failed", {
      ticketId: inserted.id,
      error: serializeError(error),
    });
  }

  // Real-time fan-out.
  try {
    const pusher = getPusher();
    await pusher.trigger("alerts", "ticket-created", {
      ticketId: inserted.id,
      ticketNumber: inserted.ticketNumber,
      priority: inserted.priority,
      sessionId,
      subject: inserted.subject,
    });
  } catch (error) {
    log.warn("tickets.auto_create_pusher_failed", {
      ticketId: inserted.id,
      error: serializeError(error),
    });
  }

  // Best-effort customer email.
  if (
    settings.autoTicketEmailEnabled &&
    contact.email &&
    inserted.customerEmail
  ) {
    void sendTicketCreatedEmail({
      ticket: inserted,
      slaWindowHours: Math.round(
        slaHoursToMs(decision.priority, settings.slaWindowsHours) /
          (60 * 60 * 1000)
      ),
    }).catch((error) => {
      log.warn("tickets.auto_create_email_failed", {
        ticketId: inserted.id,
        error: serializeError(error),
      });
    });
  }

  return inserted;
}

/**
 * Fire-and-forget queue entry. Drops if the per-instance semaphore is
 * full so close paths cannot stack up. Safe to call from anywhere.
 */
export function enqueueAutoTicket(sessionId: string): void {
  if (sem.active >= sem.max) {
    log.info("tickets.auto_create_semaphore_skip", {
      sessionId,
      active: sem.active,
      max: sem.max,
    });
    return;
  }
  sem.active += 1;
  void runAutoTicket(sessionId)
    .catch((error) => {
      log.warn("tickets.auto_create_failed", {
        sessionId,
        error: serializeError(error),
      });
    })
    .finally(() => {
      sem.active = Math.max(0, sem.active - 1);
    });
}

/**
 * Test-only helper — wait for the semaphore to drain. Mirrors
 * `_drainForTests` in lib/ai/tagger.ts.
 */
export async function _drainForTests(timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (sem.active > 0 && Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 25));
  }
}
