import { NextRequest, NextResponse } from "next/server";
import { runChatHistoryCleanup, sweepStaleSessions } from "@/lib/cleanup";
import { processDueAiClaims } from "@/lib/sessions/state";

export const dynamic = "force-dynamic";

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
    const [result, staleClosed] = await Promise.all([
      runChatHistoryCleanup(),
      sweepStaleSessions(),
      processDueAiClaims(),
    ]);
    return NextResponse.json({ success: true, staleClosed, ...result });
  } catch (error) {
    console.error("Cron cleanup error:", error);
    return NextResponse.json(
      { error: "Cleanup failed" },
      { status: 500 }
    );
  }
}
