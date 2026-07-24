import { NextRequest, NextResponse } from "next/server";
import { getStaffSession } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  sessions,
  messages,
  customerContacts,
  type Session,
} from "@/lib/db/schema";
import { and, asc, desc, eq, ne, inArray, sql } from "drizzle-orm";
import { log, serializeError } from "@/lib/log";

export const dynamic = "force-dynamic";

interface HistoryRow {
  id: string;
  customerIdentifier: string;
  startedAt: Date;
  closedAt: Date | null;
  messageCount: number;
  summary: string;
}

/**
 * Phase 4 customer history endpoint. Returns the last N closed sessions for
 * the given customer identifier. Falls back to matching on
 * `customer_contacts.email` (case-insensitive) when the current session has
 * a captured email, since the embed's customer identifier rotates per
 * browser session and email is the durable key.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { customerIdentifier: string } }
) {
  const requestId = crypto.randomUUID();
  try {
    const auth = await getStaffSession();
    if (!auth?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const excludeId = searchParams.get("excludeId");
    const limitParam = searchParams.get("limit");
    const limit = Math.min(
      50,
      Math.max(1, parseInt(limitParam ?? "5", 10) || 5)
    );

    const customerId = decodeURIComponent(params.customerIdentifier);

    const candidates = new Map<string, Session>();

    // 1) Direct identifier match.
    const directRows = await db
      .select()
      .from(sessions)
      .where(
        and(
          eq(sessions.customerIdentifier, customerId),
          eq(sessions.status, "closed")
        )
      )
      .orderBy(desc(sessions.closedAt))
      .limit(limit * 2);
    for (const row of directRows) {
      if (excludeId && row.id === excludeId) continue;
      candidates.set(row.id, row);
    }

    // 2) Email fallback: pull the current session's captured email (if any),
    // then find prior sessions whose customer_contacts.email matches case-
    // insensitively.
    if (excludeId) {
      const emailsRows = await db
        .select({ email: customerContacts.email })
        .from(customerContacts)
        .where(eq(customerContacts.sessionId, excludeId));
      const emails = Array.from(
        new Set(
          emailsRows
            .map((r) => r.email?.trim().toLowerCase())
            .filter((e): e is string => !!e)
        )
      );
      if (emails.length > 0) {
        const matchingSessionIdsRows = await db
          .select({ sessionId: customerContacts.sessionId })
          .from(customerContacts)
          .where(
            inArray(
              sql`lower(${customerContacts.email})`,
              emails
            )
          );
        const matchingIds = Array.from(
          new Set(matchingSessionIdsRows.map((r) => r.sessionId))
        ).filter((id) => id !== excludeId);
        if (matchingIds.length > 0) {
          const emailRows = await db
            .select()
            .from(sessions)
            .where(
              and(
                inArray(sessions.id, matchingIds),
                eq(sessions.status, "closed"),
                ne(sessions.id, excludeId)
              )
            )
            .orderBy(desc(sessions.closedAt))
            .limit(limit * 2);
          for (const row of emailRows) {
            candidates.set(row.id, row);
          }
        }
      }
    }

    if (candidates.size === 0) {
      return NextResponse.json({ history: [] });
    }

    // Sort + cap before doing the per-session message aggregate query.
    const sorted = Array.from(candidates.values()).sort((a, b) => {
      const at = a.closedAt ? a.closedAt.getTime() : a.startedAt.getTime();
      const bt = b.closedAt ? b.closedAt.getTime() : b.startedAt.getTime();
      return bt - at;
    });
    const capped = sorted.slice(0, limit);
    const ids = capped.map((s) => s.id);

    // Aggregate counts and first-customer-message summary in one trip.
    const aggRows = await db
      .select({
        sessionId: messages.sessionId,
        count: sql<number>`count(*)::int`,
      })
      .from(messages)
      .where(inArray(messages.sessionId, ids))
      .groupBy(messages.sessionId);
    const counts = new Map(aggRows.map((r) => [r.sessionId, r.count]));

    const firstMsgRows = await db
      .select({
        sessionId: messages.sessionId,
        content: messages.content,
        sentAt: messages.sentAt,
      })
      .from(messages)
      .where(
        and(
          inArray(messages.sessionId, ids),
          eq(messages.role, "customer")
        )
      )
      .orderBy(asc(messages.sentAt));
    const summaries = new Map<string, string>();
    for (const r of firstMsgRows) {
      if (!summaries.has(r.sessionId)) {
        summaries.set(
          r.sessionId,
          r.content.length > 120 ? r.content.slice(0, 117) + "..." : r.content
        );
      }
    }

    const history: HistoryRow[] = capped.map((s) => ({
      id: s.id,
      customerIdentifier: s.customerIdentifier,
      startedAt: s.startedAt,
      closedAt: s.closedAt,
      messageCount: counts.get(s.id) ?? 0,
      summary: summaries.get(s.id) ?? "",
    }));

    return NextResponse.json({ history });
  } catch (error) {
    log.error("sessions.by_customer_failed", {
      requestId,
      customerIdentifier: params.customerIdentifier,
      error: serializeError(error),
    });
    return NextResponse.json(
      { error: "Failed to fetch history" },
      { status: 500 }
    );
  }
}
