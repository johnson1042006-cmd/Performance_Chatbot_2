import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import {
  tickets,
  chatEvents,
  sessions,
  knowledgeBase,
} from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { requireStaff } from "@/lib/auth/requireStaff";
import { requireManager } from "@/lib/auth/requireManager";
import { log, serializeError } from "@/lib/log";
import { getPusher } from "@/lib/pusher/server";
import {
  slaHoursToMs,
  type SlaWindowsHours,
} from "@/lib/tickets/sla";
import { sendTicketCreatedEmail } from "@/lib/email/templates/ticket-created";
import type { Ticket, TicketPriority, TicketSource } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

function getRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === "object" && "rows" in result) {
    return (result as { rows: T[] }).rows;
  }
  return [];
}

const PRIORITY_RANK: Record<TicketPriority, number> = {
  urgent: 4,
  high: 3,
  normal: 2,
  low: 1,
};

interface TicketRow {
  id: string;
  ticket_number: number;
  session_id: string | null;
  subject: string;
  status: string;
  priority: string;
  category: string | null;
  source: string;
  customer_email: string | null;
  customer_name: string | null;
  assigned_to: string | null;
  assigned_to_name: string | null;
  due_at: string | Date | null;
  first_response_at: string | Date | null;
  resolved_at: string | Date | null;
  closed_at: string | Date | null;
  sla_breached: boolean;
  metadata: unknown;
  created_at: string | Date;
  updated_at: string | Date;
}

/**
 * GET /api/tickets
 *
 * Filterable ticket list. Agents see tickets assigned to them OR
 * unassigned (so they can pick up work); managers see everything.
 *
 * Query params:
 *   status      'open'|'pending'|'resolved'|'closed' (CSV ok)
 *   priority    'urgent'|'high'|'normal'|'low' (CSV ok)
 *   assignedTo  user UUID (managers only)
 *   category    intent string
 *   page        1-based, defaults 1
 *   limit       1..100, defaults 25
 */
