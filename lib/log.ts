/**
 * JSON-line structured logging to stdout. One line per call so log shippers
 * (Vercel, Datadog) parse cleanly. Always include a stable snake_case `event`
 * and, where available, a `requestId` so a single request can be traced
 * across multiple log lines.
 */

type Level = "info" | "warn" | "error";

export function serializeError(err: unknown): Record<string, unknown> {
  if (!(err instanceof Error)) {
    return { message: String(err) };
  }
  const seen = new WeakSet<object>();
  const safe = JSON.parse(
    JSON.stringify(
      { name: err.name, message: err.message, stack: err.stack },
      (_key, value) => {
        if (typeof value === "object" && value !== null) {
          if (seen.has(value as object)) return undefined;
          seen.add(value as object);
        }
        return value;
      }
    )
  );
  return safe as Record<string, unknown>;
}

function emit(level: Level, event: string, data: Record<string, unknown> = {}): void {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    event,
    ...data,
  });
  // process.stdout.write is sync and avoids the extra newline console.log adds
  // on certain runtimes. Using \n explicitly keeps the format predictable.
  process.stdout.write(line + "\n");
}

export const log = {
  info: (event: string, data?: Record<string, unknown>) => emit("info", event, data),
  warn: (event: string, data?: Record<string, unknown>) => emit("warn", event, data),
  error: (event: string, data?: Record<string, unknown>) => emit("error", event, data),
};
