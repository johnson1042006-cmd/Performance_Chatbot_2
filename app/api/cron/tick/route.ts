import { NextRequest, NextResponse } from "next/server";
import { processDueAiClaims, sweepStaleSessions } from "@/lib/sessions/state";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Called every minute by Vercel Cron (Pro plan) via vercel.json.
 * Also used as a lazy backstop for hobby plans when dashboard polling triggers it.
 */
export async function GET(req: NextRequest) {
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
    const [staleClosed, aiClaimed] = await Promise.allSettled([
      sweepStaleSessions(),
      processDueAiClaims().then(() => undefined),
    ]);

    return NextResponse.json({
      success: true,
      staleClosed: staleClosed.status === "fulfilled" ? staleClosed.value : 0,
      aiClaimed: aiClaimed.status === "fulfilled" ? true : false,
    });
  } catch (error) {
    console.error("Tick cron error:", error);
    return NextResponse.json({ error: "Tick failed" }, { status: 500 });
  }
}
