import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sessions } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { anyAgentsOnline } from "@/lib/presence";
import { getPusher } from "@/lib/pusher/server";
import { enforce, getClientIp } from "@/lib/rateLimit";
import { verifySessionAccess } from "@/lib/sessions/verifySessionToken";
import { log, serializeError } from "@/lib/log";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Customer asked to talk to a human. Two paths:
 *
 *  1. anyAgentsOnline() == true:
 *     - Clear sessions.aiClaimDueAt so the AI fallback timer doesn't fire.
 *     - Notify the dashboard via Pusher session-update so unclaimed badges
 *       refresh.
 *     - Return { status: "queued_for_human" }; widget shows a "connecting"
 *       banner. Existing claim flow handles the rest.
 *
 *  2. anyAgentsOnline() == false:
 *     - Return { status: "needs_email" }; widget renders an email-capture
 *       form. Submission flow is contact -> notify-support -> AI confirm.
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
    const rl = await enforce(`request-human:${ip}`, 5, 60);
    if (!rl.ok) {
      return NextResponse.json(
        { error: "rate_limited" },
        {
          status: 429,
          headers: { "Retry-After": String(rl.retryAfter ?? 60) },
        }
      );
    }

    if (!(await verifySessionAccess(req, sessionId))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const [sessionRow] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .limit(1);
    if (!sessionRow) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    if (sessionRow.status === "closed") {
      return NextResponse.json({ error: "Session is closed" }, { status: 410 });
    }

    const agentsOnline = await anyAgentsOnline();

    if (agentsOnline) {
      await db
        .update(sessions)
        .set({ aiClaimDueAt: null })
        .where(eq(sessions.id, sessionId));

      try {
        const pusher = getPusher();
        await pusher.trigger("dashboard", "session-update", {
          sessionId,
          requestedHuman: true,
        });
      } catch (pusherError) {
        log.warn("request_human.pusher_failed", {
          requestId,
          sessionId,
          error: serializeError(pusherError),
        });
      }

      return NextResponse.json({ status: "queued_for_human" });
    }

    return NextResponse.json({ status: "needs_email" });
  } catch (error) {
    log.error("request_human.unhandled", {
      requestId,
      error: serializeError(error),
    });
    return NextResponse.json(
      { error: "Failed to request human" },
      { status: 500 }
    );
  }
}
