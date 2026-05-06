import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { claimByHuman } from "@/lib/sessions/state";
import { getPusher } from "@/lib/pusher/server";

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { sessionId } = body;

    if (!sessionId) {
      return NextResponse.json(
        { error: "sessionId is required" },
        { status: 400 }
      );
    }

    const result = await claimByHuman({
      sessionId,
      userId: session.user.id,
    });

    if (!result.claimed) {
      return NextResponse.json(
        {
          error: "Session already claimed",
          claimedBy: result.claimedByUser ?? null,
        },
        { status: 409 }
      );
    }

    try {
      const pusher = getPusher();
      await pusher.trigger(`session-${sessionId}`, "session-claimed", {
        agentId: session.user.id,
        agentName: session.user.name,
        kind: "human",
      });
      await pusher.trigger("dashboard", "session-claimed", {
        sessionId,
        agentId: session.user.id,
        agentName: session.user.name,
        kind: "human",
      });
    } catch (pusherError) {
      console.error("Pusher error (non-fatal):", pusherError);
    }

    return NextResponse.json({ session: result.session });
  } catch (error) {
    console.error("Claim error:", error);
    return NextResponse.json(
      { error: "Failed to claim session" },
      { status: 500 }
    );
  }
}
