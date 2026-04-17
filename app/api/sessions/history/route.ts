import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { sessions, messages } from "@/lib/db/schema";
import { desc, eq, sql, and } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const page = Math.max(1, parseInt(searchParams.get("page") || "1") || 1);
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "20") || 20));
    const offset = (page - 1) * limit;

    const allSessions = await db
      .select()
      .from(sessions)
      .orderBy(desc(sessions.startedAt))
      .limit(limit)
      .offset(offset);

    const [total] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(sessions);

    const sessionsWithCounts = await Promise.all(
      allSessions.map(async (s) => {
        const [msgCount] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(messages)
          .where(eq(messages.sessionId, s.id));

        const [aiCount] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(messages)
          .where(and(eq(messages.sessionId, s.id), eq(messages.role, "ai")));

        return {
          ...s,
          messageCount: msgCount?.count || 0,
          aiMessageCount: aiCount?.count || 0,
        };
      })
    );

    return NextResponse.json({
      sessions: sessionsWithCounts,
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
