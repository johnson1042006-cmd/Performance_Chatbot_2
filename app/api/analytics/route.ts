import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { sessions, messages } from "@/lib/db/schema";
import { eq, gte, sql, and, ne } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [totalToday] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(sessions)
      .where(gte(sessions.startedAt, today));

    const [aiHandled] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(sessions)
      .where(
        and(
          gte(sessions.startedAt, today),
          eq(sessions.status, "active_ai")
        )
      );

    const [openChats] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(sessions)
      .where(ne(sessions.status, "closed"));

    const [queueCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(sessions)
      .where(eq(sessions.status, "waiting"));

    const [totalMessages] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(messages)
      .where(gte(messages.sentAt, today));

    const aiMessages = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(messages)
      .where(
        and(
          gte(messages.sentAt, today),
          eq(messages.role, "ai")
        )
      );

    const agentMessages = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(messages)
      .where(
        and(
          gte(messages.sentAt, today),
          eq(messages.role, "agent")
        )
      );

    const totalChats = totalToday?.count || 0;
    const aiCount = aiHandled?.count || 0;
    const aiPercent = totalChats > 0 ? Math.round((aiCount / totalChats) * 100) : 0;

    const recentSessions = await db
      .select()
      .from(sessions)
      .orderBy(sql`${sessions.startedAt} DESC`)
      .limit(10);

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const dailyStats = await db
      .select({
        date: sql<string>`DATE(${sessions.startedAt})::text`,
        total: sql<number>`count(*)::int`,
        aiCount: sql<number>`count(*) FILTER (WHERE ${sessions.status} = 'active_ai')::int`,
      })
      .from(sessions)
      .where(gte(sessions.startedAt, sevenDaysAgo))
      .groupBy(sql`DATE(${sessions.startedAt})`)
      .orderBy(sql`DATE(${sessions.startedAt})`);

    return NextResponse.json({
      chatsToday: totalChats,
      aiPercent,
      openChats: openChats?.count || 0,
      queueSize: queueCount?.count || 0,
      totalMessages: totalMessages?.count || 0,
      aiMessages: aiMessages[0]?.count || 0,
      agentMessages: agentMessages[0]?.count || 0,
      recentSessions,
      dailyStats,
    });
  } catch (error) {
    console.error("Analytics error:", error);
    return NextResponse.json(
      { error: "Failed to fetch analytics" },
      { status: 500 }
    );
  }
}
