import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { alertEvents } from "@/lib/db/schema";
import { desc, isNull } from "drizzle-orm";
import { requireManager } from "@/lib/auth/requireManager";
import { log, serializeError } from "@/lib/log";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/alert-events?status=unacked|all&limit=20
 *
 * Returns recent alert events for the AlertsBanner / Sidebar bell. The
 * banner queries `status=unacked` so only unresolved alerts surface.
 */
export async function GET(req: NextRequest) {
  const requestId = crypto.randomUUID();
  try {
    const guard = await requireManager();
    if (guard instanceof NextResponse) return guard;

    const url = new URL(req.url);
    const status = url.searchParams.get("status") ?? "unacked";
    const limit = Math.min(
      100,
      Math.max(1, parseInt(url.searchParams.get("limit") ?? "20", 10) || 20)
    );

    const query = db.select().from(alertEvents).orderBy(desc(alertEvents.firedAt));
    const rows =
      status === "unacked"
        ? await query.where(isNull(alertEvents.ackedAt)).limit(limit)
        : await query.limit(limit);

    return NextResponse.json({ events: rows });
  } catch (error) {
    log.error("admin.alert_events_get_failed", {
      requestId,
      error: serializeError(error),
    });
    return NextResponse.json(
      { error: "Failed to fetch events" },
      { status: 500 }
    );
  }
}
