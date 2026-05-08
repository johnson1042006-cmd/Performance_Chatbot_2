"use client";

import { useCallback, useEffect, useState } from "react";
import { History as HistoryIcon, X, MessageSquare } from "lucide-react";

interface HistoryRow {
  id: string;
  customerIdentifier: string;
  startedAt: string;
  closedAt: string | null;
  messageCount: number;
  summary: string;
}

interface HistoryPanelProps {
  sessionId: string;
  customerIdentifier: string;
}

interface TranscriptMessage {
  id: string;
  role: "customer" | "agent" | "ai";
  content: string;
  sentAt: string;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString([], {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function HistoryTranscriptModal({
  sessionId,
  onClose,
}: {
  sessionId: string;
  onClose: () => void;
}) {
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
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      onClick={onClose}
      data-testid="history-modal"
    >
      <div
        className="bg-surface rounded-card shadow-card-md max-w-2xl w-full max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h3 className="text-sm font-semibold">Past conversation</h3>
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

export default function HistoryPanel({
  sessionId,
  customerIdentifier,
}: HistoryPanelProps) {
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const fetchHistory = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/sessions/by-customer/${encodeURIComponent(
          customerIdentifier
        )}?excludeId=${sessionId}&limit=5`,
        { cache: "no-store" }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setHistory(data.history ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [sessionId, customerIdentifier]);

  useEffect(() => {
    setLoading(true);
    fetchHistory();
  }, [fetchHistory]);

  return (
    <div
      className="px-3 pb-3 max-h-64 overflow-y-auto"
      data-testid="history-panel"
    >
      {loading && (
        <p className="text-[11px] text-text-secondary py-2">Loading…</p>
      )}
      {error && (
        <p className="text-[11px] text-red-600 py-2">Error: {error}</p>
      )}
      {!loading && !error && history.length === 0 && (
        <p className="text-[11px] text-text-secondary py-2 flex items-center gap-1">
          <HistoryIcon size={11} />
          No past conversations for this customer.
        </p>
      )}

      <div className="space-y-1.5">
        {history.map((row) => (
          <button
            key={row.id}
            onClick={() => setOpenId(row.id)}
            data-testid="history-row"
            className="w-full text-left border border-border rounded-card p-2 bg-surface hover:bg-background transition-colors"
          >
            <div className="flex items-center justify-between gap-2 mb-1">
              <span className="text-xs font-medium text-text-primary">
                {formatDate(row.closedAt ?? row.startedAt)}
              </span>
              <span className="flex items-center gap-1 text-[10px] text-text-secondary">
                <MessageSquare size={10} />
                {row.messageCount}
              </span>
            </div>
            <p className="text-[11px] text-text-secondary line-clamp-2">
              {row.summary || "(no customer message)"}
            </p>
          </button>
        ))}
      </div>

      {openId && (
        <HistoryTranscriptModal
          sessionId={openId}
          onClose={() => setOpenId(null)}
        />
      )}
    </div>
  );
}
