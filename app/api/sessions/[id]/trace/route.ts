import { NextRequest, NextResponse } from "next/server";
import { getStaffSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { chatEvents } from "@/lib/db/schema";
import { and, eq, asc, inArray } from "drizzle-orm";
import { log, serializeError } from "@/lib/log";

export const dynamic = "force-dynamic";

/**
 * Phase 3 AI trace endpoint. Returns chat_events of type "tool_call" and
 * "auto_escalated" in chronological order so the dashboard AITrace panel
 * can render the AI's tool-use timeline for the active session.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const requestId = crypto.randomUUID();
  try {
    const auth = await getStaffSession();
    if (!auth?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const events = await db
      .select({
        id: chatEvents.id,
        type: chatEvents.type,
        metadata: chatEvents.metadata,
        createdAt: chatEvents.createdAt,
      })
      .from(chatEvents)
      .where(
        and(
          eq(chatEvents.sessionId, params.id),
          inArray(chatEvents.type, ["tool_call", "auto_escalated"])
        )
      )
      .orderBy(asc(chatEvents.createdAt));

    return NextResponse.json({ events });
  } catch (error) {
    log.error("sessions.trace_fetch_failed", {
      requestId,
      sessionId: params.id,
      error: serializeError(error),
    });
    return NextResponse.json(
      { error: "Failed to fetch trace" },
      { status: 500 }
    );
  }
}
