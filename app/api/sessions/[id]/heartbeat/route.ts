import { NextRequest, NextResponse } from "next/server";
import { recordSessionHeartbeat } from "@/lib/sessions/state";
import { maybeLazyTick } from "@/lib/sessions/lazyTick";

export const dynamic = "force-dynamic";

/**
 * Public endpoint — the embed widget calls this every 30s while the tab is
 * visible to prove the customer is still present. SessionId is the only auth.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
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
