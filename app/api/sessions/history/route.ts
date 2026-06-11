import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { log, serializeError } from "@/lib/log";

export const dynamic = "force-dynamic";

function getRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === "object" && "rows" in result) {
    return (result as { rows: T[] }).rows;
  }
  return [];
}

interface HistoryRow {
  id: string;
  customer_identifier: string;
  page_context: unknown;
  started_at: string;
  claimed_by_user_id: string | null;
  claimed_at: string | null;
  status: string;
  closed_at: string | null;
  claimed_by_kind: string | null;
  ai_claim_due_at: string | null;
  last_customer_activity_at: string;
  last_heartbeat_at: string | null;
  customer_email: string | null;
  customer_name: string | null;
  customer_city: string | null;
  customer_region: string | null;
  customer_country: string | null;
  intent: string | null;
  topic_tags: string[];
  resolved: boolean | null;
  message_count: number;
  ai_count: number;
  agent_count: number;
  ai_percent: number;
  last_msg_at: string | null;
}

export async function GET(req: NextRequest) {
  const requestId = crypto.randomUUID();
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const page = Math.max(1, parseInt(searchParams.get("page") || "1") || 1);
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "20") || 20));
    const offset = (page - 1) * limit;

    const rowsRaw = await db.execute(sql`
      WITH session_msg_counts AS (
        SELECT m.session_id,
               COUNT(*)::int                                          AS message_count,
               COUNT(*) FILTER (WHERE m.role = 'ai')::int            AS ai_count,
               COUNT(*) FILTER (WHERE m.role = 'agent')::int         AS agent_count,
               MAX(m.sent_at)                                        AS last_msg_at
        FROM messages m
        GROUP BY m.session_id
      )
      SELECT
        s.id::text                                                    AS id,
        s.customer_identifier,
        s.page_context,
        s.started_at,
        s.claimed_by_user_id,
        s.claimed_at,
        s.status::text                                                AS status,
        s.closed_at,
        s.claimed_by_kind,
        s.ai_claim_due_at,
        s.last_customer_activity_at,
        s.last_heartbeat_at,
        s.customer_email,
        s.customer_name,
        s.customer_city,
        s.customer_region,
        s.customer_country,
        s.intent,
        s.topic_tags,
        s.resolved,
        COALESCE(smc.message_count, 0)                               AS message_count,
        COALESCE(smc.ai_count, 0)                                    AS ai_count,
        COALESCE(smc.agent_count, 0)                                 AS agent_count,
        CASE WHEN (smc.ai_count + smc.agent_count) > 0
             THEN ROUND((smc.ai_count::numeric / (smc.ai_count + smc.agent_count)::numeric) * 100)::int
             ELSE 0 END                                              AS ai_percent,
        smc.last_msg_at                                              AS last_msg_at
      FROM sessions s
      LEFT JOIN session_msg_counts smc ON smc.session_id = s.id
      ORDER BY s.started_at DESC
      LIMIT ${limit}
      OFFSET ${offset}
    `);

    const totalRaw = await db.execute(sql`
      SELECT COUNT(*)::int AS total FROM sessions
    `);

    const rows = getRows<HistoryRow>(rowsRaw);
    const totalRows = getRows<{ total: number }>(totalRaw);
    const total = totalRows[0]?.total ?? 0;

    const sessionsWithCounts = rows.map((r) => ({
      id: r.id,
      customerIdentifier: r.customer_identifier,
      pageContext: r.page_context,
      startedAt: r.started_at,
      claimedByUserId: r.claimed_by_user_id,
      claimedAt: r.claimed_at,
      status: r.status,
      closedAt: r.closed_at,
      claimedByKind: r.claimed_by_kind,
      aiClaimDueAt: r.ai_claim_due_at,
      lastCustomerActivityAt: r.last_customer_activity_at,
      lastHeartbeatAt: r.last_heartbeat_at,
      customerEmail: r.customer_email,
      customerName: r.customer_name,
      customerCity: r.customer_city,
      customerRegion: r.customer_region,
      customerCountry: r.customer_country,
      intent: r.intent,
      topicTags: r.topic_tags,
      resolved: r.resolved,
      messageCount: r.message_count,
      aiMessageCount: r.ai_count,
      humanInvolved: r.agent_count > 0,
      aiPercent: r.ai_percent,
      lastMessageAt: r.last_msg_at,
    }));

    return NextResponse.json({
      sessions: sessionsWithCounts,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    log.error("sessions.history_failed", { requestId, error: serializeError(error) });
    return NextResponse.json(
      { error: "Failed to fetch history" },
      { status: 500 }
    );
  }
}
