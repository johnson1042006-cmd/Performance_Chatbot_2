import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { feedback, sessions } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { enforce, getClientIp } from "@/lib/rateLimit";
import { log, serializeError } from "@/lib/log";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_RATINGS = new Set(["up", "down"]);
const COMMENT_MAX = 2000;

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
    const rl = await enforce(`feedback:${ip}`, 5, 60);
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
    const rating = typeof body.rating === "string" ? body.rating : "";
    if (!VALID_RATINGS.has(rating)) {
      return NextResponse.json(
        { error: "Rating must be 'up' or 'down'." },
        { status: 400 }
      );
    }
    const commentRaw = typeof body.comment === "string" ? body.comment : null;
    const comment = commentRaw ? commentRaw.trim().slice(0, COMMENT_MAX) : null;

    // Verify session exists.
    const [sessionRow] = await db
      .select({ id: sessions.id })
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .limit(1);
    if (!sessionRow) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    await db.insert(feedback).values({
      sessionId,
      rating,
      comment: comment && comment.length > 0 ? comment : null,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    log.error("feedback.unhandled", {
      requestId,
      error: serializeError(error),
    });
    return NextResponse.json(
      { error: "Failed to save feedback." },
      { status: 500 }
    );
  }
}
