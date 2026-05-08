import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ticketComments, tickets } from "@/lib/db/schema";
import { eq, and, isNull } from "drizzle-orm";
import { requireStaff } from "@/lib/auth/requireStaff";
import { log, serializeError } from "@/lib/log";
import { getPusher } from "@/lib/pusher/server";

export const dynamic = "force-dynamic";

interface CreateBody {
  body?: string;
  isInternal?: boolean;
}

/**
 * POST /api/tickets/[id]/comments
 *
 * Adds a comment. The first non-internal staff comment also stamps
 * `tickets.first_response_at` (single update guarded by
 * `where first_response_at is null`). Pusher emits
 * `ticket-comment-added` for live UIs.
 */
export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const requestId = crypto.randomUUID();
  try {
    const guard = await requireStaff();
    if (guard instanceof NextResponse) return guard;
    const { id } = await context.params;
    const body = (await req.json()) as CreateBody;
    const text = (body.body ?? "").trim();
    const isInternal = !!body.isInternal;
    if (!text) {
      return NextResponse.json(
        { error: "body is required" },
        { status: 400 }
      );
    }

    // Guard: ensure the ticket exists. Cheap select; the FK on ticket_id
    // would also fail the insert but a 404 here is friendlier.
    const [ticket] = await db
      .select({ id: tickets.id, firstResponseAt: tickets.firstResponseAt })
      .from(tickets)
      .where(eq(tickets.id, id))
      .limit(1);
    if (!ticket) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const [inserted] = await db
      .insert(ticketComments)
      .values({
        ticketId: id,
        authorId: guard.userId,
        body: text,
        isInternal,
      })
      .returning();

    // Stamp first_response_at only on the first NON-internal staff
    // comment. The `where first_response_at IS NULL` guard means we
    // never stomp a previous stamp.
    if (!isInternal) {
      try {
        await db
          .update(tickets)
          .set({ firstResponseAt: inserted.createdAt, updatedAt: new Date() })
          .where(
            and(eq(tickets.id, id), isNull(tickets.firstResponseAt))
          );
      } catch (error) {
        log.warn("tickets.comment_first_response_failed", {
          ticketId: id,
          error: serializeError(error),
        });
      }
    }

    try {
      const pusher = getPusher();
      await pusher.trigger("alerts", "ticket-comment-added", {
        ticketId: id,
        commentId: inserted.id,
        isInternal,
      });
    } catch (error) {
      log.warn("tickets.comment_pusher_failed", {
        ticketId: id,
        error: serializeError(error),
      });
    }

    return NextResponse.json({ comment: inserted }, { status: 201 });
  } catch (error) {
    log.error("tickets.comment_create_failed", {
      requestId,
      error: serializeError(error),
    });
    return NextResponse.json(
      { error: "Failed to add comment" },
      { status: 500 }
    );
  }
}
