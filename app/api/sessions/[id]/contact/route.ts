import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sessions, customerContacts } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { enforce, getClientIp } from "@/lib/rateLimit";
import { verifySessionAccess } from "@/lib/sessions/verifySessionToken";
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
    const rl = await enforce(`contact:${ip}`, 5, 60);
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

    const body = await req.json().catch(() => ({}));
    const email = typeof body.email === "string" ? body.email.trim() : "";
    const name = typeof body.name === "string" ? body.name.trim() : null;
    const phone = typeof body.phone === "string" ? body.phone.trim() : null;
    const consent = body.consent === true;

    if (!consent) {
      return NextResponse.json(
        { error: "Consent is required to save contact info." },
        { status: 400 }
      );
    }

    if (!EMAIL_RE.test(email)) {
      return NextResponse.json(
        { error: "Please enter a valid email address." },
        { status: 400 }
      );
    }

    // Verify session exists.
    const [sessionRow] = await db
      .select({ id: sessions.id })
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .limit(1);
    if (!sessionRow) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    // Both writes can run in parallel — the contact insert references the
    // session row which already exists; the session update is idempotent.
    await Promise.all([
      db
        .update(sessions)
        .set({
          customerEmail: email,
          ...(name ? { customerName: name } : {}),
        })
        .where(eq(sessions.id, sessionId)),
      db.insert(customerContacts).values({
        sessionId,
        email,
        name: name || undefined,
        phone: phone || undefined,
        consent,
      }),
    ]);

    return NextResponse.json({ ok: true });
  } catch (error) {
    log.error("sessions.contact.unhandled", {
      requestId,
      error: serializeError(error),
    });
    return NextResponse.json(
      { error: "Failed to save contact info." },
      { status: 500 }
    );
  }
}
