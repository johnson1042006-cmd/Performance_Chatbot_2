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

interface SearchRow {
  id: string;
  started_at: string;
  closed_at: string | null;
  status: string;
  customer_email: string | null;
  customer_identifier: string;
  intent: string | null;
  agent_name: string | null;
  message_count: number;
  ai_count: number;
  ai_percent: number;
  snippet: string;
  last_msg_at: string;
}

/**
 * GET /api/admin/search?q=&from=&to=&status=&agent=&page=1&limit=25
 *
 * Postgres full-text search against `messages.content_tsv` (a generated
 * tsvector + GIN index added in Phase 5). Groups matches by session and
 * returns one row per session with a ts_headline-rendered snippet that
 * wraps matched terms in literal <mark>...</mark> markers.
 *
 * SECURITY: ts_headline does NOT HTML-escape the surrounding document text —
 * it returns the original message content verbatim aside from the configured
 * StartSel/StopSel. `messages.content` is raw customer/AI text (redactPII does
 * not strip tags), so this snippet may contain live markup. The client MUST
 * render it as text (see renderSnippet in the search page) and never via
 * dangerouslySetInnerHTML.
 */
export async function GET(req: NextRequest) {
  const requestId = crypto.randomUUID();
  try {
    const guard = await requireManager();
    if (guard instanceof NextResponse) return guard;

    const url = new URL(req.url);
    const q = (url.searchParams.get("q") ?? "").trim();
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    const status = url.searchParams.get("status");
    const agent = url.searchParams.get("agent");
    const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
    const limit = Math.min(
      100,
      Math.max(1, parseInt(url.searchParams.get("limit") ?? "25", 10) || 25)
    );
    const offset = (page - 1) * limit;

    if (!q) {
      return NextResponse.json({
        results: [],
        page,
        limit,
        total: 0,
      });
    }

    const fromDate = from ? new Date(from) : null;
    const toDate = to ? new Date(to) : null;

    const rowsRaw = await db.execute(sql`
      WITH q AS (
        SELECT plainto_tsquery('english', ${q}) AS tsq
      ),
      hits AS (
        SELECT m.session_id,
               m.content,
               m.sent_at,
               ROW_NUMBER() OVER (
                 PARTITION BY m.session_id
                 ORDER BY ts_rank(m.content_tsv, q.tsq) DESC, m.sent_at DESC
               ) AS rn
        FROM messages m, q
        WHERE m.content_tsv @@ q.tsq
      ),
      best AS (
        SELECT session_id, content, sent_at FROM hits WHERE rn = 1
      ),
      session_msg_counts AS (
        SELECT m.session_id,
               COUNT(*)::int                                            AS message_count,
               COUNT(*) FILTER (WHERE m.role = 'ai')::int               AS ai_count,
               MAX(m.sent_at)                                           AS last_msg_at
        FROM messages m
        GROUP BY m.session_id
      )
      SELECT
        s.id::text                                                  AS id,
        s.started_at                                                AS started_at,
        s.closed_at                                                 AS closed_at,
        s.status::text                                              AS status,
        s.customer_email                                            AS customer_email,
        s.customer_identifier                                       AS customer_identifier,
        s.intent                                                    AS intent,
        u.name                                                      AS agent_name,
        smc.message_count                                           AS message_count,
        smc.ai_count                                                AS ai_count,
        CASE WHEN smc.message_count > 0
             THEN ROUND((smc.ai_count::numeric / smc.message_count::numeric) * 100)::int
             ELSE 0 END                                             AS ai_percent,
        ts_headline(
          'english',
          best.content,
          (SELECT tsq FROM q),
          'StartSel=<mark>,StopSel=</mark>,MaxFragments=2,MaxWords=14,MinWords=4'
        )                                                           AS snippet,
        smc.last_msg_at                                             AS last_msg_at
      FROM best
      JOIN sessions s ON s.id = best.session_id
      LEFT JOIN users u ON u.id = s.claimed_by_user_id
      JOIN session_msg_counts smc ON smc.session_id = s.id
      WHERE 1=1
        ${fromDate ? sql`AND s.started_at >= ${fromDate}` : sql``}
        ${toDate ? sql`AND s.started_at <= ${toDate}` : sql``}
        ${status ? sql`AND s.status::text = ${status}` : sql``}
        ${agent ? sql`AND s.claimed_by_user_id::text = ${agent}` : sql``}
      ORDER BY smc.last_msg_at DESC
      LIMIT ${limit}
      OFFSET ${offset}
    `);

    const totalRaw = await db.execute(sql`
      WITH q AS (
        SELECT plainto_tsquery('english', ${q}) AS tsq
      ),
      hit_sessions AS (
        SELECT DISTINCT m.session_id
        FROM messages m, q
        WHERE m.content_tsv @@ q.tsq
      )
      SELECT COUNT(*)::int AS total
      FROM hit_sessions hs
      JOIN sessions s ON s.id = hs.session_id
      WHERE 1=1
        ${fromDate ? sql`AND s.started_at >= ${fromDate}` : sql``}
        ${toDate ? sql`AND s.started_at <= ${toDate}` : sql``}
        ${status ? sql`AND s.status::text = ${status}` : sql``}
        ${agent ? sql`AND s.claimed_by_user_id::text = ${agent}` : sql``}
    `);

    const results = getRows<SearchRow>(rowsRaw);
    const totalRows = getRows<{ total: number }>(totalRaw);
    const total = totalRows[0]?.total ?? 0;

    return NextResponse.json({
      results,
      page,
      limit,
      total,
    });
  } catch (error) {
    log.error("admin.search_failed", { requestId, error: serializeError(error) });
    return NextResponse.json({ error: "Search failed" }, { status: 500 });
  }
}
