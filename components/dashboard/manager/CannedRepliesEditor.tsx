"use client";

import { useCallback, useEffect, useState } from "react";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import { Plus, Pencil, Trash2, Save, X } from "lucide-react";

interface CannedReply {
  id: string;
  title: string;
  body: string;
  category: string;
  createdAt: string;
  updatedAt: string;
}

const PLACEHOLDER_HINT =
  "Supported placeholders: {customer_name}, {agent_name}, {store_phone}";

interface FormState {
  id: string | null;
  title: string;
  category: string;
  body: string;
}

const EMPTY_FORM: FormState = {
  id: null,
  title: "",
  category: "",
  body: "",
};

/**
 * Phase 4 manager UI for canned replies. Mirrors the visual patterns of
 * KnowledgeEditor — Card + textarea — but supports a list of records with
 * per-row edit/delete and an inline create form.
 */
export default function CannedRepliesEditor() {
  const [replies, setReplies] = useState<CannedReply[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchReplies = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/canned", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setReplies(data.replies ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load replies");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchReplies();
  }, [fetchReplies]);

  const startCreate = () => {
    setForm(EMPTY_FORM);
    setShowForm(true);
  };

  const startEdit = (r: CannedReply) => {
    setForm({
      id: r.id,
      title: r.title,
      body: r.body,
      category: r.category,
    });
    setShowForm(true);
  };

  const cancelForm = () => {
    setShowForm(false);
    setForm(EMPTY_FORM);
  };

  const handleSave = async () => {
    if (!form.title.trim() || !form.category.trim() || !form.body.trim()) {
      setError("Title, category, and body are required");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const isUpdate = !!form.id;
      const res = await fetch("/api/admin/canned", {
        method: isUpdate ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: form.id ?? undefined,
          title: form.title.trim(),
          category: form.category.trim(),
          body: form.body,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await fetchReplies();
      cancelForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm("Delete this canned reply?")) return;
    try {
      const res = await fetch(`/api/admin/canned?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await fetchReplies();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete");
    }
  };

  // Group by category for display.
  const grouped = replies.reduce<Record<string, CannedReply[]>>((acc, r) => {
    const key = r.category || "Uncategorized";
    if (!acc[key]) acc[key] = [];
    acc[key].push(r);
    return acc;
  }, {});

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="font-semibold text-text-primary">
              Canned Replies
            </h3>
            <p className="text-xs text-text-secondary mt-0.5">
              Agents can pull these into a chat by typing &quot;/&quot; in
              the reply box. {PLACEHOLDER_HINT}
            </p>
          </div>
          {!showForm && (
            <Button size="sm" onClick={startCreate} data-testid="canned-new">
              <Plus size={14} className="mr-1.5" />
              New reply
            </Button>
          )}
        </div>

        {error && (
          <p className="text-xs text-red-600 mb-3">{error}</p>
        )}

        {showForm && (
          <div
            className="border border-border rounded-card p-3 mb-4 bg-background"
            data-testid="canned-form"
          >
            <div className="grid gap-2 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1">
                  Title
                </label>
                <input
                  type="text"
                  value={form.title}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, title: e.target.value }))
                  }
                  maxLength={120}
                  className="w-full px-2.5 py-1.5 text-sm border border-border rounded-button"
                  data-testid="canned-form-title"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1">
                  Category
                </label>
                <input
                  type="text"
                  value={form.category}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, category: e.target.value }))
                  }
                  maxLength={60}
                  className="w-full px-2.5 py-1.5 text-sm border border-border rounded-button"
                  data-testid="canned-form-category"
                />
              </div>
            </div>
            <div className="mt-2">
              <label className="block text-xs font-medium text-text-secondary mb-1">
                Body (markdown supported)
              </label>
              <textarea
                value={form.body}
                onChange={(e) =>
                  setForm((f) => ({ ...f, body: e.target.value }))
                }
                rows={6}
                placeholder={`Hi {customer_name}! Thanks for reaching out…`}
                className="w-full px-2.5 py-2 text-sm border border-border rounded-button focus:outline-none focus:ring-2 focus:ring-accent/20 resize-y font-mono"
                data-testid="canned-form-body"
              />
            </div>
            <div className="flex items-center justify-end gap-2 mt-3">
              <Button variant="ghost" size="sm" onClick={cancelForm}>
                <X size={12} className="mr-1" />
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleSave}
                disabled={saving}
                data-testid="canned-form-save"
              >
                <Save size={12} className="mr-1" />
                {saving ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
        )}

        {loading && (
          <p className="text-sm text-text-secondary">Loading replies…</p>
        )}
        {!loading && replies.length === 0 && (
          <p className="text-sm text-text-secondary">
            No canned replies yet. Click &quot;New reply&quot; to create one.
          </p>
        )}
        <div className="space-y-3">
          {Object.entries(grouped).map(([category, items]) => (
            <div key={category}>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-text-secondary mb-1">
                {category}
              </p>
              <div className="space-y-1.5">
                {items.map((r) => (
                  <div
                    key={r.id}
                    data-testid="canned-row"
                    className="border border-border rounded-card p-2.5 bg-surface"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-text-primary">
                          {r.title}
                        </p>
                        <p className="text-xs text-text-secondary line-clamp-3 whitespace-pre-wrap mt-1">
                          {r.body}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          aria-label="Edit"
                          onClick={() => startEdit(r)}
                          className="p-1 text-text-secondary hover:text-text-primary"
                        >
                          <Pencil size={12} />
                        </button>
                        <button
                          type="button"
                          aria-label="Delete"
                          onClick={() => handleDelete(r.id)}
                          className="p-1 text-text-secondary hover:text-red-600"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
