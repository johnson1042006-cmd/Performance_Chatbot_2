import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { messages, sessions } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { BC_ORDER_STATUS } from "@/lib/bigcommerce/client";
import { lookupOrder, buildTrackingUrl } from "@/lib/orders/lookup";
import { getPusher } from "@/lib/pusher/server";
import { enforce, getClientIp } from "@/lib/rateLimit";
import { log, serializeError } from "@/lib/log";

// Loose RFC 5322-ish check; the goal here is to reject obvious junk before
// hitting BC, not to be a full email validator. BC will reject anything that
// is genuinely invalid on its end.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  const requestId = crypto.randomUUID();
  try {
    const ip = getClientIp(req);
    const rl = await enforce(`orders:${ip}`, 10, 60);
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
    const orderIdRaw = body.orderId;
    const sessionId =
      typeof body.sessionId === "string" ? body.sessionId.trim() : "";

    if (!EMAIL_RE.test(email)) {
      return NextResponse.json(
        { error: "Please enter a valid email address." },
        { status: 400 }
      );
    }
    const orderId =
      typeof orderIdRaw === "number" ? orderIdRaw : parseInt(String(orderIdRaw), 10);
    if (!Number.isFinite(orderId) || orderId <= 0 || !Number.isInteger(orderId)) {
      return NextResponse.json(
        { error: "Order number must be a positive integer." },
        { status: 400 }
      );
    }
    if (!UUID_RE.test(sessionId)) {
      return NextResponse.json(
        { error: "Invalid sessionId." },
        { status: 400 }
      );
    }

    // Verify the session exists before we insert any messages tied to it.
    const [sessionRow] = await db
      .select({ id: sessions.id })
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .limit(1);
    if (!sessionRow) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const result = await lookupOrder(email, orderId);
    if (!result.found || !result.order) {
      return NextResponse.json({ found: false });
    }
    const order = result.order;
    const shipments = result.shipments ?? [];
    const summary = result.summary!;

    const [savedMessage] = await db
      .insert(messages)
      .values({
        sessionId,
        role: "ai",
        content: summary,
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
      log.warn("orders.lookup.pusher_failed", {
        requestId,
        sessionId,
        error: serializeError(pusherError),
      });
    }

    return NextResponse.json({
      found: true,
      order: {
        id: order.id,
        status: BC_ORDER_STATUS[order.status_id] || order.status,
        statusId: order.status_id,
        dateCreated: order.date_created,
        totalIncTax: order.total_inc_tax,
        currencyCode: order.currency_code,
        itemsTotal: order.items_total,
        itemsShipped: order.items_shipped,
        shipments: shipments.map((s) => ({
          id: s.id,
          trackingNumber: s.tracking_number,
          trackingCarrier: s.tracking_carrier,
          trackingUrl: buildTrackingUrl(s),
        })),
      },
      message: { id: savedMessage.id, sentAt: savedMessage.sentAt },
    });
  } catch (error) {
    log.error("orders.lookup.unhandled", {
      requestId,
      error: serializeError(error),
    });
    return NextResponse.json(
      { error: "Failed to look up order. Please try again." },
      { status: 500 }
    );
  }
}
