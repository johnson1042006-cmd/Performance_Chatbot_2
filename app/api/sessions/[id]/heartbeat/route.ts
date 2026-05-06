import { NextRequest, NextResponse } from "next/server";
import { recordSessionHeartbeat } from "@/lib/sessions/state";

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
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
