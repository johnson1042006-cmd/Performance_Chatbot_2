import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth/requireStaff";
import { getAllAgentsWithPresence } from "@/lib/presence";
import { log, serializeError } from "@/lib/log";

export const dynamic = "force-dynamic";

// Staff-only (agent OR manager), not manager-only: agents legitimately read the
// presence list to reassign chats to online colleagues (ChatPanel reassign).
// The prior `!session?.user` check accepted any authenticated session without
// asserting a valid staff role — requireStaff() makes the guard explicit and
// consistent with the rest of the surface.
export async function GET() {
  const requestId = crypto.randomUUID();
  try {
    const guard = await requireStaff();
    if (guard instanceof NextResponse) return guard;
    const agents = await getAllAgentsWithPresence();
    return NextResponse.json({ agents });
  } catch (error) {
    log.error("admin.team_presence_failed", { requestId, error: serializeError(error) });
    return NextResponse.json(
      { error: "Failed to fetch team presence" },
      { status: 500 }
    );
  }
}
