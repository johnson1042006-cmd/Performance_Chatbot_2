/**
 * Ticket SLA helpers.
 *
 * `slaHoursToMs` is the source of truth for `due_at` math: ticket created
 * at + slaWindowsHours[priority] hours. Used by the auto-create pipeline,
 * the manual POST /api/tickets, and PATCH priority changes.
 *
 * `sweepBreachedTickets` is the cron tick's per-minute SLA sweeper. It
 * flips `sla_breached = true`, inserts an `alert_events` row per breach,
 * fans out Pusher `ticket-sla-breached`, and POSTs Slack via
 * `sendTicketSlaBreachAlert`. All side effects are best-effort and the
 * function never throws.
 */
import { db } from "@/lib/db";
import { alertEvents } from "@/lib/db/schema";
import { sql } from "drizzle-orm";
import { getPusher } from "@/lib/pusher/server";
import { log, serializeError } from "@/lib/log";
import { sendTicketSlaBreachAlert } from "@/lib/alerts/notify";
import type { TicketPriority } from "@/lib/db/schema";

export interface SlaWindowsHours {
  urgent: number;
  high: number;
  normal: number;
  low: number;
}

export const DEFAULT_SLA_WINDOWS: SlaWindowsHours = {
  urgent: 2,
  high: 4,
  normal: 24,
  low: 72,
};

const HOUR_MS = 60 * 60 * 1000;

export function slaHoursToMs(
  priority: TicketPriority,
  windows?: Partial<SlaWindowsHours> | null
): number {
  const w = { ...DEFAULT_SLA_WINDOWS, ...(windows ?? {}) };
  const hours = w[priority] ?? DEFAULT_SLA_WINDOWS[priority];
  // Clamp to a sane positive range so a misconfigured value doesn't put
  // due_at in the past on creation.
  const clamped = Math.max(1, Math.min(720, Math.round(hours)));
  return clamped * HOUR_MS;
}

interface BreachedRow {
  id: string;
  ticket_number: number;
  subject: string;
  priority: TicketPriority;
  due_at: string | Date;
}

function getRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === "object" && "rows" in result) {
    return ((result as { rows: T[] }).rows as T[]) ?? [];
  }
  return [];
}

/**
 * Per-tick sweep. Flips `sla_breached = true` on tickets whose `due_at`
 * has passed and that aren't already resolved/closed. Returns the number
 * of newly-breached rows.
 */
export async function sweepBreachedTickets(): Promise<number> {
  let breachedRows: BreachedRow[] = [];
  try {
    const result = await db.execute(sql`
      UPDATE tickets
      SET sla_breached = true,
          updated_at   = now()
      WHERE due_at IS NOT NULL
        AND due_at < now()
        AND status NOT IN ('resolved','closed')
        AND sla_breached = false
      RETURNING id, ticket_number, subject, priority, due_at
    `);
    breachedRows = getRows<BreachedRow>(result);
  } catch (error) {
    log.warn("tickets.sla_sweep_failed", { error: serializeError(error) });
    return 0;
  }

  if (breachedRows.length === 0) return 0;

  for (const row of breachedRows) {
    const dueAt = row.due_at instanceof Date ? row.due_at : new Date(row.due_at);
    const hoursPastDue = Math.max(
      0,
      Math.round((Date.now() - dueAt.getTime()) / HOUR_MS)
    );
    const subjectPreview = (row.subject ?? "").slice(0, 100);
    const message = `Ticket #${row.ticket_number} — ${subjectPreview} — ${hoursPastDue}h past due`;

    try {
      await db.insert(alertEvents).values({
        thresholdId: null,
        kind: "ticket_sla_breach",
        value: String(row.ticket_number),
        message,
      });
    } catch (error) {
      log.warn("tickets.sla_event_insert_failed", {
        ticketId: row.id,
        error: serializeError(error),
      });
    }

    try {
      const pusher = getPusher();
      await pusher.trigger("alerts", "ticket-sla-breached", {
        ticketId: row.id,
        ticketNumber: row.ticket_number,
        priority: row.priority,
        hoursPastDue,
        subject: subjectPreview,
      });
    } catch (error) {
      log.warn("tickets.sla_pusher_failed", {
        ticketId: row.id,
        error: serializeError(error),
      });
    }

    await sendTicketSlaBreachAlert({
      ticketId: row.id,
      ticketNumber: row.ticket_number,
      priority: row.priority,
      hoursPastDue,
      subject: subjectPreview,
    });
  }

  return breachedRows.length;
}
