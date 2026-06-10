import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { messages } from "@/lib/db/schema";
import { eq, asc } from "drizzle-orm";
import { maybeLazyTick } from "@/lib/sessions/lazyTick";
import { verifySessionAccess } from "@/lib/sessions/verifySessionToken";
import { enforce, getClientIp } from "@/lib/rateLimit";
import { log, serializeError } from "@/lib/log";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const requestId = crypto.randomUUID();
  try {
    const ip = getClientIp(req);
    const rl = await enforce(`msgs:${ip}`, 60, 60);
    if (!rl.ok) {
      return NextResponse.json(
        { error: "rate_limited" },
        { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } }
      );
    }

    if (!(await verifySessionAccess(req, params.id))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Lazy tick — debounced so per-session widget polls don't each sweep.
    await maybeLazyTick();

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
