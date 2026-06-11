"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import TopBar from "@/components/ui/TopBar";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import { Plus, Trash2, Search, X } from "lucide-react";
import KnowledgeEditor from "@/components/dashboard/manager/KnowledgeEditor";
import CannedRepliesEditor from "@/components/dashboard/manager/CannedRepliesEditor";
import { slugify, dedupSlug } from "@/lib/utils/slugify";
import { formatRelativeTime } from "@/lib/utils/relativeTime";

interface KnowledgeEntry {
  id: string;
  topic: string;
  content: string;
  updatedAt: string;
  isFaq: boolean;
}

type Tab = "policies" | "faqs" | "canned";

const TABS: { id: Tab; label: string }[] = [
  { id: "policies", label: "Policies" },
  { id: "faqs", label: "FAQs" },
  { id: "canned", label: "Canned Replies" },
];

const HIDDEN_TOPICS = ["store_catalog", "store_catalog_index"];

function titleCase(topic: string): string {
  return topic.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** New entries are stored snake_case to match the seeded policy topics. */
function toSnakeCase(input: string): string {
  return slugify(input).replace(/-/g, "_");
}

export default function KnowledgeBasePage() {
  const { addToast } = useToast();
  const [entries, setEntries] = useState<KnowledgeEntry[]>([]);
  const [activeTab, setActiveTab] = useState<Tab>("policies");
  const [activeTopic, setActiveTopic] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [newFaqOpen, setNewFaqOpen] = useState(false);
  const [newEntryOpen, setNewEntryOpen] = useState(false);
  const [newTopic, setNewTopic] = useState("");
  const [newContent, setNewContent] = useState("");
  const [creating, setCreating] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{
    id: string;
    topic: string;
  } | null>(null);

  const fetchEntries = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/knowledge", { cache: "no-store" });
      const data = await res.json();
      if (data.entries) setEntries(data.entries);
    } catch (error) {
      console.error("Failed to fetch knowledge:", error);
    }
  }, []);

  useEffect(() => {
    void fetchEntries();
  }, [fetchEntries]);

  const policies = useMemo(
    () =>
      entries
        .filter((e) => !e.isFaq && !HIDDEN_TOPICS.includes(e.topic))
        .sort((a, b) => a.topic.localeCompare(b.topic)),
    [entries]
  );
  const faqs = useMemo(
    () => entries.filter((e) => e.isFaq).sort((a, b) => a.topic.localeCompare(b.topic)),
    [entries]
  );

  // Default selection per tab. Policies always have at least one of the
  // seeded topics; FAQs may be empty so we render an empty state.
  useEffect(() => {
    if (activeTab === "policies") {
      if (!activeTopic || !policies.find((p) => p.topic === activeTopic)) {
        setActiveTopic(policies[0]?.topic ?? null);
      }
    } else if (activeTab === "faqs") {
      if (!activeTopic || !faqs.find((p) => p.topic === activeTopic)) {
        setActiveTopic(faqs[0]?.topic ?? null);
      }
    }
  }, [activeTab, policies, faqs, activeTopic]);

  const handleSave = async (topic: string, content: string) => {
    try {
      const res = await fetch("/api/admin/knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic, content }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      addToast("Saved", "success");
    } catch (error) {
      console.error("Failed to save knowledge entry:", error);
      addToast("Failed to save. Please try again.", "error");
      return;
    }
    await fetchEntries();
  };

  const handleNewFaq = async (title?: string) => {
    setNewFaqOpen(false);
    if (!title) return;
    const taken = new Set(entries.map((e) => e.topic));
    const topic = dedupSlug(slugify(title), taken);
    try {
      const res = await fetch("/api/admin/knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic,
          content: `Q: ${title}\n\nA: `,
          isFaq: true,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (error) {
      console.error("Failed to create FAQ:", error);
      addToast("Failed to create FAQ. Please try again.", "error");
      return;
    }
    await fetchEntries();
    setActiveTab("faqs");
    setActiveTopic(topic);
  };

  const resetNewEntry = () => {
    setNewEntryOpen(false);
    setNewTopic("");
    setNewContent("");
  };

  const handleCreateEntry = async () => {
    const title = newTopic.trim();
    if (!title || !newContent.trim() || creating) return;
    const taken = new Set(entries.map((e) => e.topic));
    const topic = dedupSlug(toSnakeCase(title), taken);
    const isFaq = activeTab === "faqs";
    setCreating(true);
    try {
      const res = await fetch("/api/admin/knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic, content: newContent, isFaq }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      addToast("Entry created", "success");
    } catch (error) {
      console.error("Failed to create entry:", error);
      addToast("Failed to create entry. Please try again.", "error");
      setCreating(false);
      return;
    }
    setCreating(false);
    resetNewEntry();
    await fetchEntries();
    setActiveTab(isFaq ? "faqs" : "policies");
    setActiveTopic(topic);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    const { id } = deleteTarget;
    setDeleteTarget(null);
    try {
      const res = await fetch(`/api/admin/knowledge?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (error) {
      console.error("Failed to delete knowledge entry:", error);
      addToast("Failed to delete. Please try again.", "error");
      return;
    }
    await fetchEntries();
    setActiveTopic(null);
  };

  const showList = activeTab === "policies" || activeTab === "faqs";
  const list = activeTab === "policies" ? policies : faqs;
  const filteredList = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (e) =>
        e.topic.toLowerCase().includes(q) ||
        e.content.toLowerCase().includes(q)
    );
  }, [list, search]);
  const selected = list.find((e) => e.topic === activeTopic) ?? null;

  const tabCount = (id: Tab): number | null => {
    if (id === "policies") return policies.length;
    if (id === "faqs") return faqs.length;
    return null;
  };

  return (
    <>
      <TopBar title="Knowledge Base" />
      <div className="flex-1 overflow-y-auto p-6">
        <div className="flex items-center justify-between gap-3 mb-6 flex-wrap">
          <div className="flex gap-1 bg-surface rounded-card p-1 shadow-card w-fit">
            {TABS.map((tab) => {
              const count = tabCount(tab.id);
              return (
                <button
                  key={tab.id}
                  onClick={() => {
                    setActiveTab(tab.id);
                    setActiveTopic(null);
                    setSearch("");
                  }}
                  className={`px-4 py-2 text-sm font-medium rounded-button transition-colors ${
                    activeTab === tab.id
                      ? "bg-primary text-white"
                      : "text-text-secondary hover:text-text-primary hover:bg-background"
                  }`}
                >
                  {tab.label}
                  {count !== null && (
                    <span className="ml-1.5 opacity-70">({count})</span>
                  )}
                </button>
              );
            })}
          </div>
          {showList && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setNewEntryOpen((v) => !v)}
            >
              <Plus size={14} className="mr-1" /> New entry
            </Button>
          )}
        </div>

        {showList && newEntryOpen && (
          <Card className="mb-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-text-primary text-sm">
                New {activeTab === "faqs" ? "FAQ" : "policy"} entry
              </h3>
              <button
                onClick={resetNewEntry}
                className="text-text-secondary hover:text-text-primary"
                aria-label="Close new entry form"
              >
                <X size={16} />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1">
                  Topic name
                </label>
                <input
                  type="text"
                  value={newTopic}
                  onChange={(e) => setNewTopic(e.target.value)}
                  placeholder="e.g. Holiday return window"
                  className="w-full px-3 py-2 text-sm border border-border rounded-button focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent"
                />
                {newTopic.trim() && (
                  <p className="text-xs text-text-secondary mt-1">
                    Saved as{" "}
                    <code className="px-1">{toSnakeCase(newTopic)}</code>, shown
                    as “{titleCase(toSnakeCase(newTopic))}”.
                  </p>
                )}
              </div>
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1">
                  Content
                </label>
                <textarea
                  value={newContent}
                  onChange={(e) => setNewContent(e.target.value)}
                  rows={6}
                  className="w-full px-3 py-2.5 text-sm border border-border rounded-button focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent resize-y font-mono"
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={resetNewEntry}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={() => void handleCreateEntry()}
                  disabled={creating || !newTopic.trim() || !newContent.trim()}
                >
                  {creating ? "Creating..." : "Create entry"}
                </Button>
              </div>
            </div>
          </Card>
        )}

        {activeTab === "canned" ? (
          <CannedRepliesEditor />
        ) : showList ? (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            <Card className="lg:col-span-3 h-fit">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-text-primary text-sm">
                  {activeTab === "policies" ? "Policies" : "FAQs"}
                </h3>
                {activeTab === "faqs" && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setNewFaqOpen(true)}
                  >
                    <Plus size={12} className="mr-1" /> New
                  </Button>
                )}
              </div>

              <div className="relative mb-3">
                <Search
                  size={14}
                  className="absolute left-2 top-1/2 -translate-y-1/2 text-text-secondary"
                />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search entries..."
                  className="w-full pl-7 pr-2 py-1.5 text-sm border border-border rounded-button focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent"
                />
              </div>

              {list.length === 0 ? (
                <p className="text-xs text-text-secondary">
                  {activeTab === "faqs"
                    ? "No FAQ entries yet. Add one from Insights or Review."
                    : "No policy entries yet."}
                </p>
              ) : filteredList.length === 0 ? (
                <p className="text-xs text-text-secondary">
                  No entries match “{search}”.
                </p>
              ) : (
                <ul className="space-y-1 max-h-[60vh] overflow-y-auto">
                  {filteredList.map((entry) => {
                    const isActive = activeTopic === entry.topic;
                    return (
                      <li key={entry.id}>
                        <button
                          onClick={() => setActiveTopic(entry.topic)}
                          className={`w-full text-left px-2 py-1.5 rounded-button text-sm transition-colors ${
                            isActive
                              ? "bg-accent-solid text-white"
                              : "hover:bg-background"
                          }`}
                        >
                          <span className="block truncate">
                            {titleCase(entry.topic)}
                          </span>
                          <span
                            className={`block text-xs truncate ${
                              isActive ? "text-white/70" : "text-text-secondary"
                            }`}
                            title={new Date(entry.updatedAt).toLocaleString()}
                          >
                            {formatRelativeTime(entry.updatedAt)}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>

            <div className="lg:col-span-9">
              {selected ? (
                <div className="space-y-3">
                  <KnowledgeEditor
                    key={selected.id}
                    topic={selected.topic}
                    initialContent={selected.content}
                    updatedAt={selected.updatedAt}
                    onSave={handleSave}
                  />
                  {activeTab === "faqs" && (
                    <div className="flex justify-end">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setDeleteTarget({
                            id: selected.id,
                            topic: selected.topic,
                          })
                        }
                      >
                        <Trash2 size={12} className="mr-1" />
                        Delete FAQ
                      </Button>
                    </div>
                  )}
                </div>
              ) : (
                <Card>
                  <p className="text-sm text-text-secondary">
                    {activeTab === "faqs"
                      ? "Select an FAQ from the list, or click + New to create one."
                      : "Select a policy entry from the list."}
                  </p>
                </Card>
              )}
            </div>
          </div>
        ) : null}
      </div>

      <ConfirmDialog
        open={newFaqOpen}
        title="New FAQ"
        confirmLabel="Create"
        inputLabel="FAQ title"
        inputPlaceholder="e.g. Do you ship internationally?"
        onConfirm={(title) => void handleNewFaq(title)}
        onCancel={() => setNewFaqOpen(false)}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete entry"
        message={
          deleteTarget
            ? `Delete the "${deleteTarget.topic}" entry? This cannot be undone.`
            : undefined
        }
        confirmLabel="Delete"
        destructive
        onConfirm={() => void handleDelete()}
        onCancel={() => setDeleteTarget(null)}
      />
    </>
  );
}
