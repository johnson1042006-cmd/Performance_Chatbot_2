"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Fuse from "fuse.js";

interface CannedReply {
  id: string;
  title: string;
  category: string;
  body: string;
}

interface CannedReplyPopoverProps {
  sessionId: string;
  query: string;
  open: boolean;
  onSelect: (body: string) => void;
  onClose: () => void;
}

/**
 * Phase 4 slash-canned popover. Triggered from ChatPanel when the agent
 * types "/" as the first character. Fetches canned replies once per session
 * (with placeholder rendering done server-side via ?sessionId=). Bodies are
 * grouped by category. Up/Down navigates, Enter selects, Esc closes.
 */
export default function CannedReplyPopover({
  sessionId,
  query,
  open,
  onSelect,
  onClose,
}: CannedReplyPopoverProps) {
  const [replies, setReplies] = useState<CannedReply[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const fetchedForSessionRef = useRef<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (fetchedForSessionRef.current === sessionId) return;
    setLoading(true);
    fetch(`/api/canned?sessionId=${encodeURIComponent(sessionId)}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        setReplies(data.replies ?? []);
        fetchedForSessionRef.current = sessionId;
        setError(null);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Failed to load");
      })
      .finally(() => setLoading(false));
  }, [open, sessionId]);

  // Strip the leading "/" before fuzzy-matching.
  const term = query.startsWith("/") ? query.slice(1).trim() : query.trim();

  const fuse = useMemo(() => {
    return new Fuse(replies, {
      keys: ["title", "category"],
      threshold: 0.4,
      ignoreLocation: true,
    });
  }, [replies]);

  const filtered: CannedReply[] = useMemo(() => {
    if (!term) return replies;
    return fuse.search(term).map((r) => r.item);
  }, [fuse, replies, term]);

  // Group by category preserving filtered order.
  const grouped = useMemo(() => {
    const out = new Map<string, CannedReply[]>();
    for (const r of filtered) {
      const arr = out.get(r.category) ?? [];
      arr.push(r);
      out.set(r.category, arr);
    }
    return Array.from(out.entries());
  }, [filtered]);

  // Reset highlight when filter changes.
  useEffect(() => {
    setActiveIdx(0);
  }, [term, filtered.length]);

  // Keyboard navigation.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIdx((i) => Math.min(i + 1, Math.max(0, filtered.length - 1)));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIdx((i) => Math.max(0, i - 1));
      } else if (e.key === "Enter") {
        if (filtered.length === 0) return;
        e.preventDefault();
        const pick = filtered[activeIdx];
        if (pick) onSelect(pick.body);
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open, filtered, activeIdx, onSelect, onClose]);

  if (!open) return null;

  let runningIdx = 0;

  return (
    <div
      ref={containerRef}
      data-testid="canned-popover"
      className="absolute bottom-full left-0 right-0 mb-1 max-h-72 overflow-y-auto bg-white border border-border rounded-card shadow-card-md z-30"
    >
      {loading && (
        <p className="px-3 py-2 text-xs text-text-secondary">Loading replies…</p>
      )}
      {error && (
        <p className="px-3 py-2 text-xs text-red-600">Error: {error}</p>
      )}
      {!loading && !error && filtered.length === 0 && (
        <p className="px-3 py-2 text-xs text-text-secondary">
          No canned replies match.
        </p>
      )}
      {grouped.map(([category, items]) => (
        <div key={category}>
          <div className="px-3 py-1 bg-background border-b border-border">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-text-secondary">
              {category}
            </span>
          </div>
          {items.map((r) => {
            const idx = runningIdx++;
            const isActive = idx === activeIdx;
            return (
              <button
                key={r.id}
                type="button"
                data-testid="canned-option"
                onMouseEnter={() => setActiveIdx(idx)}
                onClick={() => onSelect(r.body)}
                className={`w-full text-left px-3 py-2 border-b border-border last:border-b-0 transition-colors ${
                  isActive ? "bg-accent/10" : "hover:bg-background"
                }`}
              >
                <p className="text-xs font-medium text-text-primary">
                  {r.title}
                </p>
                <p className="text-[11px] text-text-secondary line-clamp-2 mt-0.5">
                  {r.body}
                </p>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
