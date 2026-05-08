import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { messages, sessions } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import {
  getOrderByEmailAndOrderId,
  getOrderShipments,
  BC_ORDER_STATUS,
  type BCOrder,
  type BCShipment,
} from "@/lib/bigcommerce/client";
import { getPusher } from "@/lib/pusher/server";
import { enforce, getClientIp } from "@/lib/rateLimit";
import { log, serializeError } from "@/lib/log";

// Loose RFC 5322-ish check; the goal here is to reject obvious junk before
// hitting BC, not to be a full email validator. BC will reject anything that
// is genuinely invalid on its end.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Build a customer-facing tracking URL from a carrier name + tracking number.
 * BC's `tracking_link` field is sometimes populated, sometimes not; if it is,
 * prefer it. Otherwise we synthesize the canonical link for the carrier.
 * Returns null when we can't build a sensible link.
 */
function buildTrackingUrl(shipment: BCShipment): string | null {
  if (shipment.tracking_link && shipment.tracking_link.length > 0) {
    return shipment.tracking_link;
  }
  if (!shipment.tracking_number) return null;
  const carrier = (shipment.tracking_carrier || shipment.shipping_provider || "")
    .toLowerCase()
    .trim();
  const num = encodeURIComponent(shipment.tracking_number);
  if (carrier.includes("ups")) {
    return `https://www.ups.com/track?tracknum=${num}`;
  }
  if (carrier.includes("fedex")) {
    return `https://www.fedex.com/fedextrack/?tracknumbers=${num}`;
  }
  if (carrier.includes("usps")) {
    return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${num}`;
  }
  return null;
}

function formatDate(iso: string): string {
  // BC returns RFC 1123 strings ("Mon, 12 Jan 2026 09:14:25 +0000"); fall back
  // to the raw value if Date parsing fails so we never crash the summary.
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatTotal(order: BCOrder): string {
  const num = Number(order.total_inc_tax);
  if (Number.isNaN(num)) return `${order.currency_code} ${order.total_inc_tax}`;
  return `$${num.toFixed(2)}`;
}

function buildSummary(order: BCOrder, shipments: BCShipment[]): string {
  const statusLabel =
    BC_ORDER_STATUS[order.status_id] || order.status || "Unknown status";
  const lines: string[] = [];
  lines.push(`**Order #${order.id}** — *${statusLabel}* (${formatDate(order.date_created)})`);
  lines.push(`Total: **${formatTotal(order)}**`);
  lines.push(`Items shipped: ${order.items_shipped} / ${order.items_total}`);

  // Only emit a tracking line for orders that have at least one shipment with
  // a tracking number. The label "Tracking" stays out of the summary entirely
  // for unshipped orders so we don't show a half-empty row.
  const tracked = shipments.filter((s) => s.tracking_number);
  if (tracked.length > 0) {
    const links = tracked
      .map((s) => {
        const url = buildTrackingUrl(s);
        return url
          ? `[${s.tracking_number}](${url})`
          : `${s.tracking_number}`;
      })
      .join(", ");
    lines.push(`Tracking: ${links}`);
  }

  return lines.join("\n");
}

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

    const order = await getOrderByEmailAndOrderId(email, orderId);
    if (!order) {
      return NextResponse.json({ found: false });
    }

    // Only fetch shipments for statuses where they're meaningful. Saves a
    // round-trip on Pending / Awaiting Payment orders that BC will return
    // empty for anyway.
    const SHIPPED_STATUSES = new Set([2, 3, 10]);
    const shipments = SHIPPED_STATUSES.has(order.status_id)
      ? await getOrderShipments(order.id)
      : [];

    const summary = buildSummary(order, shipments);

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
