import { NextRequest, NextResponse } from "next/server";
import { getStaffSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { pushSubscriptions } from "@/lib/db/schema";
import { log, serializeError } from "@/lib/log";

export async function POST(req: NextRequest) {
  const requestId = crypto.randomUUID();
  try {
    const session = await getStaffSession();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { endpoint, keys } = body ?? {};
    const p256dh = keys?.p256dh;
    const auth = keys?.auth;

    if (!endpoint || !p256dh || !auth) {
      return NextResponse.json(
        { error: "endpoint and keys (p256dh, auth) are required" },
        { status: 400 }
      );
    }

    // Upsert keyed on the unique endpoint so re-subscribing the same browser
    // refreshes the keys and re-points it at the current user.
    await db
      .insert(pushSubscriptions)
      .values({
        userId: session.user.id,
        endpoint,
        p256dh,
        auth,
      })
      .onConflictDoUpdate({
        target: pushSubscriptions.endpoint,
        set: { userId: session.user.id, p256dh, auth },
      });

    return NextResponse.json({ ok: true });
  } catch (error) {
    log.error("push.subscribe_failed", {
      requestId,
      error: serializeError(error),
    });
    return NextResponse.json(
      { error: "Failed to save subscription" },
      { status: 500 }
    );
  }
}
