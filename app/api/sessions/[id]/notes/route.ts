import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { chatEvents, users, sessions } from "@/lib/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { getPusher } from "@/lib/pusher/server";
import { log, serializeError } from "@/lib/log";

export const dynamic = "force-dynamic";

/**
 * Phase 4 internal-note endpoint. Notes are stored as `chat_events` rows of
 * type "internal_note" with the body in metadata. CRITICAL: notes MUST NEVER
 * be broadcast to the customer-facing `session-${id}` Pusher channel — that
 * channel is what the embed widget subscribes to. We instead fire a
 * dashboard-only `note-added` event so other agents on the dashboard refresh
 * their notes panel.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const requestId = crypto.randomUUID();
  try {
    const auth = await getServerSession(authOptions);
    if (!auth?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rows = await db
      .select({
        id: chatEvents.id,
        metadata: chatEvents.metadata,
        createdAt: chatEvents.createdAt,
        actorUserId: chatEvents.actorUserId,
        authorName: users.name,
      })
      .from(chatEvents)
      .leftJoin(users, eq(chatEvents.actorUserId, users.id))
      .where(
        and(
          eq(chatEvents.sessionId, params.id),
          eq(chatEvents.type, "internal_note")
        )
      )
      .orderBy(desc(chatEvents.createdAt));

    const notes = rows.map((r) => ({
      id: r.id,
      body: ((r.metadata as Record<string, unknown> | null)?.body as string) ?? "",
      authorName: r.authorName ?? "Unknown",
      createdAt: r.createdAt,
    }));

    return NextResponse.json({ notes });
  } catch (error) {
    log.error("sessions.notes_get_failed", {
      requestId,
      sessionId: params.id,
      error: serializeError(error),
    });
    return NextResponse.json(
      { error: "Failed to fetch notes" },
      { status: 500 }
    );
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const requestId = crypto.randomUUID();
  try {
    const auth = await getServerSession(authOptions);
    if (!auth?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const json = await req.json();
    const body = typeof json?.body === "string" ? json.body.trim() : "";
    if (!body) {
      return NextResponse.json(
        { error: "body is required" },
        { status: 400 }
      );
    }

    const [session] = await db
      .select({ id: sessions.id })
      .from(sessions)
      .where(eq(sessions.id, params.id))
      .limit(1);
    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const [row] = await db
      .insert(chatEvents)
      .values({
        sessionId: params.id,
        type: "internal_note",
        actorUserId: auth.user.id,
        metadata: { body },
      })
      .returning();

    // CRITICAL: only broadcast to `dashboard` channel. NEVER touch
    // `session-${id}` — the embed widget subscribes to that and would
    // surface the internal note to the customer.
    try {
      const pusher = getPusher();
      await pusher.trigger("dashboard", "note-added", {
        sessionId: params.id,
        noteId: row.id,
      });
    } catch (pusherError) {
      log.warn("sessions.notes_pusher_failed", {
        requestId,
        sessionId: params.id,
        error: serializeError(pusherError),
      });
    }

    return NextResponse.json(
      {
        note: {
          id: row.id,
          body,
          authorName: auth.user.name,
          createdAt: row.createdAt,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    log.error("sessions.notes_post_failed", {
      requestId,
      sessionId: params.id,
      error: serializeError(error),
    });
    return NextResponse.json(
      { error: "Failed to add note" },
      { status: 500 }
    );
  }
}
