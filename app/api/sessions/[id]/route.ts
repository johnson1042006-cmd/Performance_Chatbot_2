import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { sessions, messages, users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { maybeLazyTick } from "@/lib/sessions/lazyTick";
import { verifySessionAccess } from "@/lib/sessions/verifySessionToken";
import { log, serializeError } from "@/lib/log";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const requestId = crypto.randomUUID();
  try {
    if (!(await verifySessionAccess(req, params.id))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Lazy tick (debounced) — this route is polled while a customer waits.
    await maybeLazyTick();

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
    log.error("sessions.get_failed", {
      requestId,
      sessionId: params.id,
      error: serializeError(error),
    });
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
  const requestId = crypto.randomUUID();
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
    log.error("sessions.delete_failed", {
      requestId,
      sessionId: params.id,
      error: serializeError(error),
    });
    return NextResponse.json(
      { error: "Failed to delete session" },
      { status: 500 }
    );
  }
}
