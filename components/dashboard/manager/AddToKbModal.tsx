"use client";

import { useEffect, useMemo, useState } from "react";
import Button from "@/components/ui/Button";
import { X, Save, Loader2 } from "lucide-react";
import { slugify, dedupSlug } from "@/lib/utils/slugify";

interface KnowledgeEntry {
  id: string;
  topic: string;
  content: string;
  isFaq?: boolean;
}

interface AddToKbModalProps {
  /** The customer question pre-filled into the editor */
  question: string;
  onClose: () => void;
  onSaved?: () => void;
}

/**
 * Modal wrapping the existing knowledge_base write path. Slugifies the
 * customer question into a unique topic slug, lets the manager edit the
 * editable title and the answer body, and POSTs with `isFaq: true` so it
 * lands in the FAQs tab.
 */
export default function AddToKbModal({
  question,
  onClose,
  onSaved,
}: AddToKbModalProps) {
  const [existing, setExisting] = useState<string[]>([]);
  const [title, setTitle] = useState(question);
  const [content, setContent] = useState(`Q: ${question}\n\nA: `);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/knowledge", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { entries: [] }))
      .then((data) =>
        setExisting(
          (data.entries ?? []).map((e: KnowledgeEntry) => e.topic) as string[]
        )
      )
      .catch(() => setExisting([]));
  }, []);

  const slug = useMemo(
    () => dedupSlug(slugify(title), existing),
    [title, existing]
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: slug, content, isFaq: true }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      onSaved?.();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      onClick={onClose}
      data-testid="add-to-kb-modal"
      role="dialog"
      aria-modal="true"
      aria-label="Add to knowledge base"
    >
      <div
        className="bg-surface rounded-card shadow-card-md max-w-2xl w-full max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h3 className="text-sm font-semibold">Add to Knowledge Base</h3>
          <button
            onClick={onClose}
            className="text-text-secondary hover:text-text-primary"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">
              Question (editable title)
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-border rounded-button focus:outline-none focus:ring-2 focus:ring-accent/20"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">
              Topic slug (auto)
            </label>
            <code className="block text-xs px-3 py-2 bg-background rounded-button text-text-secondary">
              {slug}
            </code>
          </div>

          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">
              Answer
            </label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={10}
              className="w-full px-3 py-2 text-sm border border-border rounded-button focus:outline-none focus:ring-2 focus:ring-accent/20 font-mono"
            />
          </div>

          {error && <p className="text-xs text-error">{error}</p>}
        </div>

        <div className="flex items-center justify-end gap-2 p-4 border-t border-border">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving} size="sm">
            {saving ? (
              <Loader2 size={14} className="mr-1.5 animate-spin" />
            ) : (
              <Save size={14} className="mr-1.5" />
            )}
            {saving ? "Saving…" : "Save FAQ"}
          </Button>
        </div>
      </div>
    </div>
  );
}
