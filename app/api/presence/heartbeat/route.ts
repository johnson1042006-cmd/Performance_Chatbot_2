import { NextResponse } from "next/server";
import { getStaffSession } from "@/lib/auth";
import { passwordResetGate } from "@/lib/auth/passwordResetGate";
import { recordAgentHeartbeat } from "@/lib/presence";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const session = await getStaffSession();
    const resetDenied = passwordResetGate(session);
    if (resetDenied) return resetDenied;
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    await recordAgentHeartbeat(session.user.id);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
