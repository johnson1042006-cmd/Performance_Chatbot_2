import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { requireManager } from "@/lib/auth/requireManager";
import { log, serializeError } from "@/lib/log";

export const dynamic = "force-dynamic";

function getRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === "object" && "rows" in result) {
    return (result as { rows: T[] }).rows;
  }
  return [];
}

interface SummaryRow {
  open_count: number;
  total_in_window: number;
  breached_in_window: number;
  resolved_in_window: number;
  avg_resolution_seconds: number | null;
}

interface CategoryRow {
  category: string | null;
  count: number;
}

interface AgentRow {
  agent_id: string;
  name: string;
  open_count: number;
  resolved_count: number;
  breached_count: number;
  avg_resolution_seconds: number | null;
}

interface DailyOpenRow {
  d: string | Date;
  open_count: number;
}

/**
 * GET /api/admin/tickets/stats?days=30
 *
 * Aggregated ticket health metrics for the manager dashboard. Manager-
 * only. Mirrors the layout of /api/admin/agent-stats.
 *
 * Response shape:
 * {
 *   openCount, breachRatePct, avgResolutionHours,
 *   byCategory: [{category, count}],
 *   byAgent:    [{agentId, name, openCount, resolvedCount, breachedCount, avgResolutionHours}],
 *   sparkline:  [{date, openCount}]
 * }
 */
export async function GET(req: NextRequest) {
  const requestId = crypto.randomUUID();
  try {
    const guard = await requireManager();
    if (guard instanceof NextResponse) return guard;

    const url = new URL(req.url);
    const days = Math.max(
      1,
      Math.min(365, parseInt(url.searchParams.get("days") ?? "30", 10) || 30)
    );

    const summaryRows = getRows<SummaryRow>(
      await db.execute(sql`
        WITH window_t AS (
          SELECT *
          FROM tickets
          WHERE created_at >= now() - (${days}::int * interval '1 day')
        )
        SELECT
          (SELECT count(*)::int FROM tickets
            WHERE status NOT IN ('resolved','closed'))                    AS open_count,
          (SELECT count(*)::int FROM window_t)                            AS total_in_window,
          (SELECT count(*)::int FROM window_t WHERE sla_breached = true)  AS breached_in_window,
          (SELECT count(*)::int FROM window_t
            WHERE status IN ('resolved','closed') AND resolved_at IS NOT NULL) AS resolved_in_window,
          (SELECT AVG(EXTRACT(EPOCH FROM (resolved_at - created_at)))::int
             FROM window_t
             WHERE resolved_at IS NOT NULL)                               AS avg_resolution_seconds
      `)
    );
    const summary = summaryRows[0] ?? {
      open_count: 0,
      total_in_window: 0,
      breached_in_window: 0,
      resolved_in_window: 0,
      avg_resolution_seconds: null,
    };

    const categoryRows = getRows<CategoryRow>(
      await db.execute(sql`
        SELECT category, count(*)::int AS count
        FROM tickets
        WHERE created_at >= now() - (${days}::int * interval '1 day')
        GROUP BY category
        ORDER BY count DESC
      `)
    );

    const agentRows = getRows<AgentRow>(
      await db.execute(sql`
        SELECT
          u.id::text AS agent_id,
          u.name     AS name,
          COALESCE(SUM(CASE WHEN t.status NOT IN ('resolved','closed') THEN 1 ELSE 0 END), 0)::int AS open_count,
          COALESCE(SUM(CASE WHEN t.status IN ('resolved','closed') THEN 1 ELSE 0 END), 0)::int     AS resolved_count,
          COALESCE(SUM(CASE WHEN t.sla_breached = true THEN 1 ELSE 0 END), 0)::int                  AS breached_count,
          AVG(
            CASE WHEN t.resolved_at IS NOT NULL
                 THEN EXTRACT(EPOCH FROM (t.resolved_at - t.created_at))
                 ELSE NULL END
          )::int AS avg_resolution_seconds
        FROM users u
        LEFT JOIN tickets t
          ON t.assigned_to = u.id
         AND t.created_at >= now() - (${days}::int * interval '1 day')
        WHERE u.role IN ('support_agent','store_manager') AND u.is_active = true
        GROUP BY u.id, u.name
        ORDER BY open_count DESC, resolved_count DESC, u.name
      `)
    );

    // 7-day open-count sparkline (uses min(days, 30) for resolution).
    const sparkRows = getRows<DailyOpenRow>(
      await db.execute(sql`
        WITH series AS (
          SELECT generate_series(
            (now() - (${Math.min(days, 30)}::int - 1) * interval '1 day')::date,
            now()::date,
            interval '1 day'
          )::date AS d
        )
        SELECT
          s.d                                                            AS d,
          (SELECT count(*)::int FROM tickets t
             WHERE t.created_at <= s.d + interval '1 day'
               AND (t.resolved_at IS NULL OR t.resolved_at > s.d + interval '1 day')
               AND (t.closed_at   IS NULL OR t.closed_at   > s.d + interval '1 day'))
            AS open_count
        FROM series s
        ORDER BY s.d
      `)
    );

    const breachRatePct =
      summary.total_in_window > 0
        ? Math.round(
            (summary.breached_in_window / summary.total_in_window) * 100
          )
        : 0;
    const avgResolutionHours =
      summary.avg_resolution_seconds !== null &&
      summary.avg_resolution_seconds !== undefined
        ? Math.round((summary.avg_resolution_seconds / 3600) * 10) / 10
        : null;

    return NextResponse.json({
      days,
      openCount: summary.open_count,
      totalInWindow: summary.total_in_window,
      resolvedInWindow: summary.resolved_in_window,
      breachedInWindow: summary.breached_in_window,
      breachRatePct,
      avgResolutionHours,
      byCategory: categoryRows.map((r) => ({
        category: r.category ?? "uncategorized",
        count: r.count,
      })),
      byAgent: agentRows.map((r) => ({
        agentId: r.agent_id,
        name: r.name,
        openCount: r.open_count,
        resolvedCount: r.resolved_count,
        breachedCount: r.breached_count,
        avgResolutionHours:
          r.avg_resolution_seconds !== null &&
          r.avg_resolution_seconds !== undefined
            ? Math.round((r.avg_resolution_seconds / 3600) * 10) / 10
            : null,
      })),
      sparkline: sparkRows.map((r) => ({
        date:
          r.d instanceof Date
            ? r.d.toISOString().slice(0, 10)
            : String(r.d).slice(0, 10),
        openCount: r.open_count,
      })),
    });
  } catch (error) {
    log.error("admin.tickets_stats_failed", {
      requestId,
      error: serializeError(error),
    });
    return NextResponse.json(
      { error: "Failed to fetch ticket stats" },
      { status: 500 }
    );
  }
}
