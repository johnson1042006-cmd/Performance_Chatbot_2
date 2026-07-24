import { NextResponse } from "next/server";
import { getStaffSession } from "@/lib/auth";
import { recordAgentHeartbeat } from "@/lib/presence";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const session = await getStaffSession();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    await recordAgentHeartbeat(session.user.id);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
