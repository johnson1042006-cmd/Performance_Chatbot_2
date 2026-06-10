import { NextRequest, NextResponse } from "next/server";
import {
  processDueAiClaims,
  sweepStaleSessions,
  releaseStrandedHumanClaims,
} from "@/lib/sessions/state";
import { evaluateAlertThresholds } from "@/lib/alerts/evaluator";
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
    // Stranded-claim release runs BEFORE processDueAiClaims so a session
    // freed with an already-due timer gets an AI reply on this same tick.
    const strandedReleased = await releaseStrandedHumanClaims().catch((err) => {
      log.error("cron.stranded_release_failed", {
        requestId,
        error: serializeError(err),
      });
      return 0;
    });

    const [staleClosed, aiClaimed, alerts] =
      await Promise.allSettled([
        sweepStaleSessions(),
        processDueAiClaims().then(() => undefined),
        evaluateAlertThresholds(),
      ]);

    return NextResponse.json({
      success: true,
      staleClosed: staleClosed.status === "fulfilled" ? staleClosed.value : 0,
      strandedReleased,
      aiClaimed: aiClaimed.status === "fulfilled" ? true : false,
      alerts: alerts.status === "fulfilled" ? alerts.value : [],
    });
  } catch (error) {
    log.error("cron.tick_failed", { requestId, error: serializeError(error) });
    return NextResponse.json({ error: "Tick failed" }, { status: 500 });
  }
}
