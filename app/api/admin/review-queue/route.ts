import { NextResponse } from "next/server";
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

interface QueueItem {
  session_id: string;
  message_id: string;
  content: string;
  sent_at: string;
  intent: string | null;
  customer_question: string | null;
  surrounding: { id: string; role: string; content: string; sent_at: string }[];
}

/**
 * GET /api/admin/review-queue
 *
 * Surfaces every AI message marked confidence='low' in the last 7 days,
 * with up to 3 messages of surrounding context for the manager to grade.
 */
export async function GET() {
  const requestId = crypto.randomUUID();
  try {
    const guard = await requireManager();
    if (guard instanceof NextResponse) return guard;

    // Step 1: find every offending AI message in the last 7 days.
    const offenders = getRows<{
      message_id: string;
      session_id: string;
      content: string;
      sent_at: string;
      intent: string | null;
    }>(
      await db.execute(sql`
        SELECT
          m.id::text          AS message_id,
          m.session_id::text  AS session_id,
          m.content           AS content,
          m.sent_at           AS sent_at,
          s.intent            AS intent
        FROM messages m
        JOIN sessions s ON s.id = m.session_id
        WHERE m.role = 'ai'
          AND m.confidence = 'low'
          AND m.sent_at >= now() - interval '7 days'
        ORDER BY m.sent_at DESC
        LIMIT 200
      `)
    );

    // Step 2: bulk-fetch the 3 messages preceding and following each offender.
    // Done with a single windowed query so we don't issue N round-trips.
    const result: QueueItem[] = [];
    if (offenders.length === 0) {
      return NextResponse.json({ items: [] });
    }

    const sessionIds = Array.from(
      new Set(offenders.map((o) => o.session_id))
    );
    const idList = sql.join(
      sessionIds.map((id) => sql`${id}::uuid`),
      sql`, `
    );

    const surroundingRows = getRows<{
      session_id: string;
      id: string;
      role: string;
      content: string;
      sent_at: string;
    }>(
      await db.execute(sql`
        SELECT
          m.session_id::text                AS session_id,
          m.id::text                        AS id,
          m.role::text                      AS role,
          m.content                         AS content,
          m.sent_at                         AS sent_at
        FROM messages m
        WHERE m.session_id IN (${idList})
        ORDER BY m.session_id, m.sent_at
      `)
    );

    const bySession = surroundingRows.reduce<
      Record<string, typeof surroundingRows>
    >((acc, r) => {
      (acc[r.session_id] ||= []).push(r);
      return acc;
    }, {});

    const customerLatest = getRows<{ session_id: string; content: string }>(
      await db.execute(sql`
        SELECT DISTINCT ON (m.session_id)
          m.session_id::text AS session_id, m.content AS content
        FROM messages m
        WHERE m.role = 'customer'
          AND m.session_id IN (${idList})
        ORDER BY m.session_id, m.sent_at DESC
      `)
    );
    const lastCustomerBy = customerLatest.reduce<Record<string, string>>(
      (acc, r) => {
        acc[r.session_id] = r.content;
        return acc;
      },
      {}
    );

    for (const o of offenders) {
      const session = bySession[o.session_id] ?? [];
      const idx = session.findIndex((m) => m.id === o.message_id);
      const start = Math.max(0, idx - 3);
      const end = Math.min(session.length, idx + 4);
      const surrounding = session.slice(start, end).map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        sent_at: m.sent_at,
      }));
      result.push({
        session_id: o.session_id,
        message_id: o.message_id,
        content: o.content,
        sent_at: o.sent_at,
        intent: o.intent,
        customer_question: lastCustomerBy[o.session_id] ?? null,
        surrounding,
      });
      if (result.length >= 100) break;
    }

    return NextResponse.json({ items: result });
  } catch (error) {
    log.error("admin.review_queue_failed", {
      requestId,
      error: serializeError(error),
    });
    return NextResponse.json(
      { error: "Failed to fetch review queue" },
      { status: 500 }
    );
  }
}
