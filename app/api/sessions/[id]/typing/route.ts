import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getPusher } from "@/lib/pusher/server";
import { sessionChannel } from "@/lib/pusher/channels";

export const dynamic = "force-dynamic";

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const authSession = await getServerSession(authOptions);
  if (!authSession?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const pusher = getPusher();
    await pusher.trigger(sessionChannel(params.id), "typing", {
      agentName: authSession.user.name,
    });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
