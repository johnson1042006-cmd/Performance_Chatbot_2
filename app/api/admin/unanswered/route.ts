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

interface UnansweredRow {
  id: string;
  started_at: string;
  closed_at: string | null;
  intent: string | null;
  topic_tags: string[];
  customer_email: string | null;
  customer_question: string | null;
  resolved: boolean | null;
  latest_ai_confidence: string | null;
}

/**
 * GET /api/admin/unanswered?days=30
 *
 * Returns sessions where the customer's question wasn't fully answered:
 * either the AI tagger marked `resolved=false`, or the latest AI message
 * in the session has confidence='low'. The Insights page renders these
 * with an "Add to KB" inline action.
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
    const limit = Math.min(
      200,
      Math.max(1, parseInt(url.searchParams.get("limit") ?? "50", 10) || 50)
    );

    const rows = getRows<UnansweredRow>(
      await db.execute(sql`
        WITH latest_ai AS (
          SELECT DISTINCT ON (m.session_id)
            m.session_id, m.confidence
          FROM messages m
          WHERE m.role = 'ai'
          ORDER BY m.session_id, m.sent_at DESC
        ),
        latest_customer AS (
          SELECT DISTINCT ON (m.session_id)
            m.session_id, m.content
          FROM messages m
          WHERE m.role = 'customer'
          ORDER BY m.session_id, m.sent_at DESC
        )
        SELECT
          s.id::text                        AS id,
          s.started_at                      AS started_at,
          s.closed_at                       AS closed_at,
          s.intent                          AS intent,
          s.topic_tags                      AS topic_tags,
          s.customer_email                  AS customer_email,
          lc.content                        AS customer_question,
          s.resolved                        AS resolved,
          la.confidence                     AS latest_ai_confidence
        FROM sessions s
        LEFT JOIN latest_ai la       ON la.session_id = s.id
        LEFT JOIN latest_customer lc ON lc.session_id = s.id
        WHERE s.started_at >= now() - (${days}::int * interval '1 day')
          AND (s.resolved IS FALSE OR la.confidence = 'low')
        ORDER BY s.started_at DESC
        LIMIT ${limit}
      `)
    );

    return NextResponse.json({ rows, days });
  } catch (error) {
    log.error("admin.unanswered_failed", { requestId, error: serializeError(error) });
    return NextResponse.json({ error: "Failed to fetch unanswered" }, { status: 500 });
  }
}
