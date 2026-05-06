import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { sessions, messages, users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { processDueAiClaims, sweepStaleSessions } from "@/lib/sessions/state";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    // Lazy tick for this specific session
    await Promise.allSettled([sweepStaleSessions(), processDueAiClaims()]);

    const [row] = await db
      .select({ session: sessions, claimerName: users.name, claimerId: users.id })
      .from(sessions)
      .leftJoin(users, eq(sessions.claimedByUserId, users.id))
      .where(eq(sessions.id, params.id))
      .limit(1);

    const session = row
      ? {
          ...row.session,
          claimedBy: row.claimerId ? { id: row.claimerId, name: row.claimerName } : null,
        }
      : null;

    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    return NextResponse.json({ session });
  } catch (error) {
    console.error("Failed to fetch session:", error);
    return NextResponse.json(
      { error: "Failed to fetch session" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const authSession = await getServerSession(authOptions);
    if (!authSession?.user || authSession.user.role !== "store_manager") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const [existing] = await db
      .select({ id: sessions.id })
      .from(sessions)
      .where(eq(sessions.id, params.id))
      .limit(1);

    if (!existing) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    await db.delete(messages).where(eq(messages.sessionId, params.id));
    await db.delete(sessions).where(eq(sessions.id, params.id));

    return NextResponse.json({ success: true, id: params.id });
  } catch (error) {
    console.error("Failed to delete session:", error);
    return NextResponse.json(
      { error: "Failed to delete session" },
      { status: 500 }
    );
  }
}
