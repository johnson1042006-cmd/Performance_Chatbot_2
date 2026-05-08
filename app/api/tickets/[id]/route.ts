import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import {
  tickets,
  ticketComments,
  ticketTags,
  chatEvents,
  knowledgeBase,
} from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { requireStaff } from "@/lib/auth/requireStaff";
import { log, serializeError } from "@/lib/log";
import { getPusher } from "@/lib/pusher/server";
import { slaHoursToMs, type SlaWindowsHours } from "@/lib/tickets/sla";
import { sendTicketResolvedEmail } from "@/lib/email/templates/ticket-resolved";
import type { Ticket, TicketPriority, TicketStatus } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

const STATUSES: readonly TicketStatus[] = [
  "open",
  "pending",
  "resolved",
  "closed",
];
const PRIORITIES: readonly TicketPriority[] = [
  "urgent",
  "high",
  "normal",
  "low",
];

function getRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === "object" && "rows" in result) {
    return (result as { rows: T[] }).rows;
  }
  return [];
}

interface TicketDetailRow {
  id: string;
  ticket_number: number;
  session_id: string | null;
  subject: string;
  description: string | null;
  status: string;
  priority: string;
  category: string | null;
  source: string;
  customer_email: string | null;
  customer_name: string | null;
  assigned_to: string | null;
  assigned_to_name: string | null;
  created_by: string | null;
  due_at: string | Date | null;
  first_response_at: string | Date | null;
  resolved_at: string | Date | null;
  closed_at: string | Date | null;
  sla_breached: boolean;
  metadata: unknown;
  created_at: string | Date;
  updated_at: string | Date;
}

interface CommentRow {
  id: string;
  author_id: string | null;
  author_name: string | null;
  body: string;
  is_internal: boolean;
  created_at: string | Date;
}

/**
 * GET /api/tickets/[id]
 *
 * Returns the ticket plus comments (oldest → newest) and tag list. Today
 * only staff hit this route; the `is_internal` filter is implemented as
 * a defensive layer for any future customer-facing surface.
 */
export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const requestId = crypto.randomUUID();
  try {
    const guard = await requireStaff();
    if (guard instanceof NextResponse) return guard;
    const { id } = await context.params;

    const ticketRows = getRows<TicketDetailRow>(
      await db.execute(sql`
        SELECT
          t.id::text                AS id,
          t.ticket_number           AS ticket_number,
          t.session_id::text        AS session_id,
          t.subject                 AS subject,
          t.description             AS description,
          t.status                  AS status,
          t.priority                AS priority,
          t.category                AS category,
          t.source                  AS source,
          t.customer_email          AS customer_email,
          t.customer_name           AS customer_name,
          t.assigned_to::text       AS assigned_to,
          u.name                    AS assigned_to_name,
          t.created_by::text        AS created_by,
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
        WHERE t.id = ${id}::uuid
        LIMIT 1
      `)
    );
    const t = ticketRows[0];
    if (!t) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const isStaff = true;
    const commentRows = getRows<CommentRow>(
      await db.execute(sql`
        SELECT
          c.id::text         AS id,
          c.author_id::text  AS author_id,
          u.name             AS author_name,
          c.body             AS body,
          c.is_internal      AS is_internal,
          c.created_at       AS created_at
        FROM ticket_comments c
        LEFT JOIN users u ON u.id = c.author_id
        WHERE c.ticket_id = ${id}::uuid
          ${isStaff ? sql`` : sql`AND c.is_internal = false`}
        ORDER BY c.created_at ASC
      `)
    );

    const tagRows = await db
      .select({ tag: ticketTags.tag })
      .from(ticketTags)
      .where(eq(ticketTags.ticketId, id));

    return NextResponse.json({
      ticket: {
        id: t.id,
        ticketNumber: t.ticket_number,
        sessionId: t.session_id,
        subject: t.subject,
        description: t.description,
        status: t.status,
        priority: t.priority,
        category: t.category,
        source: t.source,
        customerEmail: t.customer_email,
        customerName: t.customer_name,
        assignedTo: t.assigned_to,
        assignedToName: t.assigned_to_name,
        createdBy: t.created_by,
        dueAt: t.due_at,
        firstResponseAt: t.first_response_at,
        resolvedAt: t.resolved_at,
        closedAt: t.closed_at,
        slaBreached: t.sla_breached,
        metadata: t.metadata,
        createdAt: t.created_at,
        updatedAt: t.updated_at,
      },
      comments: commentRows.map((c) => ({
        id: c.id,
        authorId: c.author_id,
        authorName: c.author_name,
        body: c.body,
        isInternal: c.is_internal,
        createdAt: c.created_at,
      })),
      tags: tagRows.map((r) => r.tag),
    });
  } catch (error) {
    log.error("tickets.detail_failed", {
      requestId,
      error: serializeError(error),
    });
    return NextResponse.json(
      { error: "Failed to fetch ticket" },
      { status: 500 }
    );
  }
}

