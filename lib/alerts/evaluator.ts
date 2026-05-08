/**
 * Threshold evaluator. Called from `app/api/cron/tick` once per minute.
 *
 * Pulls the configured thresholds, computes their current values, and
 * fires any breach whose cooldown has elapsed. Fan-out: insert
 * `alert_events` row, push Pusher event on the "alerts" channel, POST to
 * Slack, and stamp `alert_thresholds.last_fired_at`.
 *
 * All side effects are best-effort — errors are logged and never thrown,
 * so a single misbehaving threshold doesn't poison the others.
 */
import { db } from "@/lib/db";
import { alertEvents, alertThresholds, sessions, users } from "@/lib/db/schema";
import { and, eq, gte, sql } from "drizzle-orm";
import { getPusher } from "@/lib/pusher/server";
import { log, serializeError } from "@/lib/log";
import { sendSlackAlert } from "./notify";

export type AlertKind =
  | "queue_depth"
  | "ai_failure_rate_pct"
  | "no_agents_online_during_hours"
  | "ticket_sla_breach";

export interface EvaluationResult {
  kind: AlertKind;
  value: number;
  breached: boolean;
  message: string;
}

const HEARTBEAT_FRESH_MS = 90_000;

function compare(a: number, op: string, b: number): boolean {
  switch (op) {
    case ">":
      return a > b;
    case ">=":
      return a >= b;
    case "<":
      return a < b;
    case "<=":
      return a <= b;
    case "==":
      return a === b;
    default:
      return false;
  }
}

async function evalQueueDepth(): Promise<number> {
  const [row] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(sessions)
    .where(eq(sessions.status, "waiting"));
  return row?.c ?? 0;
}

async function evalAiFailureRatePct(windowMinutes = 60): Promise<number> {
  // % of AI messages in the recent window where the parent session went on
  // to record an `auto_escalated` event. Returns 0 when there are no AI
  // messages in the window so a quiet hour can't fire a "100%" alert.
  const since = new Date(Date.now() - windowMinutes * 60_000);
  const result = await db.execute(sql`
    WITH recent_ai AS (
      SELECT m.session_id
      FROM messages m
      WHERE m.role = 'ai' AND m.sent_at >= ${since}
    ),
    counts AS (
      SELECT
        COUNT(*)::int                       AS total,
        COUNT(*) FILTER (
          WHERE EXISTS (
            SELECT 1 FROM chat_events ce
            WHERE ce.session_id = recent_ai.session_id
              AND ce.type = 'auto_escalated'
          )
        )::int                              AS escalated
      FROM recent_ai
    )
    SELECT total, escalated FROM counts
  `);
  const arr = (result as unknown as { rows?: { total: number; escalated: number }[] }).rows
    ?? (Array.isArray(result) ? (result as { total: number; escalated: number }[]) : []);
  const row = arr[0];
  if (!row || row.total === 0) return 0;
  return Math.round((row.escalated / row.total) * 100);
}

async function evalTicketSlaBreachCount(): Promise<number> {
  // Number of tickets currently flagged as SLA-breached and not yet
  // resolved/closed. The cron sweep fires per-breach Slack/Pusher
  // unconditionally; this evaluator is the meta-alarm so a manager can
  // also page when N+ tickets are simultaneously past due.
  try {
    const result = await db.execute(sql`
      SELECT count(*)::int AS c
      FROM tickets
      WHERE sla_breached = true
        AND status NOT IN ('resolved','closed')
    `);
    const arr =
      (result as unknown as { rows?: { c: number }[] }).rows ??
      (Array.isArray(result) ? (result as { c: number }[]) : []);
    return arr[0]?.c ?? 0;
  } catch (error) {
    log.warn("alerts.eval_ticket_sla_breach_failed", {
      error: serializeError(error),
    });
    return 0;
  }
}

