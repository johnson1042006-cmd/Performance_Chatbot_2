import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { sessions, chatEvents } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { enforce, getClientIp } from "@/lib/rateLimit";
import { log, serializeError } from "@/lib/log";
import { escalateToHuman } from "@/lib/ai/tools";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const schema = z.object({
  tire: z.object({
    year: z.number().int().min(1980).max(new Date().getFullYear()),
    make: z.string().min(1),
    model: z.string().min(1),
    currentTireSize: z.string().optional(),
    ridingType: z.string().min(1),
    priority: z.string().min(1),
  }),
});

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const requestId = crypto.randomUUID();
  try {
    const sessionId = params.id;
    if (!UUID_RE.test(sessionId)) {
      return NextResponse.json({ error: "Invalid sessionId" }, { status: 400 });
    }

    const ip = getClientIp(req);
    const rl = await enforce(`tire-escalate:${ip}`, 3, 60);
    if (!rl.ok) {
      return NextResponse.json(
        { error: "rate_limited" },
        {
          status: 429,
          headers: { "Retry-After": String(rl.retryAfter ?? 60) },
        }
      );
    }

    const body = await req.json().catch(() => ({}));
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
    }

    const [sessionRow] = await db
      .select({ id: sessions.id, status: sessions.status })
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .limit(1);
    if (!sessionRow) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    if (sessionRow.status === "closed") {
      return NextResponse.json({ error: "Session is closed" }, { status: 410 });
    }

    // Persist internal context for the agent.
    try {
      await db.insert(chatEvents).values({
        sessionId,
        type: "internal_note",
        metadata: {
          kind: "tire_fitment_context",
          payload: parsed.data.tire,
        },
      });
    } catch (err) {
      log.warn("tire_escalate.note_insert_failed", {
        requestId,
        sessionId,
        error: serializeError(err),
      });
    }

    await escalateToHuman(sessionId, "unsupported", "normal");
    return NextResponse.json({ ok: true });
  } catch (error) {
    log.error("tire_escalate.unhandled", {
      requestId,
      error: serializeError(error),
    });
    return NextResponse.json(
      { error: "Failed to connect to the team." },
      { status: 500 }
    );
  }
}

