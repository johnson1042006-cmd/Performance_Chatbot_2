import {
  getOrderByEmailAndOrderId,
  getOrderShipments,
  BC_ORDER_STATUS,
  type BCOrder,
  type BCShipment,
} from "@/lib/bigcommerce/client";

/**
 * Build a customer-facing tracking URL from a carrier name + tracking number.
 * BC's `tracking_link` field is sometimes populated, sometimes not; if it is,
 * prefer it. Otherwise we synthesize the canonical link for the carrier.
 * Returns null when we can't build a sensible link.
 */
export function buildTrackingUrl(shipment: BCShipment): string | null {
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

export function buildOrderSummary(order: BCOrder, shipments: BCShipment[]): string {
  const statusLabel =
    BC_ORDER_STATUS[order.status_id] || order.status || "Unknown status";
  const lines: string[] = [];
  lines.push(`**Order #${order.id}** — *${statusLabel}* (${formatDate(order.date_created)})`);
  lines.push(`Total: **${formatTotal(order)}**`);
  lines.push(`Items shipped: ${order.items_shipped} / ${order.items_total}`);

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

export interface LookupOrderResult {
  found: boolean;
  order?: BCOrder;
  shipments?: BCShipment[];
  summary?: string;
}

/**
 * Pure lookup of an order by email + orderId. Performs the BC v2 query and
 * (when applicable) shipment fetch, and returns a markdown summary suitable
 * for either persisting to messages or returning to a tool caller. Does NOT
 * persist anything, fire Pusher events, or apply rate limits — those are
 * handled by the calling layer (the public route still rate-limits per-IP).
 */
export async function lookupOrder(
  email: string,
  orderId: number
): Promise<LookupOrderResult> {
  const order = await getOrderByEmailAndOrderId(email, orderId);
  if (!order) return { found: false };

  // Only fetch shipments for statuses where they're meaningful. Saves a
  // round-trip on Pending / Awaiting Payment orders that BC will return
  // empty for anyway.
  const SHIPPED_STATUSES = new Set([2, 3, 10]);
  const shipments = SHIPPED_STATUSES.has(order.status_id)
    ? await getOrderShipments(order.id)
    : [];

  return {
    found: true,
    order,
    shipments,
    summary: buildOrderSummary(order, shipments),
  };
}
