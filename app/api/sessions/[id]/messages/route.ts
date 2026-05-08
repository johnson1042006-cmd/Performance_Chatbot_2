import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { messages } from "@/lib/db/schema";
import { eq, asc } from "drizzle-orm";
import { processDueAiClaims, sweepStaleSessions } from "@/lib/sessions/state";
import { log, serializeError } from "@/lib/log";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const requestId = crypto.randomUUID();
  try {
    // Lazy tick — run on each dashboard poll
    await Promise.allSettled([sweepStaleSessions(), processDueAiClaims()]);

    const sessionMessages = await db
      .select()
      .from(messages)
      .where(eq(messages.sessionId, params.id))
      .orderBy(asc(messages.sentAt));

    return NextResponse.json({ messages: sessionMessages });
  } catch (error) {
    log.error("sessions.messages_fetch_failed", {
      requestId,
      sessionId: params.id,
      error: serializeError(error),
    });
    return NextResponse.json(
      { error: "Failed to fetch messages" },
      { status: 500 }
    );
  }
}
