import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { runChatHistoryCleanup } from "@/lib/cleanup";
import { log, serializeError } from "@/lib/log";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const requestId = crypto.randomUUID();
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user || session.user.role !== "store_manager") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let overrideMonths: number | undefined;
    try {
      const body = await req.json();
      if (
        body &&
        typeof body.months === "number" &&
        Number.isFinite(body.months)
      ) {
        overrideMonths = Math.max(0, Math.floor(body.months));
      }
    } catch {
    }

    const result = await runChatHistoryCleanup(overrideMonths);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    log.error("admin.cleanup_failed", { requestId, error: serializeError(error) });
    return NextResponse.json(
      { error: "Failed to run cleanup" },
      { status: 500 }
    );
  }
}
