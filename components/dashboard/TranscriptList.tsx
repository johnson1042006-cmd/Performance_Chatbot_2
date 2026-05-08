"use client";

import { useEffect, useState } from "react";

export interface TranscriptMessage {
  id: string;
  role: "customer" | "agent" | "ai";
  content: string;
  sentAt: string;
}

interface TranscriptListProps {
  sessionId: string;
  className?: string;
  emptyLabel?: string;
}

/**
 * Read-only message list for a session. Extracted from
 * [TranscriptModal] so it can be embedded inline (e.g. inside the
 * Phase 5.5 ticket detail modal) without the fixed-overlay wrapper.
 */
export default function TranscriptList({
  sessionId,
  className,
  emptyLabel = "No messages.",
}: TranscriptListProps) {
  const [messages, setMessages] = useState<TranscriptMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/sessions/${sessionId}/messages`, { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        if (cancelled) return;
        setMessages(data.messages ?? []);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  return (
    <div className={className ?? "space-y-2"}>
      {loading && (
        <p className="text-xs text-text-secondary">Loading transcript…</p>
      )}
      {error && <p className="text-xs text-red-600">Error: {error}</p>}
      {!loading && !error && messages.length === 0 && (
        <p className="text-xs text-text-secondary">{emptyLabel}</p>
      )}
      {messages.map((m) => (
        <div
          key={m.id}
          className={`text-xs p-2 rounded-card ${
            m.role === "customer"
              ? "bg-background"
              : m.role === "ai"
              ? "bg-purple-50"
              : "bg-emerald-50"
          }`}
        >
          <p className="text-[10px] uppercase font-semibold text-text-secondary mb-1">
            {m.role}
            <span className="ml-2 normal-case font-normal text-text-secondary/80">
              {new Date(m.sentAt).toLocaleString([], {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          </p>
          <p className="whitespace-pre-wrap break-words text-text-primary">
            {m.content}
          </p>
        </div>
      ))}
    </div>
  );
}
