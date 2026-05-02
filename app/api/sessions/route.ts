import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sessions } from "@/lib/db/schema";
import { and, desc, eq, lt, ne } from "drizzle-orm";

const STALE_SESSION_HOURS = 24;

export async function GET() {
  try {
    // Auto-close sessions that have been open for more than 24 hours
    const staleThreshold = new Date(Date.now() - STALE_SESSION_HOURS * 60 * 60 * 1000);
    await db
      .update(sessions)
      .set({ status: "closed", closedAt: new Date() })
      .where(
        and(
          ne(sessions.status, "closed"),
          lt(sessions.startedAt, staleThreshold)
        )
      );

    const allSessions = await db
      .select()
      .from(sessions)
      .where(ne(sessions.status, "closed"))
      .orderBy(desc(sessions.startedAt));

    return NextResponse.json({ sessions: allSessions });
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

    // Use the client-supplied identifier when present (preserves session
    // continuity for embed.js, which generates a stable per-visitor id);
    // otherwise generate one on the server so direct visits to /embed and
    // /chat without a sessionId still get a working session.
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
