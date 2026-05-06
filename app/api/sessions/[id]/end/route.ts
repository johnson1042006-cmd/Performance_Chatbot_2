import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sessions } from "@/lib/db/schema";
import { eq, and, sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

/**
 * Public endpoint — called via navigator.sendBeacon when the customer closes
 * or hides the embed tab. Clears the heartbeat so the stale-session sweep
 * can reclaim this row within ~2 minutes.
 *
 * We deliberately don't hard-close here so a page refresh within the same
 * session storage key still resumes; the sweep handles true abandonment.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await db
      .update(sessions)
      .set({ lastHeartbeatAt: null })
      .where(
        and(
          eq(sessions.id, params.id),
          sql`${sessions.status} != 'closed'`
        )
      );
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
