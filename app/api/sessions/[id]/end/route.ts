import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sessions } from "@/lib/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { verifySessionAccess } from "@/lib/sessions/verifySessionToken";
import { enforce, getClientIp } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

/**
 * Customer endpoint — called via navigator.sendBeacon when the customer closes
 * or hides the embed tab. Clears the heartbeat so the stale-session sweep
 * can reclaim this row within ~2 minutes. sendBeacon cannot set headers, so
 * the token is passed via the ?st= query param.
 *
 * We deliberately don't hard-close here so a page refresh within the same
 * session storage key still resumes; the sweep handles true abandonment.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const ip = getClientIp(req);
    const rl = await enforce(`end:${ip}`, 10, 60);
    if (!rl.ok) {
      return NextResponse.json(
        { error: "rate_limited" },
        { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } }
      );
    }

    if (!(await verifySessionAccess(req, params.id))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

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
