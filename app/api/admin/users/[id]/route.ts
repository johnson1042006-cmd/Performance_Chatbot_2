import { NextRequest, NextResponse } from "next/server";
import { getStaffSession } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { db } from "@/lib/db";
import {
  users,
  sessions,
  chatEvents,
  cannedResponses,
  alertEvents,
} from "@/lib/db/schema";
import { eq, count } from "drizzle-orm";
import { log, serializeError } from "@/lib/log";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const requestId = crypto.randomUUID();
  try {
    const session = await getStaffSession();
    if (!session?.user || session.user.role !== "store_manager") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = params;

    if (id === session.user.id) {
      return NextResponse.json(
        { error: "You cannot delete your own account." },
        { status: 400 }
      );
    }

    const [target] = await db
      .select({ id: users.id, role: users.role })
      .from(users)
      .where(eq(users.id, id))
      .limit(1);

    if (!target) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    if (target.role === "store_manager") {
      const [{ value }] = await db
        .select({ value: count() })
        .from(users)
        .where(eq(users.role, "store_manager"));

      if (value === 1) {
        return NextResponse.json(
          { error: "Cannot delete the only manager account." },
          { status: 400 }
        );
      }
    }

    // NULL out FK columns that have no onDelete rule in the schema.
    // (push_subscriptions, tickets, ticket_comments already use cascade/set null.)
    await Promise.all([
      db
        .update(sessions)
        .set({ claimedByUserId: null })
        .where(eq(sessions.claimedByUserId, id)),
      db
        .update(chatEvents)
        .set({ actorUserId: null })
        .where(eq(chatEvents.actorUserId, id)),
      db
        .update(chatEvents)
        .set({ targetUserId: null })
        .where(eq(chatEvents.targetUserId, id)),
      db
        .update(cannedResponses)
        .set({ createdBy: null })
        .where(eq(cannedResponses.createdBy, id)),
      db
        .update(alertEvents)
        .set({ ackedBy: null })
        .where(eq(alertEvents.ackedBy, id)),
    ]);

    await db.delete(users).where(eq(users.id, id));

    // Remove the Supabase auth identity too. Profile is already gone, so the
    // FK cascade is a no-op here; this just deletes the login. Idempotent.
    const admin = createAdminClient();
    await admin.auth.admin.deleteUser(id).catch(() => {});

    return NextResponse.json({ success: true });
  } catch (error) {
    log.error("admin.users_delete_failed", {
      requestId,
      error: serializeError(error),
    });
    return NextResponse.json(
      { error: "Failed to delete user" },
      { status: 500 }
    );
  }
}
