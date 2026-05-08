import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getAllAgentsWithPresence } from "@/lib/presence";
import { log, serializeError } from "@/lib/log";

export const dynamic = "force-dynamic";

export async function GET() {
  const requestId = crypto.randomUUID();
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
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
