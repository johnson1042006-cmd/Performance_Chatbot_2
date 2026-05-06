import { NextRequest, NextResponse } from "next/server";
import { recordSessionHeartbeat, processDueAiClaims } from "@/lib/sessions/state";

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
    // to load the dashboard. processDueAiClaims is internally racey-safe
    // and bounded (limit 20 per call), so concurrent heartbeats are fine.
    void processDueAiClaims();
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
