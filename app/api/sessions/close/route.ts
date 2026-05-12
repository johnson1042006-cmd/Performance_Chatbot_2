import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { sessions } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getPusher } from "@/lib/pusher/server";
import { log, serializeError } from "@/lib/log";
import { enqueueTag } from "@/lib/ai/tagger";

export async function POST(req: NextRequest) {
  const requestId = crypto.randomUUID();
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { sessionId } = body;

    const [updated] = await db
      .update(sessions)
      .set({
        status: "closed",
        closedAt: new Date(),
      })
      .where(eq(sessions.id, sessionId))
      .returning();

    if (!updated) {
      return NextResponse.json(
        { error: "Session not found" },
        { status: 404 }
      );
    }

    try {
      const pusher = getPusher();
      await pusher.trigger("dashboard", "session-closed", { sessionId });
      await pusher.trigger(`session-${sessionId}`, "session-closed", {});
    } catch (pusherError) {
      log.warn("sessions.close.pusher_failed", {
        requestId,
        sessionId,
        error: serializeError(pusherError),
      });
    }

    // Phase 5: fire-and-forget AI tagging. Drops if the in-memory
    // semaphore is full; never blocks the close response.
    enqueueTag(sessionId);

    return NextResponse.json({ session: updated });
  } catch (error) {
    log.error("sessions.close_failed", { requestId, error: serializeError(error) });
    return NextResponse.json(
      { error: "Failed to close session" },
      { status: 500 }
    );
  }
}
