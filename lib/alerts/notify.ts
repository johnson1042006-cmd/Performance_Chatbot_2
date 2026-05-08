/**
 * Slack notifier for Phase 5 alerts.
 *
 * Builds a Slack Block Kit payload with a header, threshold context, and a
 * "View dashboard" button. POSTs to `SLACK_WEBHOOK_URL` if it's set;
 * otherwise no-ops silently so unconfigured environments don't block the
 * cron tick.
 */
import { log, serializeError } from "@/lib/log";

export interface AlertContext {
  kind: string;
  comparator: string;
  threshold: number | string;
  value: number | string;
  message: string;
  /** Optional override for the dashboard link. Defaults to NEXT_PUBLIC_DASHBOARD_URL || NEXTAUTH_URL. */
  dashboardUrl?: string;
}

export interface SlackBlockKitPayload {
  blocks: Array<Record<string, unknown>>;
}

const FRIENDLY_KIND: Record<string, string> = {
  queue_depth: "Queue depth",
  ai_failure_rate_pct: "AI failure rate",
  no_agents_online_during_hours: "No agents online during business hours",
};

export function buildSlackPayload(ctx: AlertContext): SlackBlockKitPayload {
  const friendly = FRIENDLY_KIND[ctx.kind] ?? ctx.kind;
  const dashboardUrl =
    ctx.dashboardUrl ||
    process.env.NEXT_PUBLIC_DASHBOARD_URL ||
    process.env.NEXTAUTH_URL ||
    "https://example.com";

  return {
    blocks: [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: `Alert: ${friendly}`,
          emoji: false,
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Threshold:* ${ctx.kind} ${ctx.comparator} ${ctx.threshold}\n*Current value:* ${ctx.value}\n${ctx.message}`,
        },
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "View dashboard" },
            url: `${dashboardUrl.replace(/\/$/, "")}/dashboard`,
          },
        ],
      },
    ],
  };
}

/**
 * Fires a Slack notification. Returns true on success, false on missing
 * webhook or transport failure. Never throws.
 */
export async function sendSlackAlert(ctx: AlertContext): Promise<boolean> {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) {
    log.info("alerts.slack_skipped", { reason: "no_webhook_configured" });
    return false;
  }
  const payload = buildSlackPayload(ctx);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      log.warn("alerts.slack_failed", {
        status: res.status,
        statusText: res.statusText,
      });
      return false;
    }
    return true;
  } catch (error) {
    log.warn("alerts.slack_error", { error: serializeError(error) });
    return false;
  }
}
