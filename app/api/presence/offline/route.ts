import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { markAgentOffline } from "@/lib/presence";

export const dynamic = "force-dynamic";

/**
 * Called via navigator.sendBeacon when the agent closes/hides the tab.
 * sendBeacon sends a POST with no body; we rely on the auth cookie.
 */
export async function POST() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    await markAgentOffline(session.user.id);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
