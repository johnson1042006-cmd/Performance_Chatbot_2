"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Wrench, AlertTriangle } from "lucide-react";
import { sessionChannel as sessionChannelName } from "@/lib/pusher/channels";

interface TraceEvent {
  id: string;
  type: "tool_call" | "auto_escalated";
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

interface AITraceProps {
  sessionId: string;
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return iso;
  }
}

function prettyJson(value: unknown): string {
  if (value === null || value === undefined) return "—";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export default function AITrace({ sessionId }: AITraceProps) {
  const [open, setOpen] = useState(false);
  const [events, setEvents] = useState<TraceEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const channelRef = useRef<{ unbind?: () => void } | null>(null);

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/trace`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { events: TraceEvent[] };
      setEvents(data.events ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load trace");
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    if (!open) return;
    fetchEvents();
  }, [open, fetchEvents]);

  // Re-fetch when a new AI message arrives (so newly persisted tool_call /
  // auto_escalated rows appear without a manual refresh).
  //
  // The `session-${sessionId}` channel is SHARED with ChatPanel. Cleanup must
  // therefore unbind only this component's own handler (passing the handler
  // reference to unbind) and must NOT unsubscribe the channel — a bare
  // unbind("new-message") or unsubscribe() here would silently kill the agent
  // chat thread's live updates.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const handler = () => fetchEvents();

    import("@/lib/pusher/client").then(({ acquireChannel, releaseChannel }) => {
      if (cancelled) return;
      const channelName = sessionChannelName(sessionId);
      const channel = acquireChannel(channelName);
      channel.bind("new-message", handler);
      channelRef.current = {
        unbind: () => {
          channel.unbind("new-message", handler);
          releaseChannel(channelName);
        },
      };
    });

    return () => {
      cancelled = true;
      channelRef.current?.unbind?.();
      channelRef.current = null;
    };
  }, [open, sessionId, fetchEvents]);

  const renderEvent = (e: TraceEvent) => {
    const meta = (e.metadata as Record<string, unknown>) || {};
    if (e.type === "tool_call") {
      const name = String(meta.name ?? "tool");
      const durationMs = typeof meta.durationMs === "number" ? meta.durationMs : null;
      const isError = meta.isError === true;
      return (
        <div
          key={e.id}
          data-testid="ai-trace-event"
          data-trace-type="tool_call"
          className="border border-border rounded-card p-2.5 bg-surface"
        >
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <div className="flex items-center gap-1.5 min-w-0">
              <Wrench
                size={12}
                className={isError ? "text-red-500" : "text-text-secondary"}
              />
              <span className="text-xs font-medium text-text-primary truncate">
                {name}
              </span>
              {isError && (
                <span className="text-[10px] text-red-600 uppercase">error</span>
              )}
            </div>
            <span className="text-[10px] text-text-secondary shrink-0">
              {formatTime(e.createdAt)}
              {durationMs !== null ? ` · ${durationMs}ms` : ""}
            </span>
          </div>
          <details className="text-[11px] text-text-secondary">
            <summary className="cursor-pointer">input</summary>
            <pre className="mt-1 overflow-x-auto bg-background rounded p-1.5 text-[10px]">
              {prettyJson(meta.input)}
            </pre>
          </details>
          <details className="text-[11px] text-text-secondary mt-1">
            <summary className="cursor-pointer">output</summary>
            <pre className="mt-1 overflow-x-auto bg-background rounded p-1.5 text-[10px] max-h-48">
              {prettyJson(meta.output)}
            </pre>
          </details>
        </div>
      );
    }

    // auto_escalated
    const reason = String(meta.reason ?? "unknown");
    const confidence = String(meta.confidence ?? "?");
    const sentiment = typeof meta.sentiment === "number" ? meta.sentiment : "?";
    return (
      <div
        key={e.id}
        data-testid="ai-trace-event"
        data-trace-type="auto_escalated"
        className="border border-amber-200 rounded-card p-2.5 bg-amber-50"
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <AlertTriangle size={12} className="text-amber-600" />
            <span className="text-xs font-medium text-amber-800">
              Auto-escalated · {reason}
            </span>
          </div>
          <span className="text-[10px] text-amber-700">{formatTime(e.createdAt)}</span>
        </div>
        <p className="text-[11px] text-amber-700 mt-1">
          confidence: <span className="font-mono">{confidence}</span>
          {" · "}sentiment: <span className="font-mono">{String(sentiment)}</span>
        </p>
      </div>
    );
  };

  return (
    <div
      className="shrink-0 border-t border-border bg-background/40"
      data-testid="ai-trace-panel"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-text-secondary hover:bg-background/80"
        aria-expanded={open}
        data-testid="ai-trace-toggle"
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        AI Trace
        {events.length > 0 && (
          <span className="ml-1 px-1.5 py-px text-[10px] rounded-full bg-accent/10 text-accent">
            {events.length}
          </span>
        )}
      </button>
      {open && (
        <div
          className="px-3 pb-3 space-y-1.5 max-h-64 overflow-y-auto"
          data-testid="ai-trace-list"
        >
          {loading && events.length === 0 && (
            <p className="text-[11px] text-text-secondary py-2">Loading…</p>
          )}
          {error && (
            <p className="text-[11px] text-red-600 py-2">Error: {error}</p>
          )}
          {!loading && !error && events.length === 0 && (
            <p className="text-[11px] text-text-secondary py-2">
              No AI tool activity yet.
            </p>
          )}
          {events.map(renderEvent)}
        </div>
      )}
    </div>
  );
}
