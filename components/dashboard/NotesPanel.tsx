"use client";

import { useCallback, useEffect, useState } from "react";
import Button from "@/components/ui/Button";
import { Plus, FileText } from "lucide-react";

interface Note {
  id: string;
  body: string;
  authorName: string;
  createdAt: string;
}

interface NotesPanelProps {
  sessionId: string;
}

function formatRelative(iso: string): string {
  try {
    const then = new Date(iso).getTime();
    const diffMs = Date.now() - then;
    const sec = Math.floor(diffMs / 1000);
    if (sec < 60) return "just now";
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ago`;
    const d = Math.floor(hr / 24);
    if (d < 7) return `${d}d ago`;
    return new Date(iso).toLocaleDateString();
  } catch {
    return iso;
  }
}

export default function NotesPanel({ sessionId }: NotesPanelProps) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [body, setBody] = useState("");
  const [posting, setPosting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchNotes = useCallback(async () => {
    try {
      const res = await fetch(`/api/sessions/${sessionId}/notes`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setNotes(data.notes ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load notes");
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    setLoading(true);
    fetchNotes();
  }, [fetchNotes]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = body.trim();
    if (!trimmed || posting) return;
    setPosting(true);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: trimmed }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setNotes((prev) => [data.note, ...prev]);
      setBody("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to post note");
    } finally {
      setPosting(false);
    }
  };

  return (
    <div
      className="px-3 pb-3 max-h-64 overflow-y-auto"
      data-testid="notes-panel"
    >
      <form onSubmit={handleSubmit} className="mb-3" data-testid="note-form">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={2}
          placeholder="Add an internal note (only agents see this)…"
          className="w-full px-2.5 py-2 text-xs border border-border rounded-button focus:outline-none focus:ring-2 focus:ring-accent/20 resize-y"
          data-testid="note-input"
        />
        <div className="flex justify-end mt-1.5">
          <Button
            size="sm"
            type="submit"
            disabled={posting || !body.trim()}
          >
            <Plus size={12} className="mr-1" />
            {posting ? "Adding…" : "Add note"}
          </Button>
        </div>
      </form>

      {loading && notes.length === 0 && (
        <p className="text-[11px] text-text-secondary py-2">Loading…</p>
      )}
      {error && (
        <p className="text-[11px] text-red-600 py-2">Error: {error}</p>
      )}
      {!loading && !error && notes.length === 0 && (
        <p className="text-[11px] text-text-secondary py-2 flex items-center gap-1">
          <FileText size={11} />
          No internal notes yet.
        </p>
      )}

      <div className="space-y-1.5">
        {notes.map((n) => (
          <div
            key={n.id}
            data-testid="note-row"
            className="border border-amber-100 rounded-card p-2 bg-amber-50"
          >
            <p className="text-xs text-text-primary whitespace-pre-wrap break-words">
              {n.body}
            </p>
            <div className="flex items-center justify-between mt-1">
              <span className="text-[10px] font-medium text-amber-800">
                {n.authorName}
              </span>
              <span className="text-[10px] text-amber-700">
                {formatRelative(n.createdAt)}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
