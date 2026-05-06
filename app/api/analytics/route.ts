import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { sessions, messages } from "@/lib/db/schema";
import { eq, gte, sql, and, ne, isNull } from "drizzle-orm";
import { sweepStaleSessions, processDueAiClaims } from "@/lib/sessions/state";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Sweep first so open/queued counts are accurate
    await Promise.allSettled([sweepStaleSessions(), processDueAiClaims()]);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [totalToday] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(sessions)
      .where(gte(sessions.startedAt, today));

    const [openChats] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(sessions)
      .where(ne(sessions.status, "closed"));

    const [queueCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(sessions)
      .where(eq(sessions.status, "waiting"));

    const [unclaimedCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(sessions)
      .where(
        and(
          ne(sessions.status, "closed"),
          isNull(sessions.claimedByKind)
        )
      );

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
    // AI Handled % is the share of bot/agent responses (today) that came from AI,
    // derived from message counts so it stays consistent with the per-session
    // AI Ratio shown in History (which counts messages, not session status).
    const aiMsgCount = aiMessages[0]?.count || 0;
    const agentMsgCount = agentMessages[0]?.count || 0;
    const totalResponses = aiMsgCount + agentMsgCount;
    const aiPercent =
      totalResponses > 0
        ? Math.round((aiMsgCount / totalResponses) * 100)
        : 0;

    const recentSessions = await db
      .select()
      .from(sessions)
      .orderBy(sql`${sessions.startedAt} DESC`)
      .limit(10);

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    // Count sessions that had at least one AI message vs total sessions per day.
    // We can't filter on sessions.status = 'active_ai' because closed sessions
    // (incl. AI-handled ones swept by the inactivity timer) lose that status.
    const dailyStats = await db
      .select({
        date: sql<string>`DATE(${sessions.startedAt})::text`,
        total: sql<number>`count(distinct ${sessions.id})::int`,
        aiCount: sql<number>`count(distinct CASE WHEN ${messages.role} = 'ai' THEN ${sessions.id} END)::int`,
      })
      .from(sessions)
      .leftJoin(messages, eq(messages.sessionId, sessions.id))
      .where(gte(sessions.startedAt, sevenDaysAgo))
      .groupBy(sql`DATE(${sessions.startedAt})`)
      .orderBy(sql`DATE(${sessions.startedAt})`);

    return NextResponse.json({
      chatsToday: totalChats,
      aiPercent,
      openChats: openChats?.count || 0,
      queueSize: queueCount?.count || 0,
      unclaimedCount: unclaimedCount?.count || 0,
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
