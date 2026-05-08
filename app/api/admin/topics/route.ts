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
 * GET /api/admin/topics?days=30
 *
 * Aggregates the AI tagger's output (sessions.intent, sessions.topic_tags)
 * over the trailing window. Returns the top intents with counts and the
 * top 20 topic tags. Powers the Insights page charts and the Hub leaderboard.
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

    const intents = getRows<{ intent: string; count: number }>(
      await db.execute(sql`
        SELECT intent, COUNT(*)::int AS count
        FROM sessions
        WHERE intent IS NOT NULL
          AND started_at >= now() - (${days}::int * interval '1 day')
        GROUP BY intent
        ORDER BY count DESC
      `)
    );

    const topics = getRows<{ tag: string; count: number }>(
      await db.execute(sql`
        SELECT tag, COUNT(*)::int AS count
        FROM (
          SELECT unnest(topic_tags) AS tag
          FROM sessions
          WHERE started_at >= now() - (${days}::int * interval '1 day')
        ) t
        WHERE tag IS NOT NULL AND length(tag) > 0
        GROUP BY tag
        ORDER BY count DESC
        LIMIT 20
      `)
    );

    return NextResponse.json({ intents, topics, days });
  } catch (error) {
    log.error("admin.topics_failed", { requestId, error: serializeError(error) });
    return NextResponse.json({ error: "Failed to fetch topics" }, { status: 500 });
  }
}
