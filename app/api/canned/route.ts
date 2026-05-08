import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { cannedResponses, sessions } from "@/lib/db/schema";
import { asc, eq } from "drizzle-orm";
import { renderCannedBody } from "@/lib/canned/render";
import { log, serializeError } from "@/lib/log";

export const dynamic = "force-dynamic";

/**
 * Phase 4: agent-facing canned replies endpoint. Returns the same rows the
 * manager UI sees, but with `{customer_name}` / `{agent_name}` /
 * `{store_phone}` placeholders pre-substituted when `?sessionId=` is
 * provided. The raw template stays in the DB; the agent UI never sees
 * unrendered tokens.
 */
export async function GET(req: NextRequest) {
  const requestId = crypto.randomUUID();
  try {
    const auth = await getServerSession(authOptions);
    if (!auth?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const sessionId = searchParams.get("sessionId");

    let customerName: string | null = null;
    if (sessionId) {
      const [row] = await db
        .select({ customerName: sessions.customerName })
        .from(sessions)
        .where(eq(sessions.id, sessionId))
        .limit(1);
      if (row) customerName = row.customerName;
    }

    const rows = await db
      .select()
      .from(cannedResponses)
      .orderBy(asc(cannedResponses.category), asc(cannedResponses.title));

    const rendered = rows.map((r) => ({
      id: r.id,
      title: r.title,
      category: r.category,
      body: renderCannedBody(r.body, {
        customerName,
        agentName: auth.user.name,
      }),
    }));

    return NextResponse.json({ replies: rendered });
  } catch (error) {
    log.error("canned.get_failed", {
      requestId,
      error: serializeError(error),
    });
    return NextResponse.json(
      { error: "Failed to fetch canned replies" },
      { status: 500 }
    );
  }
}
