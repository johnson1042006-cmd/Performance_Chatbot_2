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

/**
 * GET /api/admin/csat?days=30
 *
 * Returns CSAT roll-ups for the dashboard CSAT card and the per-agent
 * leaderboard. Always reports a numeric `csat_pct` (0 when there's no
 * feedback yet) and an `aiHandledCleanlyPct` companion metric covering
 * sessions that finished without auto-escalation, low confidence, frustrated
 * customer signals, or thumbs-down feedback.
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

    const totals = getRows<{
      total: number;
      thumbs_up: number;
      thumbs_down: number;
    }>(
      await db.execute(sql`
        SELECT
          COUNT(*)::int                                       AS total,
          COUNT(*) FILTER (WHERE rating = 'up')::int          AS thumbs_up,
          COUNT(*) FILTER (WHERE rating = 'down')::int        AS thumbs_down
        FROM feedback
        WHERE submitted_at >= now() - (${days}::int * interval '1 day')
      `)
    );

    const total = totals[0]?.total ?? 0;
    const thumbsUp = totals[0]?.thumbs_up ?? 0;
    const thumbsDown = totals[0]?.thumbs_down ?? 0;
    const csatPct = total > 0 ? Math.round((thumbsUp / total) * 100) : 0;

    const recentComments = getRows<{
      session_id: string;
      rating: string;
      comment: string;
      submitted_at: string;
      customer_email: string | null;
    }>(
      await db.execute(sql`
        SELECT
          f.session_id::text         AS session_id,
          f.rating                    AS rating,
          f.comment                   AS comment,
          f.submitted_at              AS submitted_at,
          s.customer_email            AS customer_email
        FROM feedback f
        JOIN sessions s ON s.id = f.session_id
        WHERE f.comment IS NOT NULL
          AND length(trim(f.comment)) > 0
          AND f.submitted_at >= now() - (${days}::int * interval '1 day')
        ORDER BY f.submitted_at DESC
        LIMIT 10
      `)
    );

    const perAgent = getRows<{
      agent_id: string | null;
      agent_name: string | null;
      total: number;
      thumbs_up: number;
      thumbs_down: number;
      csat_pct: number;
    }>(
      await db.execute(sql`
        SELECT
          s.claimed_by_user_id::text                            AS agent_id,
          u.name                                                AS agent_name,
          COUNT(*)::int                                          AS total,
          COUNT(*) FILTER (WHERE f.rating = 'up')::int           AS thumbs_up,
          COUNT(*) FILTER (WHERE f.rating = 'down')::int         AS thumbs_down,
          CASE WHEN COUNT(*) > 0
               THEN ROUND(
                 (COUNT(*) FILTER (WHERE f.rating = 'up')::numeric * 100)
                 / COUNT(*)::numeric
               )::int
               ELSE 0 END                                        AS csat_pct
        FROM feedback f
        JOIN sessions s ON s.id = f.session_id
        LEFT JOIN users u ON u.id = s.claimed_by_user_id
        WHERE f.submitted_at >= now() - (${days}::int * interval '1 day')
          AND s.claimed_by_user_id IS NOT NULL
        GROUP BY s.claimed_by_user_id, u.name
        ORDER BY total DESC
      `)
    );

    const dailyPct = getRows<{
      date: string;
      pct: number;
      count: number;
    }>(
      await db.execute(sql`
        SELECT
          to_char(date_trunc('day', submitted_at), 'YYYY-MM-DD') AS date,
          CASE WHEN COUNT(*) > 0
               THEN ROUND(
                 (COUNT(*) FILTER (WHERE rating = 'up')::numeric * 100)
                 / COUNT(*)::numeric
               )::int
               ELSE 0 END                                       AS pct,
          COUNT(*)::int                                          AS count
        FROM feedback
        WHERE submitted_at >= now() - (${days}::int * interval '1 day')
        GROUP BY 1
        ORDER BY 1
      `)
    );

    // AI Handled Cleanly %: sessions where AI handled the chat without any
    // signal of trouble. We measure it for the same window.
    const aiHandled = getRows<{
      total: number;
      cleanly: number;
    }>(
      await db.execute(sql`
        WITH window_sessions AS (
          SELECT s.id, s.claimed_by_kind
          FROM sessions s
          WHERE s.started_at >= now() - (${days}::int * interval '1 day')
            AND s.claimed_by_kind = 'ai'
        ),
        flags AS (
          SELECT
            ws.id,
            EXISTS (
              SELECT 1 FROM chat_events ce
              WHERE ce.session_id = ws.id AND ce.type = 'auto_escalated'
            )                                                          AS escalated,
            EXISTS (
              SELECT 1 FROM messages m
              WHERE m.session_id = ws.id
                AND m.role = 'ai'
                AND (m.confidence = 'low' OR m.sentiment = -1)
            )                                                          AS bad_signal,
            EXISTS (
              SELECT 1 FROM feedback f
              WHERE f.session_id = ws.id AND f.rating = 'down'
            )                                                          AS thumbs_down
          FROM window_sessions ws
        )
        SELECT
          COUNT(*)::int                                                  AS total,
          COUNT(*) FILTER (
            WHERE NOT escalated AND NOT bad_signal AND NOT thumbs_down
          )::int                                                         AS cleanly
        FROM flags
      `)
    );

    const aiTotal = aiHandled[0]?.total ?? 0;
    const aiCleanly = aiHandled[0]?.cleanly ?? 0;
    const aiHandledCleanlyPct =
      aiTotal > 0 ? Math.round((aiCleanly / aiTotal) * 100) : 0;

    return NextResponse.json({
      total_responses: total,
      thumbs_up: thumbsUp,
      thumbs_down: thumbsDown,
      csat_pct: csatPct,
      recent_comments: recentComments,
      per_agent: perAgent,
      daily_pct: dailyPct,
      ai_handled_cleanly_pct: aiHandledCleanlyPct,
      ai_handled_total: aiTotal,
      ai_handled_cleanly: aiCleanly,
      days,
    });
  } catch (error) {
    log.error("admin.csat_failed", { requestId, error: serializeError(error) });
    return NextResponse.json({ error: "Failed to fetch CSAT" }, { status: 500 });
  }
}
