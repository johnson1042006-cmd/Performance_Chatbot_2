import { NextRequest, NextResponse } from "next/server";
import { getStaffSession } from "@/lib/auth";
import { getPusher } from "@/lib/pusher/server";
import {
  sessionIdFromChannel,
  DASHBOARD_CHANNEL,
  ALERTS_CHANNEL,
} from "@/lib/pusher/channels";
import { verifySessionAccess } from "@/lib/sessions/verifySessionToken";
import { log, serializeError } from "@/lib/log";

/**
 * Pusher private-channel authorization.
 *
 *  - private-session-{id}: the customer holding that session's token (cookie,
 *    x-session-token header) or any active staff member.
 *  - private-dashboard / private-alerts: staff only.
 *
 * The client authorizer POSTs JSON { socket_id, channel_name } (see
 * lib/pusher/client.ts); the standard form-encoded body is accepted too.
 */
export async function POST(req: NextRequest) {
  try {
    let socketId: string | undefined;
    let channelName: string | undefined;

    const contentType = req.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const body = await req.json().catch(() => ({}));
      socketId = body.socket_id;
      channelName = body.channel_name;
    } else {
      const form = await req.formData().catch(() => null);
      socketId = form?.get("socket_id")?.toString();
      channelName = form?.get("channel_name")?.toString();
    }

    if (!socketId || !channelName) {
      return NextResponse.json(
        { error: "socket_id and channel_name are required" },
        { status: 400 }
      );
    }

    let authorized = false;

    const sessionId = sessionIdFromChannel(channelName);
    if (sessionId) {
      // Staff OR matching customer session token.
      authorized = await verifySessionAccess(req, sessionId);
    } else if (
      channelName === DASHBOARD_CHANNEL ||
      channelName === ALERTS_CHANNEL
    ) {
      const authSession = await getStaffSession();
      authorized =
        !!authSession?.user &&
        (authSession.user.role === "store_manager" ||
          authSession.user.role === "support_agent");
    }

    if (!authorized) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const authResponse = getPusher().authorizeChannel(socketId, channelName);
    return NextResponse.json(authResponse);
  } catch (error) {
    log.error("pusher.auth_failed", { error: serializeError(error) });
    return NextResponse.json({ error: "Authorization failed" }, { status: 500 });
  }
}
