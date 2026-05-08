import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { sessions, chatEvents, messages } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getPusher } from "@/lib/pusher/server";
import { enforce, getClientIp } from "@/lib/rateLimit";
import { log, serializeError } from "@/lib/log";
import {
  sendTechAirRequestEmail,
  type TechAirRequestPayload,
} from "@/lib/email/templates/tech-air-request";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const payloadSchema = z.object({
  fullName: z.string().trim().min(1),
  email: z.string().trim().email(),
  phone: z.string().trim().optional(),
  airbagModel: z.string().trim().min(1),
  serialNumber: z.string().trim().min(1),
  serviceRequested: z.string().trim().min(1),
  description: z.string().trim().min(1).max(500),
  returnShippingAddress: z.string().trim().min(1),
  preferredReturnShipping: z
    .enum(["Standard ground", "Expedited at customer expense"])
    .default("Standard ground"),
  consent: z.literal(true),
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
    const rl = await enforce(`service-request:${ip}`, 3, 60);
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
    const parsed = payloadSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request payload." },
        { status: 400 }
      );
    }

    const payload: TechAirRequestPayload = parsed.data;

    const [sessionRow] = await db
      .select({
        id: sessions.id,
        customerEmail: sessions.customerEmail,
        customerName: sessions.customerName,
        status: sessions.status,
      })
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .limit(1);
    if (!sessionRow) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    if (sessionRow.status === "closed") {
      return NextResponse.json({ error: "Session is closed" }, { status: 410 });
    }

    // Internal note: visible to agents, never broadcast to customer channel.
    try {
      await db.insert(chatEvents).values({
        sessionId,
        type: "internal_note",
        metadata: {
          kind: "tech_air_service_request",
          payload,
        },
      });
    } catch (noteError) {
      log.warn("tech_air_request.note_insert_failed", {
        requestId,
        sessionId,
        error: serializeError(noteError),
      });
      // Non-fatal: still allow the request to proceed.
    }

    const serviceInbox = process.env.SERVICE_INBOX;
    if (!serviceInbox) {
      return NextResponse.json(
        { error: "SERVICE_INBOX is not configured on this site." },
        { status: 503 }
      );
    }

    // Send the email (include customer for receipt).
    const recipients = [serviceInbox, payload.email];
    const emailResult = await sendTechAirRequestEmail({
      to: recipients,
      payload,
      replyTo: payload.email,
    });
    if (!emailResult.ok) {
      // Mirror the sender's 503/502 semantics; add a clearer customer-facing
      // message when email is disabled.
      if (emailResult.status === 503) {
        log.warn("tech_air_request.email_disabled", { requestId, sessionId });
        return NextResponse.json(
          {
            error:
              "Email is not configured on this site. Please call 303-744-2011 for Tech-Air service.",
          },
          { status: 503 }
        );
      }
      return NextResponse.json(
        { error: emailResult.error ?? "Failed to send request email." },
        { status: emailResult.status }
      );
    }

    // Customer-facing confirmation message (persisted like other server drops).
    const confirmation = `Got it — your Tech-Air service request is in. We'll reply to **${payload.email}** within 1 business day to confirm next steps. Ship the airbag with a copy of this request to: Performance Cycle, Attn: Tech-Air Service, 7375 S Fulton St, Centennial CO 80112. Tracking is recommended.`;
    const [savedMessage] = await db
      .insert(messages)
      .values({
        sessionId,
        role: "ai",
        content: confirmation,
        redactionHits: [],
        confidence: "high",
        sentiment: 0,
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
        confidence: "high",
        sentiment: 0,
      });
    } catch (pusherError) {
      log.warn("tech_air_request.pusher_failed", {
        requestId,
        sessionId,
        error: serializeError(pusherError),
      });
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (error) {
    log.error("tech_air_request.unhandled", {
      requestId,
      error: serializeError(error),
    });
    return NextResponse.json(
      { error: "Failed to submit Tech-Air request." },
      { status: 500 }
    );
  }
}

