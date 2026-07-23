import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { requireManager } from "@/lib/auth/requireManager";
import { log, serializeError } from "@/lib/log";
import { ExportRow, buildCsv } from "@/lib/export/transcripts";

export const dynamic = "force-dynamic";

function getRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === "object" && "rows" in result) {
    return (result as { rows: T[] }).rows;
  }
  return [];
}

interface MessageRow {
  session_id: string;
  role: string;
  content: string;
  sent_at: string;
  confidence: string | null;
  sentiment: number | null;
}

/**
 * GET /api/admin/export?from=&to=&format=csv|json&q=&status=&agent=
 *
 * Manager transcript export. CSV header order is fixed and tested:
 * see lib/export/transcripts.ts for the exact shape.
 */
export async function GET(req: NextRequest) {
  const requestId = crypto.randomUUID();
  try {
    const guard = await requireManager();
    if (guard instanceof NextResponse) return guard;

    const url = new URL(req.url);
    const format = (url.searchParams.get("format") ?? "csv").toLowerCase();
    const q = (url.searchParams.get("q") ?? "").trim();
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    const status = url.searchParams.get("status");
    const agent = url.searchParams.get("agent");

    const fromDate = from ? new Date(from) : null;
    const toDate = to ? new Date(to) : null;

    // Either filter by full-text query (matches the search page) or just by
    // status/date/agent. When `q` is empty we don't restrict by tsv match.
    const sessionRows = getRows<ExportRow>(
      await db.execute(sql`
        WITH q AS (
          SELECT plainto_tsquery('english', ${q || ""}) AS tsq
        ),
        hit_sessions AS (
          SELECT DISTINCT m.session_id
          FROM messages m, q
          WHERE ${q ? sql`m.content_tsv @@ q.tsq` : sql`true`}
        ),
        msg_counts AS (
          SELECT m.session_id,
                 COUNT(*)::int                                       AS message_count,
                 COUNT(*) FILTER (WHERE m.role = 'ai')::int          AS ai_message_count
          FROM messages m
          GROUP BY m.session_id
        ),
        latest_feedback AS (
          SELECT DISTINCT ON (f.session_id) f.session_id, f.rating
          FROM feedback f
          ORDER BY f.session_id, f.submitted_at DESC
        )
        SELECT
          s.id::text                                                AS session_id,
          to_char(s.started_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"')        AS started_at,
          to_char(s.closed_at,  'YYYY-MM-DD"T"HH24:MI:SS"Z"')        AS closed_at,
          s.status::text                                            AS status,
          s.customer_email                                          AS customer_email,
          COALESCE(mc.message_count, 0)                             AS message_count,
          COALESCE(mc.ai_message_count, 0)                          AS ai_message_count,
          s.intent                                                  AS intent,
          s.topic_tags                                              AS topic_tags,
          lf.rating                                                 AS csat_rating,
          u.name                                                    AS agent_name
        FROM sessions s
        LEFT JOIN msg_counts mc      ON mc.session_id = s.id
        LEFT JOIN users u            ON u.id = s.claimed_by_user_id
        LEFT JOIN latest_feedback lf ON lf.session_id = s.id
        ${q ? sql`JOIN hit_sessions hs ON hs.session_id = s.id` : sql``}
        WHERE 1=1
          ${fromDate ? sql`AND s.started_at >= ${fromDate.toISOString()}` : sql``}
          ${toDate ? sql`AND s.started_at <= ${toDate.toISOString()}` : sql``}
          ${status ? sql`AND s.status::text = ${status}` : sql``}
          ${agent ? sql`AND s.claimed_by_user_id::text = ${agent}` : sql``}
        ORDER BY s.started_at DESC
        LIMIT 10000
      `)
    );

    const today = new Date().toISOString().slice(0, 10);

    if (format === "json") {
      const ids = sessionRows.map((r) => r.session_id);
      let messagesBySession: Record<string, MessageRow[]> = {};
      if (ids.length > 0) {
        const idList = sql.join(
          ids.map((id) => sql`${id}::uuid`),
          sql`, `
        );
        const messageRows = getRows<MessageRow>(
          await db.execute(sql`
            SELECT
              m.session_id::text                                       AS session_id,
              m.role::text                                              AS role,
              m.content                                                 AS content,
              to_char(m.sent_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"')          AS sent_at,
              m.confidence                                              AS confidence,
              m.sentiment                                               AS sentiment
            FROM messages m
            WHERE m.session_id IN (${idList})
            ORDER BY m.session_id, m.sent_at
          `)
        );
        messagesBySession = messageRows.reduce<Record<string, MessageRow[]>>(
          (acc, m) => {
            (acc[m.session_id] ||= []).push(m);
            return acc;
          },
          {}
        );
      }

      const sessionsOut = sessionRows.map((s) => ({
        ...s,
        topic_tags: s.topic_tags ?? [],
        messages: messagesBySession[s.session_id] ?? [],
      }));

      return new NextResponse(JSON.stringify({ sessions: sessionsOut }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Content-Disposition": `attachment; filename=transcripts-${today}.json`,
        },
      });
    }

    const csv = buildCsv(sessionRows);
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename=transcripts-${today}.csv`,
      },
    });
  } catch (error) {
    log.error("admin.export_failed", { requestId, error: serializeError(error) });
    return NextResponse.json({ error: "Export failed" }, { status: 500 });
  }
}
