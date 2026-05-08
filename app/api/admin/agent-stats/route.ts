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

interface AgentStat {
  agent_id: string;
  name: string;
  chats_handled: number;
  avg_first_response_seconds: number | null;
  avg_handle_time_seconds: number | null;
  csat_pct: number;
  release_rate: number;
  escalations_taken: number;
}

/**
 * GET /api/admin/agent-stats?days=30
 *
 * Per-agent productivity rollup. All stats are scoped to the rolling
 * window. `chatsHandled` counts distinct sessions where the agent
 * recorded a `claimed_by_human` event.
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

    const rows = getRows<AgentStat>(
      await db.execute(sql`
        WITH window_events AS (
          SELECT *
          FROM chat_events
          WHERE created_at >= now() - (${days}::int * interval '1 day')
        ),
        claimed AS (
          SELECT actor_user_id AS agent_id,
                 session_id,
                 created_at AS claimed_event_at
          FROM window_events
          WHERE type = 'claimed_by_human' AND actor_user_id IS NOT NULL
        ),
        first_agent_msg AS (
          SELECT m.session_id, MIN(m.sent_at) AS first_at
          FROM messages m
          WHERE m.role = 'agent'
          GROUP BY m.session_id
        ),
        per_session AS (
          SELECT
            c.agent_id,
            c.session_id,
            EXTRACT(EPOCH FROM (fam.first_at - c.claimed_event_at)) AS first_resp_seconds,
            CASE WHEN s.closed_at IS NOT NULL AND s.claimed_at IS NOT NULL
                 THEN EXTRACT(EPOCH FROM (s.closed_at - s.claimed_at))
                 ELSE NULL END AS handle_seconds
          FROM claimed c
          JOIN sessions s ON s.id = c.session_id
          LEFT JOIN first_agent_msg fam ON fam.session_id = c.session_id
        ),
        feedback_per_agent AS (
          SELECT s.claimed_by_user_id AS agent_id,
                 COUNT(*)::int AS total,
                 COUNT(*) FILTER (WHERE f.rating = 'up')::int AS up
          FROM feedback f
          JOIN sessions s ON s.id = f.session_id
          WHERE f.submitted_at >= now() - (${days}::int * interval '1 day')
            AND s.claimed_by_user_id IS NOT NULL
          GROUP BY s.claimed_by_user_id
        ),
        releases AS (
          SELECT actor_user_id AS agent_id, COUNT(*)::int AS releases
          FROM window_events
          WHERE type = 'released_to_queue' AND actor_user_id IS NOT NULL
          GROUP BY actor_user_id
        ),
        claims_count AS (
          SELECT actor_user_id AS agent_id, COUNT(*)::int AS claims
          FROM window_events
          WHERE type = 'claimed_by_human' AND actor_user_id IS NOT NULL
          GROUP BY actor_user_id
        ),
        escalations AS (
          SELECT s.claimed_by_user_id AS agent_id,
                 COUNT(DISTINCT s.id)::int AS taken
          FROM sessions s
          WHERE s.claimed_by_user_id IS NOT NULL
            AND s.started_at >= now() - (${days}::int * interval '1 day')
            AND EXISTS (
              SELECT 1 FROM chat_events e
              WHERE e.session_id = s.id AND e.type = 'auto_escalated'
            )
          GROUP BY s.claimed_by_user_id
        )
        SELECT
          u.id::text                                                  AS agent_id,
          u.name                                                      AS name,
          COALESCE(cc.claims, 0)                                      AS chats_handled,
          ROUND(AVG(ps.first_resp_seconds))::int                      AS avg_first_response_seconds,
          ROUND(AVG(ps.handle_seconds))::int                          AS avg_handle_time_seconds,
          CASE WHEN COALESCE(fpa.total, 0) > 0
               THEN ROUND((fpa.up::numeric * 100) / fpa.total::numeric)::int
               ELSE 0 END                                             AS csat_pct,
          CASE WHEN COALESCE(cc.claims, 0) > 0
               THEN ROUND((COALESCE(r.releases, 0)::numeric * 100) / cc.claims::numeric)::int
               ELSE 0 END                                             AS release_rate,
          COALESCE(esc.taken, 0)                                      AS escalations_taken
        FROM users u
        LEFT JOIN per_session ps        ON ps.agent_id = u.id
        LEFT JOIN feedback_per_agent fpa ON fpa.agent_id = u.id
        LEFT JOIN releases r            ON r.agent_id = u.id
        LEFT JOIN claims_count cc       ON cc.agent_id = u.id
        LEFT JOIN escalations esc       ON esc.agent_id = u.id
        WHERE u.role = 'support_agent' AND u.is_active = true
        GROUP BY u.id, u.name, cc.claims, fpa.total, fpa.up, r.releases, esc.taken
        ORDER BY chats_handled DESC, u.name
      `)
    );

    return NextResponse.json({ agents: rows, days });
  } catch (error) {
    log.error("admin.agent_stats_failed", {
      requestId,
      error: serializeError(error),
    });
    return NextResponse.json(
      { error: "Failed to fetch agent stats" },
      { status: 500 }
    );
  }
}