async function evalNoAgentsOnlineDuringHours(
  metadata: Record<string, unknown> | null
): Promise<{ value: number; inWindow: boolean }> {
  // value: 1 if NO agents online inside the configured business hours, else 0.
  // Outside the configured window we always return inWindow=false so the
  // comparator never fires.
  const hoursStart = String(metadata?.hoursStart ?? "09:00");
  const hoursEnd = String(metadata?.hoursEnd ?? "18:00");
  const now = new Date();
  const hh = now.getHours();
  const mm = now.getMinutes();
  const cur = hh * 60 + mm;
  const [sh, sm] = hoursStart.split(":").map((s) => parseInt(s, 10) || 0);
  const [eh, em] = hoursEnd.split(":").map((s) => parseInt(s, 10) || 0);
  const start = sh * 60 + sm;
  const end = eh * 60 + em;
  const inWindow = cur >= start && cur <= end;
  if (!inWindow) return { value: 0, inWindow: false };

  const cutoff = new Date(Date.now() - HEARTBEAT_FRESH_MS);
  const [row] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(users)
    .where(
      and(
        eq(users.isActive, true),
        eq(users.role, "support_agent"),
        gte(users.lastHeartbeatAt, cutoff)
      )
    );
  const onlineCount = row?.c ?? 0;
  return { value: onlineCount === 0 ? 1 : 0, inWindow: true };
}

/**
 * Evaluate every enabled threshold and fire any breach (subject to
 * cooldown). Returns the per-threshold results so callers can include
 * them in the cron response.
 */
export async function evaluateAlertThresholds(): Promise<EvaluationResult[]> {
  let thresholds: (typeof alertThresholds.$inferSelect)[] = [];
  try {
    thresholds = await db
      .select()
      .from(alertThresholds)
      .where(eq(alertThresholds.enabled, true));
  } catch (error) {
    log.warn("alerts.evaluator_load_failed", { error: serializeError(error) });
    return [];
  }

  const results: EvaluationResult[] = [];

  for (const t of thresholds) {
    try {
      let value = 0;
      let inWindow = true;
      switch (t.kind as AlertKind) {
        case "queue_depth":
          value = await evalQueueDepth();
          break;
        case "ai_failure_rate_pct":
          value = await evalAiFailureRatePct(60);
          break;
        case "no_agents_online_during_hours": {
          const r = await evalNoAgentsOnlineDuringHours(
            (t.metadata as Record<string, unknown> | null) ?? null
          );
          value = r.value;
          inWindow = r.inWindow;
          break;
        }
        case "ticket_sla_breach":
          value = await evalTicketSlaBreachCount();
          break;
        default:
          continue;
      }

      const thresholdNum = Number(t.threshold);
      const breached = inWindow && compare(value, t.comparator, thresholdNum);
      const message = breached
        ? `Current ${t.kind} = ${value}; threshold ${t.comparator} ${thresholdNum}.`
        : `OK (current ${t.kind} = ${value}).`;
      results.push({ kind: t.kind as AlertKind, value, breached, message });

      if (!breached) continue;

      // Cooldown gate.
      if (t.lastFiredAt) {
        const next = new Date(
          new Date(t.lastFiredAt).getTime() + t.cooldownMin * 60_000
        );
        if (Date.now() < next.getTime()) {
          log.info("alerts.cooldown_skip", {
            kind: t.kind,
            nextFireAt: next.toISOString(),
          });
          continue;
        }
      }

      // Persist event and stamp last_fired_at first so a Slack/Pusher
      // failure doesn't cause repeat fires on the next tick.
      let eventId: string | null = null;
      try {
        const [ev] = await db
          .insert(alertEvents)
          .values({
            thresholdId: t.id,
            kind: t.kind,
            value: String(value),
            message,
          })
          .returning({ id: alertEvents.id });
        eventId = ev?.id ?? null;
      } catch (error) {
        log.warn("alerts.event_insert_failed", {
          kind: t.kind,
          error: serializeError(error),
        });
      }

      try {
        await db
          .update(alertThresholds)
          .set({ lastFiredAt: new Date() })
          .where(eq(alertThresholds.id, t.id));
      } catch (error) {
        log.warn("alerts.last_fired_update_failed", {
          kind: t.kind,
          error: serializeError(error),
        });
      }

      // Pusher fan-out.
      try {
        const pusher = getPusher();
        await pusher.trigger("alerts", "alert-fired", {
          id: eventId,
          kind: t.kind,
          value,
          threshold: thresholdNum,
          comparator: t.comparator,
          message,
          firedAt: new Date().toISOString(),
        });
      } catch (error) {
        log.warn("alerts.pusher_failed", {
          kind: t.kind,
          error: serializeError(error),
        });
      }

      // Slack fan-out.
      await sendSlackAlert({
        kind: t.kind,
        comparator: t.comparator,
        threshold: thresholdNum,
        value,
        message,
      });
    } catch (error) {
      log.warn("alerts.evaluator_threshold_failed", {
        thresholdId: t.id,
        kind: t.kind,
        error: serializeError(error),
      });
    }
  }

  return results;
}
