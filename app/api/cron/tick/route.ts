import { NextRequest, NextResponse } from "next/server";
import { processDueAiClaims, sweepStaleSessions } from "@/lib/sessions/state";
import { evaluateAlertThresholds } from "@/lib/alerts/evaluator";
import { sweepBreachedTickets } from "@/lib/tickets/sla";
import { log, serializeError } from "@/lib/log";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Called every minute by Vercel Cron (Pro plan) via vercel.json.
 * Also used as a lazy backstop for hobby plans when dashboard polling triggers it.
 */
export async function GET(req: NextRequest) {
  const requestId = crypto.randomUUID();
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET is not configured" },
      { status: 500 }
    );
  }

  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const [staleClosed, aiClaimed, alerts, breachedTickets] =
      await Promise.allSettled([
        sweepStaleSessions(),
        processDueAiClaims().then(() => undefined),
        evaluateAlertThresholds(),
        sweepBreachedTickets(),
      ]);

    return NextResponse.json({
      success: true,
      staleClosed: staleClosed.status === "fulfilled" ? staleClosed.value : 0,
      aiClaimed: aiClaimed.status === "fulfilled" ? true : false,
      alerts: alerts.status === "fulfilled" ? alerts.value : [],
      breachedTickets:
        breachedTickets.status === "fulfilled" ? breachedTickets.value : 0,
    });
  } catch (error) {
    log.error("cron.tick_failed", { requestId, error: serializeError(error) });
    return NextResponse.json({ error: "Tick failed" }, { status: 500 });
  }
}
