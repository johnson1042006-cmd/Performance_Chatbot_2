import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { alertEvents } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { requireManager } from "@/lib/auth/requireManager";
import { log, serializeError } from "@/lib/log";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/alert-events/[id]/ack
 *
 * Marks an alert as acknowledged by the calling manager. Used by the
 * AlertsBanner dismiss button and the Sidebar inbox.
 */
export async function POST(
  _req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const requestId = crypto.randomUUID();
  try {
    const guard = await requireManager();
    if (guard instanceof NextResponse) return guard;

    const { id } = await context.params;
    const [row] = await db
      .update(alertEvents)
      .set({ ackedAt: new Date(), ackedBy: guard.userId })
      .where(eq(alertEvents.id, id))
      .returning();

    if (!row) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }

    return NextResponse.json({ event: row });
  } catch (error) {
    log.error("admin.alert_events_ack_failed", {
      requestId,
      error: serializeError(error),
    });
    return NextResponse.json({ error: "Failed to ack" }, { status: 500 });
  }
}
