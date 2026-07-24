import { NextRequest, NextResponse } from "next/server";
import { getStaffSession } from "@/lib/auth";
import { passwordResetGate } from "@/lib/auth/passwordResetGate";
import { db } from "@/lib/db";
import { feedback, sessions } from "@/lib/db/schema";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { log, serializeError } from "@/lib/log";

const RECENT_LIMIT = 50;

export async function GET(req: NextRequest) {
  const requestId = crypto.randomUUID();
  try {
    const session = await getStaffSession();
    const resetDenied = passwordResetGate(session);
    if (resetDenied) return resetDenied;
    if (!session?.user || session.user.role !== "store_manager") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const url = new URL(req.url);
    const daysRaw = parseInt(url.searchParams.get("days") || "30", 10);
    // Clamp 1..365 — anything outside is a sign of a malformed query, not a
    // legitimate range. Default 30 matches the dashboard's other windows.
    const days = Number.isFinite(daysRaw)
      ? Math.min(365, Math.max(1, daysRaw))
      : 30;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const summaryRows = await db
      .select({
        total: sql<number>`count(*)::int`,
        up: sql<number>`count(*) filter (where ${feedback.rating} = 'up')::int`,
        down: sql<number>`count(*) filter (where ${feedback.rating} = 'down')::int`,
      })
      .from(feedback)
      .where(gte(feedback.submittedAt, since));

    const summaryRow = summaryRows[0] ?? { total: 0, up: 0, down: 0 };
    const total = Number(summaryRow.total) || 0;
    const up = Number(summaryRow.up) || 0;
    const down = Number(summaryRow.down) || 0;
    // CSAT% = up / (up + down). When there are no ratings yet, surface 0
    // rather than NaN so the UI can render a clean dash.
    const denom = up + down;
    const csat_pct = denom > 0 ? Number(((up / denom) * 100).toFixed(1)) : 0;

    const recent = await db
      .select({
        id: feedback.id,
        sessionId: feedback.sessionId,
        rating: feedback.rating,
        comment: feedback.comment,
        submittedAt: feedback.submittedAt,
        customerEmail: sessions.customerEmail,
      })
      .from(feedback)
      .leftJoin(sessions, eq(sessions.id, feedback.sessionId))
      .where(and(gte(feedback.submittedAt, since)))
      .orderBy(desc(feedback.submittedAt))
      .limit(RECENT_LIMIT);

    return NextResponse.json({
      summary: { total, up, down, csat_pct },
      recent,
    });
  } catch (error) {
    log.error("admin.feedback_get_failed", {
      requestId,
      error: serializeError(error),
    });
    return NextResponse.json(
      { error: "Failed to load feedback." },
      { status: 500 }
    );
  }
}
