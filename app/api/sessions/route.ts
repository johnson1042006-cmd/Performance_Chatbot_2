import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sessions, users } from "@/lib/db/schema";
import { asc, desc, eq, ne } from "drizzle-orm";
import { processDueAiClaims, sweepStaleSessions } from "@/lib/sessions/state";

export async function GET() {
  try {
    // Lazy tick: expire stale sessions and process AI claims
    await Promise.allSettled([sweepStaleSessions(), processDueAiClaims()]);

    const rows = await db
      .select({
        session: sessions,
        claimerName: users.name,
        claimerId: users.id,
      })
      .from(sessions)
      .leftJoin(users, eq(sessions.claimedByUserId, users.id))
      .where(ne(sessions.status, "closed"))
      .orderBy(
        // Unclaimed sessions oldest-first, then claimed sessions newest-first
        asc(sessions.startedAt)
      );

    const enriched = rows.map(({ session, claimerName, claimerId }) => ({
      ...session,
      claimedBy: claimerId ? { id: claimerId, name: claimerName } : null,
      waitSeconds: Math.floor(
        (Date.now() - new Date(session.startedAt).getTime()) / 1000
      ),
    }));

    // Sort: unclaimed (waiting) oldest first, claimed newest first
    enriched.sort((a, b) => {
      const aUnclaimed = a.status === "waiting";
      const bUnclaimed = b.status === "waiting";
      if (aUnclaimed && !bUnclaimed) return -1;
      if (!aUnclaimed && bUnclaimed) return 1;
      if (aUnclaimed && bUnclaimed) {
        // Both unclaimed — oldest first
        return new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime();
      }
      // Both claimed — newest first
      return new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime();
    });

    const unclaimedCount = enriched.filter((s) => s.status === "waiting").length;

    return NextResponse.json({ sessions: enriched, unclaimedCount });
  } catch (error) {
    console.error("Failed to fetch sessions:", error);
    return NextResponse.json(
      { error: "Failed to fetch sessions" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { customerIdentifier, pageContext } = body;

    const effectiveId =
      typeof customerIdentifier === "string" && customerIdentifier.length > 0
        ? customerIdentifier
        : `anon_${crypto.randomUUID()}`;

    const existing = await db
      .select()
      .from(sessions)
      .where(eq(sessions.customerIdentifier, effectiveId))
      .orderBy(desc(sessions.startedAt))
      .limit(1);

    if (existing.length > 0 && existing[0].status !== "closed") {
      return NextResponse.json({ session: existing[0] });
    }

    const [session] = await db
      .insert(sessions)
      .values({
        customerIdentifier: effectiveId,
        pageContext,
        status: "waiting",
      })
      .returning();

    return NextResponse.json({ session }, { status: 201 });
  } catch (error) {
    console.error("Failed to create session:", error);
    return NextResponse.json(
      { error: "Failed to create session" },
      { status: 500 }
    );
  }
}
