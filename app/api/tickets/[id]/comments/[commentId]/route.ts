import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ticketComments } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { requireStaff } from "@/lib/auth/requireStaff";
import { log, serializeError } from "@/lib/log";

export const dynamic = "force-dynamic";

/**
 * DELETE /api/tickets/[id]/comments/[commentId]
 *
 * Allowed for the comment author OR any manager.
 */
export async function DELETE(
  _req: Request,
  context: { params: Promise<{ id: string; commentId: string }> }
) {
  const requestId = crypto.randomUUID();
  try {
    const guard = await requireStaff();
    if (guard instanceof NextResponse) return guard;
    const { commentId } = await context.params;

    const [existing] = await db
      .select()
      .from(ticketComments)
      .where(eq(ticketComments.id, commentId))
      .limit(1);
    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const isAuthor = existing.authorId === guard.userId;
    const isManager = guard.role === "store_manager";
    if (!isAuthor && !isManager) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    await db.delete(ticketComments).where(eq(ticketComments.id, commentId));
    return NextResponse.json({ ok: true });
  } catch (error) {
    log.error("tickets.comment_delete_failed", {
      requestId,
      error: serializeError(error),
    });
    return NextResponse.json(
      { error: "Failed to delete comment" },
      { status: 500 }
    );
  }
}
