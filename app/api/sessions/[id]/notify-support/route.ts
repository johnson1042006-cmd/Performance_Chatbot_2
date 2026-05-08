import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sessions, messages } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { sendSupportNotification } from "@/lib/email/transcript";
import { getPusher } from "@/lib/pusher/server";
import { enforce, getClientIp } from "@/lib/rateLimit";
import { log, serializeError } from "@/lib/log";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Sends a callback notification to SUPPORT_INBOX with the conversation
 * summary, then drops a customer-facing AI message confirming the handoff.
 * Called immediately after /api/sessions/[id]/contact in the
 * "Talk to a human + no agents online" flow.
 */
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
    const rl = await enforce(`notify-support:${ip}`, 3, 60);
    if (!rl.ok) {
      return NextResponse.json(
        { error: "rate_limited" },
        {
          status: 429,
          headers: { "Retry-After": String(rl.retryAfter ?? 60) },
        }
      );
    }

    const [sessionRow] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .limit(1);
    if (!sessionRow) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    if (!sessionRow.customerEmail) {
      return NextResponse.json(
        { error: "Capture customer contact info first." },
        { status: 400 }
      );
    }

    const result = await sendSupportNotification({
      sessionId,
      customerEmail: sessionRow.customerEmail,
      customerName: sessionRow.customerName,
    });

    if (!result.ok) {
      // 503 (no api key) or 502 (resend failure). Either way the customer
      // shouldn't see a generic 500 — we mirror the helper's message back.
      return NextResponse.json(
        { error: result.error ?? "Failed to notify the team." },
        { status: result.status }
      );
    }

    // Drop a customer-facing AI confirmation. The email shown back to the
    // customer is the one they just consented to.
    const confirmation = `Thanks — we'll email you at **${sessionRow.customerEmail}** as soon as a teammate is back.`;
    const [savedMessage] = await db
      .insert(messages)
      .values({
        sessionId,
        role: "ai",
        content: confirmation,
        redactionHits: [],
      })
      .returning();

    try {
      const pusher = getPusher();
      await pusher.trigger(`session-${sessionId}`, "new-message", {
        id: savedMessage.id,
        role: "ai",
        content: savedMessage.content,
        sentAt: savedMessage.sentAt,
      });
      await pusher.trigger("dashboard", "session-update", {
        sessionId,
        lastMessage: savedMessage.content,
        role: "ai",
      });
    } catch (pusherError) {
      log.warn("notify_support.pusher_failed", {
        requestId,
        sessionId,
        error: serializeError(pusherError),
      });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    log.error("notify_support.unhandled", {
      requestId,
      error: serializeError(error),
    });
    return NextResponse.json(
      { error: "Failed to notify support." },
      { status: 500 }
    );
  }
}