interface PatchBody {
  status?: TicketStatus;
  priority?: TicketPriority;
  assignedTo?: string | null;
  dueAt?: string | null;
  subject?: string;
  category?: string | null;
  tags?: string[];
  resolutionNote?: string;
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

/**
 * PATCH /api/tickets/[id]
 *
 * Whitelisted updates. Side effects per the plan:
 *   - status change → log chat_events 'ticket_status_changed' when a
 *     session is linked, plus Pusher 'ticket-status-changed'.
 *   - status='resolved' → set resolved_at + sla_breached := false (if
 *     not yet flagged), Pusher 'ticket-resolved', best-effort customer
 *     email.
 *   - status='closed' → set closed_at.
 *   - priority change → recalc due_at only when current due_at IS NULL
 *     OR status='open'.
 *   - tags array (when provided) → wholesale replace ticket_tags rows.
 */
export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const requestId = crypto.randomUUID();
  try {
    const guard = await requireStaff();
    if (guard instanceof NextResponse) return guard;
    const { id } = await context.params;
    const body = (await req.json()) as PatchBody;

    const [current] = (await db
      .select()
      .from(tickets)
      .where(eq(tickets.id, id))
      .limit(1)) as Ticket[];
    if (!current)
      return NextResponse.json({ error: "Not found" }, { status: 404 });

    const updates: Partial<Ticket> = { updatedAt: new Date() };
    let priorityChanged = false;
    let statusChanged: { from: TicketStatus; to: TicketStatus } | null = null;

    if (body.subject !== undefined) {
      const trimmed = body.subject.trim().slice(0, 200);
      if (trimmed.length === 0) {
        return NextResponse.json(
          { error: "subject cannot be empty" },
          { status: 400 }
        );
      }
      updates.subject = trimmed;
    }
    if (body.category !== undefined) {
      updates.category = body.category;
    }
    if (body.assignedTo !== undefined) {
      updates.assignedTo = body.assignedTo;
    }
    if (body.priority !== undefined) {
      if (!PRIORITIES.includes(body.priority)) {
        return NextResponse.json(
          { error: "invalid priority" },
          { status: 400 }
        );
      }
      if (body.priority !== current.priority) {
        priorityChanged = true;
      }
      updates.priority = body.priority;
    }
    if (body.status !== undefined) {
      if (!STATUSES.includes(body.status)) {
        return NextResponse.json(
          { error: "invalid status" },
          { status: 400 }
        );
      }
      if (body.status !== current.status) {
        statusChanged = {
          from: current.status as TicketStatus,
          to: body.status,
        };
      }
      updates.status = body.status;
      if (body.status === "resolved") {
        updates.resolvedAt = new Date();
      } else if (body.status === "closed") {
        updates.closedAt = new Date();
      }
    }
    if (body.dueAt !== undefined) {
      updates.dueAt = body.dueAt ? new Date(body.dueAt) : null;
    }

    // Priority -> due_at recalculation gate.
    if (
      priorityChanged &&
      body.priority &&
      body.dueAt === undefined &&
      (current.dueAt === null || current.status === "open")
    ) {
      const slaWindows = await loadSlaWindows();
      updates.dueAt = new Date(Date.now() + slaHoursToMs(body.priority, slaWindows));
      // Newly-recomputed due_at should clear a prior breach flag if the
      // new window is now in the future.
      if (
        current.slaBreached &&
        updates.dueAt &&
        updates.dueAt.getTime() > Date.now()
      ) {
        updates.slaBreached = false;
      }
    }

    let updated: Ticket | null = null;
    try {
      const rows = (await db
        .update(tickets)
        .set(updates)
        .where(eq(tickets.id, id))
        .returning()) as Ticket[];
      updated = rows[0] ?? null;
    } catch (error) {
      log.error("tickets.patch_update_failed", {
        requestId,
        error: serializeError(error),
      });
      return NextResponse.json(
        { error: "Failed to update ticket" },
        { status: 500 }
      );
    }
    if (!updated) {
      return NextResponse.json(
        { error: "Failed to update ticket" },
        { status: 500 }
      );
    }

    // Tags — wholesale replace when provided.
    if (Array.isArray(body.tags)) {
      const cleaned = Array.from(
        new Set(
          body.tags
            .map((t) => (typeof t === "string" ? t.trim().toLowerCase() : ""))
            .filter((t) => t.length > 0 && t.length <= 40)
        )
      );
      try {
        await db.delete(ticketTags).where(eq(ticketTags.ticketId, id));
        if (cleaned.length > 0) {
          await db
            .insert(ticketTags)
            .values(cleaned.map((tag) => ({ ticketId: id, tag })));
        }
      } catch (error) {
        log.warn("tickets.patch_tags_failed", {
          ticketId: id,
          error: serializeError(error),
        });
      }
    }

    // Status timeline event + Pusher.
    if (statusChanged) {
      if (updated.sessionId) {
        try {
          await db.insert(chatEvents).values({
            sessionId: updated.sessionId,
            type: "ticket_status_changed",
            actorUserId: guard.userId,
            metadata: {
              ticketId: updated.id,
              from: statusChanged.from,
              to: statusChanged.to,
            },
          });
        } catch (error) {
          log.warn("tickets.patch_chat_event_failed", {
            ticketId: id,
            error: serializeError(error),
          });
        }
      }

      try {
        const pusher = getPusher();
        await pusher.trigger("alerts", "ticket-status-changed", {
          ticketId: updated.id,
          ticketNumber: updated.ticketNumber,
          from: statusChanged.from,
          to: statusChanged.to,
        });
        if (statusChanged.to === "resolved") {
          await pusher.trigger("alerts", "ticket-resolved", {
            ticketId: updated.id,
            ticketNumber: updated.ticketNumber,
          });
        }
      } catch (error) {
        log.warn("tickets.patch_pusher_failed", {
          ticketId: id,
          error: serializeError(error),
        });
      }

      if (statusChanged.to === "resolved" && updated.customerEmail) {
        void sendTicketResolvedEmail({
          ticket: updated,
          resolutionNote: body.resolutionNote ?? null,
        }).catch((error) => {
          log.warn("tickets.patch_email_failed", {
            ticketId: id,
            error: serializeError(error),
          });
        });
      }
    }

    return NextResponse.json({ ticket: updated });
  } catch (error) {
    log.error("tickets.patch_failed", {
      requestId,
      error: serializeError(error),
    });
    return NextResponse.json(
      { error: "Failed to update ticket" },
      { status: 500 }
    );
  }
}
