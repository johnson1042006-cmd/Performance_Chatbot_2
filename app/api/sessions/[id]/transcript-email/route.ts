import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sessions, customerContacts } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { sendTranscriptEmail } from "@/lib/email/transcript";
import { enforce, getClientIp } from "@/lib/rateLimit";
import { log, serializeError } from "@/lib/log";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
    const rl = await enforce(`transcript:${ip}`, 3, 60);
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
    const email = typeof body.email === "string" ? body.email.trim() : "";
    const consent = body.consent === true;

    if (!consent) {
      return NextResponse.json(
        { error: "Consent is required to send a transcript." },
        { status: 400 }
      );
    }
    if (!EMAIL_RE.test(email)) {
      return NextResponse.json(
        { error: "Please enter a valid email address." },
        { status: 400 }
      );
    }

    const [sessionRow] = await db
      .select({ id: sessions.id })
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .limit(1);
    if (!sessionRow) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const result = await sendTranscriptEmail({ to: email, sessionId });
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error ?? "Failed to send transcript." },
        { status: result.status }
      );
    }

    // Audit-log the consented contact capture so the manager dashboard can
    // tie the transcript request back to a customer email.
    try {
      await Promise.all([
        db
          .update(sessions)
          .set({ customerEmail: email })
          .where(eq(sessions.id, sessionId)),
        db.insert(customerContacts).values({
          sessionId,
          email,
          consent,
        }),
      ]);
    } catch (auditError) {
      log.warn("transcript.audit_failed", {
        requestId,
        sessionId,
        error: serializeError(auditError),
      });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    log.error("transcript.unhandled", {
      requestId,
      error: serializeError(error),
    });
    return NextResponse.json(
      { error: "Failed to send transcript." },
      { status: 500 }
    );
  }
}
