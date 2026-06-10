import { NextRequest, NextResponse } from "next/server";
import { recordSessionHeartbeat } from "@/lib/sessions/state";
import { maybeLazyTick } from "@/lib/sessions/lazyTick";
import { verifySessionAccess } from "@/lib/sessions/verifySessionToken";
import { enforce, getClientIp } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

/**
 * Customer endpoint — the embed widget calls this every 30s while the tab is
 * visible to prove the customer is still present. Access requires the session
 * token (or a staff NextAuth session).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const ip = getClientIp(req);
    const rl = await enforce(`hb:${ip}`, 120, 60);
    if (!rl.ok) {
      return NextResponse.json(
        { error: "rate_limited" },
        { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } }
      );
    }

    if (!(await verifySessionAccess(req, params.id))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await recordSessionHeartbeat(params.id);
    // Backstop: as long as a customer's tab is open and beating, fire the
    // AI claim sweep so a queued chat doesn't hang waiting for a manager
    // to load the dashboard. Debounced (per-instance, 30s) and fire-and-forget
    // so frequent heartbeats don't each trigger a global sweep.
    void maybeLazyTick();
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
