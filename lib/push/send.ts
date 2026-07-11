/**
 * Web Push delivery for escalation alerts. Sends a native desktop
 * notification to every agent/manager who has enabled alerts on a device,
 * even when no dashboard tab is open. This complements the in-page
 * `notifyEscalation` chime/banner (which only fires while a tab is open).
 *
 * Best-effort by design: every failure path is swallowed so a push outage
 * never blocks or throws into the escalation flow. Subscriptions that the
 * push service reports as gone (404/410) are pruned so the table stays clean.
 */
import webpush from "web-push";
import { db } from "@/lib/db";
import { pushSubscriptions } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { log, serializeError } from "@/lib/log";

// Mirror of the customer-facing reason labels used by the in-page notifier so
// the push title matches what agents see elsewhere.
const REASON_LABELS: Record<string, string> = {
  complex_fitment: "Fitment question — service team needed",
  tech_air_service: "Tech-Air service request",
  frustrated_customer: "Customer is frustrated",
  explicit_request: "Customer asked for a human",
  policy_exception: "Policy exception",
  unsupported: "Unsupported / escalated",
  no_data: "Bot has no data — customer waiting",
  undeliverable_offer: "Bot offered info it can't deliver",
};

let vapidConfigured = false;

function ensureVapidConfigured(): boolean {
  if (vapidConfigured) return true;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || "mailto:support@example.com";
  if (!publicKey || !privateKey) return false;
  webpush.setVapidDetails(subject, publicKey, privateKey);
  vapidConfigured = true;
  return true;
}

export interface EscalationPushPayload {
  sessionId: string;
  reason: string;
  urgency: string;
}

export async function sendEscalationPush(
  payload: EscalationPushPayload
): Promise<void> {
  try {
    if (!ensureVapidConfigured()) {
      // VAPID env not set — silently skip (in-page chime still covers it).
      return;
    }

    const subs = await db
      .select({
        endpoint: pushSubscriptions.endpoint,
        p256dh: pushSubscriptions.p256dh,
        auth: pushSubscriptions.auth,
      })
      .from(pushSubscriptions);

    if (subs.length === 0) return;

    const title =
      REASON_LABELS[payload.reason] || `Escalation: ${payload.reason}`;
    const body = JSON.stringify({
      title,
      body:
        payload.urgency === "high"
          ? "High urgency — open the dashboard to claim"
          : "Open the dashboard to claim",
      tag: `escalation-${payload.sessionId}`,
      url: "/dashboard/chats",
    });

    await Promise.all(
      subs.map(async (sub) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: sub.endpoint,
              keys: { p256dh: sub.p256dh, auth: sub.auth },
            },
            body
          );
        } catch (err) {
          const statusCode = (err as { statusCode?: number })?.statusCode;
          if (statusCode === 404 || statusCode === 410) {
            // Subscription is gone — prune it so we stop trying.
            try {
              await db
                .delete(pushSubscriptions)
                .where(eq(pushSubscriptions.endpoint, sub.endpoint));
            } catch (delErr) {
              log.warn("push.send.prune_failed", {
                error: serializeError(delErr),
              });
            }
          } else {
            log.warn("push.send.notification_failed", {
              statusCode,
              error: serializeError(err),
            });
          }
        }
      })
    );
  } catch (err) {
    log.warn("push.send.failed", {
      sessionId: payload.sessionId,
      error: serializeError(err),
    });
  }
}