export async function GET(req: NextRequest) {
  const requestId = crypto.randomUUID();
  try {
    const guard = await requireStaff();
    if (guard instanceof NextResponse) return guard;

    const url = new URL(req.url);
    const sp = url.searchParams;

    const statusList = (sp.get("status") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const priorityList = (sp.get("priority") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const assignedToParam = sp.get("assignedTo");
    const category = sp.get("category");
    const page = Math.max(1, parseInt(sp.get("page") ?? "1", 10) || 1);
    const limit = Math.max(
      1,
      Math.min(100, parseInt(sp.get("limit") ?? "25", 10) || 25)
    );
    const offset = (page - 1) * limit;

    const where: ReturnType<typeof sql>[] = [];

    if (statusList.length > 0) {
      where.push(sql`t.status = ANY(${statusList}::text[])`);
    }
    if (priorityList.length > 0) {
      where.push(sql`t.priority = ANY(${priorityList}::text[])`);
    }
    if (category) {
      where.push(sql`t.category = ${category}`);
    }

    if (guard.role === "store_manager") {
      if (assignedToParam) {
        if (assignedToParam === "unassigned") {
          where.push(sql`t.assigned_to IS NULL`);
        } else {
          where.push(sql`t.assigned_to = ${assignedToParam}::uuid`);
        }
      }
    } else {
      // Agents: assigned-to-me OR unassigned.
      where.push(
        sql`(t.assigned_to = ${guard.userId}::uuid OR t.assigned_to IS NULL)`
      );
    }

    const whereClause =
      where.length === 0
        ? sql``
        : sql`WHERE ${sql.join(where, sql` AND `)}`;

    const rows = getRows<TicketRow>(
      await db.execute(sql`
        SELECT
          t.id::text                AS id,
          t.ticket_number           AS ticket_number,
          t.session_id::text        AS session_id,
          t.subject                 AS subject,
          t.status                  AS status,
          t.priority                AS priority,
          t.category                AS category,
          t.source                  AS source,
          t.customer_email          AS customer_email,
          t.customer_name           AS customer_name,
          t.assigned_to::text       AS assigned_to,
          u.name                    AS assigned_to_name,
          t.due_at                  AS due_at,
          t.first_response_at       AS first_response_at,
          t.resolved_at             AS resolved_at,
          t.closed_at               AS closed_at,
          t.sla_breached            AS sla_breached,
          t.metadata                AS metadata,
          t.created_at              AS created_at,
          t.updated_at              AS updated_at
        FROM tickets t
        LEFT JOIN users u ON u.id = t.assigned_to
        ${whereClause}
        ORDER BY
          CASE t.priority
            WHEN 'urgent' THEN 4
            WHEN 'high'   THEN 3
            WHEN 'normal' THEN 2
            WHEN 'low'    THEN 1
            ELSE 0
          END DESC,
          t.created_at DESC
        LIMIT ${limit}
        OFFSET ${offset}
      `)
    );

    const totalRow = getRows<{ c: number }>(
      await db.execute(sql`
        SELECT count(*)::int AS c
        FROM tickets t
        ${whereClause}
      `)
    );
    const total = totalRow[0]?.c ?? 0;

    return NextResponse.json({
      tickets: rows.map((r) => ({
        id: r.id,
        ticketNumber: r.ticket_number,
        sessionId: r.session_id,
        subject: r.subject,
        status: r.status,
        priority: r.priority,
        category: r.category,
        source: r.source,
        customerEmail: r.customer_email,
        customerName: r.customer_name,
        assignedTo: r.assigned_to,
        assignedToName: r.assigned_to_name,
        dueAt: r.due_at,
        firstResponseAt: r.first_response_at,
        resolvedAt: r.resolved_at,
        closedAt: r.closed_at,
        slaBreached: r.sla_breached,
        metadata: r.metadata,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      })),
      total,
      page,
      limit,
      __priorityRank: PRIORITY_RANK,
    });
  } catch (error) {
    log.error("tickets.list_failed", {
      requestId,
      error: serializeError(error),
    });
    return NextResponse.json(
      { error: "Failed to fetch tickets" },
      { status: 500 }
    );
  }
}

interface CreateBody {
  subject?: string;
  description?: string;
  priority?: TicketPriority;
  category?: string | null;
  customerEmail?: string | null;
  customerName?: string | null;
  sessionId?: string | null;
  assignedTo?: string | null;
  source?: TicketSource;
  tags?: string[];
}

async function loadSlaWindows(): Promise<SlaWindowsHours> {
  try {
    const [row] = await db
      .select()
      .from(knowledgeBase)
      .where(eq(knowledgeBase.topic, "bot_settings"))
      .limit(1);
    if (!row) return { urgent: 2, high: 4, normal: 24, low: 72 };
    const parsed = JSON.parse(row.content) as {
      slaWindowsHours?: Partial<SlaWindowsHours>;
    };
    return {
      urgent: parsed.slaWindowsHours?.urgent ?? 2,
      high: parsed.slaWindowsHours?.high ?? 4,
      normal: parsed.slaWindowsHours?.normal ?? 24,
      low: parsed.slaWindowsHours?.low ?? 72,
    };
  } catch {
    return { urgent: 2, high: 4, normal: 24, low: 72 };
  }
}

async function loadEmailEnabled(): Promise<boolean> {
  try {
    const [row] = await db
      .select()
      .from(knowledgeBase)
      .where(eq(knowledgeBase.topic, "bot_settings"))
      .limit(1);
    if (!row) return true;
    const parsed = JSON.parse(row.content) as {
      autoTicketEmailEnabled?: boolean;
    };
    return parsed.autoTicketEmailEnabled ?? true;
  } catch {
    return true;
  }
}

/**
 * POST /api/tickets
 *
 * Manual creation. Two source modes:
 *   - source='manual'  → manager-only (e.g. typed in via the manager UI).
 *   - source='chat'    → staff-allowed when the body's sessionId is
 *                        currently claimed by the requester (or requester
 *                        is a manager). The "Convert to Ticket" button on
 *                        ChatPanel posts with this shape.
 * Same dedupe rule as the auto-create pipeline: at most one ticket per
 * sessionId.
 */
export async function POST(req: NextRequest) {
  const requestId = crypto.randomUUID();
  try {
    const body = (await req.json()) as CreateBody;
    const source: TicketSource = body.source === "chat" ? "chat" : "manual";

    let actorId: string;
    let isManager = false;
    if (source === "manual") {
      const guard = await requireManager();
      if (guard instanceof NextResponse) return guard;
      actorId = guard.userId;
      isManager = true;
    } else {
      const guard = await requireStaff();
      if (guard instanceof NextResponse) return guard;
      actorId = guard.userId;
      isManager = guard.role === "store_manager";
      if (!body.sessionId) {
        return NextResponse.json(
          { error: "sessionId is required for source='chat'" },
          { status: 400 }
        );
      }
      // Confirm the agent has the session claimed (or is a manager).
      if (!isManager) {
        const [s] = await db
          .select({ claimedByUserId: sessions.claimedByUserId })
          .from(sessions)
          .where(eq(sessions.id, body.sessionId))
          .limit(1);
        if (!s || s.claimedByUserId !== actorId) {
          return NextResponse.json(
            {
              error:
                "You can only convert a chat to a ticket while you have it claimed.",
            },
            { status: 403 }
          );
        }
      }
    }

    const subject = (body.subject ?? "").trim().slice(0, 200);
    if (!subject) {
      return NextResponse.json(
        { error: "subject is required" },
        { status: 400 }
      );
    }
    const priority: TicketPriority =
      body.priority &&
      ["urgent", "high", "normal", "low"].includes(body.priority)
        ? body.priority
        : "normal";

    if (body.sessionId) {
      const [existing] = await db
        .select({ id: tickets.id })
        .from(tickets)
        .where(eq(tickets.sessionId, body.sessionId))
        .limit(1);
      if (existing) {
        return NextResponse.json(
          {
            error: "A ticket already exists for this session.",
            ticketId: existing.id,
          },
          { status: 409 }
        );
      }
    }

    const slaWindows = await loadSlaWindows();
    const dueAt = new Date(Date.now() + slaHoursToMs(priority, slaWindows));

    let inserted: Ticket | null = null;
    try {
      const rows = (await db
        .insert(tickets)
        .values({
          sessionId: body.sessionId ?? null,
          subject,
          description: body.description ?? null,
          status: "open",
          priority,
          category: body.category ?? null,
          source,
          customerEmail: body.customerEmail ?? null,
          customerName: body.customerName ?? null,
          assignedTo:
            isManager && body.assignedTo ? body.assignedTo : actorId,
          createdBy: actorId,
          dueAt,
        })
        .returning()) as Ticket[];
      inserted = rows[0] ?? null;
    } catch (error) {
      log.error("tickets.create_insert_failed", {
        requestId,
        error: serializeError(error),
      });
      return NextResponse.json(
        { error: "Failed to create ticket" },
        { status: 500 }
      );
    }
    if (!inserted) {
      return NextResponse.json(
        { error: "Failed to create ticket" },
        { status: 500 }
      );
    }

    // Log timeline event when a session is linked.
    if (inserted.sessionId) {
      try {
        await db.insert(chatEvents).values({
          sessionId: inserted.sessionId,
          type: "ticket_created",
          actorUserId: actorId,
          metadata: {
            ticketId: inserted.id,
            ticketNumber: inserted.ticketNumber,
            source,
            priority,
          },
        });
      } catch (error) {
        log.warn("tickets.create_chat_event_failed", {
          ticketId: inserted.id,
          error: serializeError(error),
        });
      }
    }

    try {
      const pusher = getPusher();
      await pusher.trigger("alerts", "ticket-created", {
        ticketId: inserted.id,
        ticketNumber: inserted.ticketNumber,
        priority: inserted.priority,
        sessionId: inserted.sessionId,
        subject: inserted.subject,
      });
    } catch (error) {
      log.warn("tickets.create_pusher_failed", {
        ticketId: inserted.id,
        error: serializeError(error),
      });
    }

    if (inserted.customerEmail && (await loadEmailEnabled())) {
      const slaWindowHours = Math.round(
        slaHoursToMs(priority, slaWindows) / (60 * 60 * 1000)
      );
      void sendTicketCreatedEmail({
        ticket: inserted,
        slaWindowHours,
      }).catch((error) => {
        log.warn("tickets.create_email_failed", {
          ticketId: inserted!.id,
          error: serializeError(error),
        });
      });
    }

    return NextResponse.json({ ticket: inserted }, { status: 201 });
  } catch (error) {
    log.error("tickets.create_failed", {
      requestId,
      error: serializeError(error),
    });
    return NextResponse.json(
      { error: "Failed to create ticket" },
      { status: 500 }
    );
  }
}
