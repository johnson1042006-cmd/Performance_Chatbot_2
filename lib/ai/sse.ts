/**
 * Tiny Server-Sent Events helper for the chat routes. The Anthropic SDK
 * already streams tokens for us — this just turns those tokens (and the
 * occasional tool_use event) into the SSE wire format and exposes a
 * `Response`-friendly ReadableStream<Uint8Array>.
 */

const encoder = new TextEncoder();

export interface SseEvent {
  event: string;
  data: unknown;
}

export function formatSse({ event, data }: SseEvent): string {
  const payload = typeof data === "string" ? data : JSON.stringify(data);
  return `event: ${event}\ndata: ${payload}\n\n`;
}

export interface SseController {
  send: (e: SseEvent) => void;
  close: () => void;
}

export function createSseStream(
  run: (controller: SseController) => Promise<void>
): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (e: SseEvent) => {
        try {
          controller.enqueue(encoder.encode(formatSse(e)));
        } catch {
          // Stream closed by client; swallow.
        }
      };
      const close = () => {
        try {
          controller.close();
        } catch {
          // Already closed.
        }
      };
      try {
        await run({ send, close });
      } catch (err) {
        send({
          event: "error",
          data: { message: err instanceof Error ? err.message : String(err) },
        });
      } finally {
        close();
      }
    },
  });
}

export const SSE_RESPONSE_HEADERS: HeadersInit = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
};

export function wantsSse(req: Request): boolean {
  const accept = req.headers.get("accept") || "";
  return accept.includes("text/event-stream");
}
