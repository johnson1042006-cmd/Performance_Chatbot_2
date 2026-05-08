"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";

interface TranscriptMessage {
  id: string;
  role: "customer" | "agent" | "ai";
  content: string;
  sentAt: string;
}

interface TranscriptModalProps {
  sessionId: string;
  title?: string;
  onClose: () => void;
}

/**
 * Shared transcript viewer reused from Phase 4's customer history panel.
 * Loads messages from `/api/sessions/[id]/messages` and renders a fixed
 * overlay. Used by the Phase 5 manager search and review-queue pages.
 */
export default function TranscriptModal({
  sessionId,
  title = "Transcript",
  onClose,
}: TranscriptModalProps) {
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
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      onClick={onClose}
      data-testid="transcript-modal"
    >
      <div
        className="bg-surface rounded-card shadow-card-md max-w-3xl w-full max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h3 className="text-sm font-semibold">{title}</h3>
          <button
            onClick={onClose}
            className="text-text-secondary hover:text-text-primary"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {loading && (
            <p className="text-xs text-text-secondary">Loading transcript…</p>
          )}
          {error && (
            <p className="text-xs text-red-600">Error: {error}</p>
          )}
          {!loading && !error && messages.length === 0 && (
            <p className="text-xs text-text-secondary">No messages.</p>
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
      </div>
    </div>
  );
}
