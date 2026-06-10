import PusherClient, { type Channel } from "pusher-js";

let _pusherClient: PusherClient | null = null;

// Customer session token used to authorize private-session-* channels from
// the embed widget (staff dashboards authorize via their NextAuth cookie,
// which rides along automatically on the same-origin auth request).
let _sessionToken: string | null = null;

export function setPusherSessionToken(token: string | null): void {
  _sessionToken = token;
}

export function getPusherClient(): PusherClient {
  if (!_pusherClient) {
    _pusherClient = new PusherClient(process.env.NEXT_PUBLIC_PUSHER_KEY!, {
      cluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER!,
      channelAuthorization: {
        endpoint: "/api/pusher/auth",
        transport: "ajax",
        // Custom handler so each auth request reads the CURRENT session
        // token (set after POST /api/sessions) and includes cookies.
        customHandler: ({ socketId, channelName }, callback) => {
          fetch("/api/pusher/auth", {
            method: "POST",
            credentials: "same-origin",
            headers: {
              "Content-Type": "application/json",
              ...(_sessionToken ? { "x-session-token": _sessionToken } : {}),
            },
            body: JSON.stringify({
              socket_id: socketId,
              channel_name: channelName,
            }),
          })
            .then(async (res) => {
              if (!res.ok) {
                throw new Error(`Pusher auth failed: HTTP ${res.status}`);
              }
              callback(null, await res.json());
            })
            .catch((err) => {
              callback(
                err instanceof Error ? err : new Error(String(err)),
                null
              );
            });
        },
      },
    });
  }
  return _pusherClient;
}

// ---------------------------------------------------------------------------
// Ref-counted channel sharing.
//
// Several components subscribe to the same channel (e.g. ChatPanel and
// AITrace both listen on `session-${id}`). Pusher's subscribe() is idempotent
// but unsubscribe() is not scoped — one component unsubscribing tears the
// channel down for everyone. acquire/release keeps a per-channel ref count so
// the underlying subscription survives until the LAST consumer releases it.
//
// Each consumer must still unbind its own handlers (with the handler
// reference) before calling releaseChannel.
// ---------------------------------------------------------------------------

const channelRefCounts = new Map<string, number>();

export function acquireChannel(name: string): Channel {
  channelRefCounts.set(name, (channelRefCounts.get(name) ?? 0) + 1);
  return getPusherClient().subscribe(name);
}

export function releaseChannel(name: string): void {
  const next = (channelRefCounts.get(name) ?? 1) - 1;
  if (next <= 0) {
    channelRefCounts.delete(name);
    _pusherClient?.unsubscribe(name);
  } else {
    channelRefCounts.set(name, next);
  }
}
