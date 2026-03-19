import PusherClient from "pusher-js";

let _pusherClient: PusherClient | null = null;

export function getPusherClient(): PusherClient {
  if (!_pusherClient) {
    _pusherClient = new PusherClient(process.env.NEXT_PUBLIC_PUSHER_KEY!, {
      cluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER!,
    });
  }
  return _pusherClient;
}
