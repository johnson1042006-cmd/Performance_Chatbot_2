import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { sessions } from "@/lib/db/schema";
import { desc, sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const page = parseInt(searchParams.get("page") || "1");
    const limit = parseInt(searchParams.get("limit") || "20");
    const offset = (page - 1) * limit;

    const allSessions = await db
      .select({
        id: sessions.id,
        customerIdentifier: sessions.customerIdentifier,
        pageContext: sessions.pageContext,
        startedAt: sessions.startedAt,
        closedAt: sessions.closedAt,
        status: sessions.status,
        claimedByUserId: sessions.claimedByUserId,
        messageCount: sql<number>`(
          SELECT count(*)::int FROM messages WHERE messages.session_id = ${sessions.id}
        )`,
        aiMessageCount: sql<number>`(
          SELECT count(*)::int FROM messages WHERE messages.session_id = ${sessions.id} AND messages.role = 'ai'
        )`,
      })
      .from(sessions)
      .orderBy(desc(sessions.startedAt))
      .limit(limit)
      .offset(offset);

    const [total] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(sessions);

    return NextResponse.json({
      sessions: allSessions,
      total: total?.count || 0,
      page,
      totalPages: Math.ceil((total?.count || 0) / limit),
    });
  } catch (error) {
    console.error("History error:", error);
    return NextResponse.json(
      { error: "Failed to fetch history" },
      { status: 500 }
    );
  }
}
