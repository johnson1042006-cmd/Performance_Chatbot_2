import { NextRequest, NextResponse } from "next/server";
import { runChatHistoryCleanup, sweepStaleSessions } from "@/lib/cleanup";
import { processDueAiClaims } from "@/lib/sessions/state";
import { log, serializeError } from "@/lib/log";

export const dynamic = "force-dynamic";

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
    const [cleanupRes, staleRes, aiRes] = await Promise.allSettled([
      runChatHistoryCleanup(),
      sweepStaleSessions(),
      processDueAiClaims(),
    ]);

    const result = cleanupRes.status === "fulfilled" ? cleanupRes.value : { error: "cleanup failed" };
    const staleClosed = staleRes.status === "fulfilled" ? staleRes.value : 0;
    const aiClaimedOk = aiRes.status === "fulfilled";

    return NextResponse.json({
      success: true,
      staleClosed,
      aiClaimedOk,
      ...(typeof result === "object" && result ? result : {}),
    });
  } catch (error) {
    log.error("cron.cleanup_failed", { requestId, error: serializeError(error) });
    return NextResponse.json(
      { error: "Cleanup failed" },
      { status: 500 }
    );
  }
}
