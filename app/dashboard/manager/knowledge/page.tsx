"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import TopBar from "@/components/ui/TopBar";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import { Plus, Trash2 } from "lucide-react";
import KnowledgeEditor from "@/components/dashboard/manager/KnowledgeEditor";
import CannedRepliesEditor from "@/components/dashboard/manager/CannedRepliesEditor";
import { slugify, dedupSlug } from "@/lib/utils/slugify";

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

export default function KnowledgeBasePage() {
  const [entries, setEntries] = useState<KnowledgeEntry[]>([]);
  const [activeTab, setActiveTab] = useState<Tab>("policies");
  const [activeTopic, setActiveTopic] = useState<string | null>(null);

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
    () => entries.filter((e) => !e.isFaq).sort((a, b) => a.topic.localeCompare(b.topic)),
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
    await fetch("/api/admin/knowledge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic, content }),
    });
    await fetchEntries();
  };

  const handleNewFaq = async () => {
    const title = window.prompt(
      "FAQ title (will be slugified into the topic id):"
    );
    if (!title) return;
    const taken = new Set(entries.map((e) => e.topic));
    const topic = dedupSlug(slugify(title), taken);
    await fetch("/api/admin/knowledge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        topic,
        content: `Q: ${title}\n\nA: `,
        isFaq: true,
      }),
    });
    await fetchEntries();
    setActiveTab("faqs");
    setActiveTopic(topic);
  };

  const handleDelete = async (id: string, topic: string) => {
    if (!window.confirm(`Delete the "${topic}" entry?`)) return;
    await fetch(`/api/admin/knowledge?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    await fetchEntries();
    setActiveTopic(null);
  };

  const showList = activeTab === "policies" || activeTab === "faqs";
  const list = activeTab === "policies" ? policies : faqs;
  const selected = list.find((e) => e.topic === activeTopic) ?? null;

  return (
    <>
      <TopBar title="Knowledge Base" />
      <div className="flex-1 overflow-y-auto p-6">
        <div className="flex gap-1 mb-6 bg-surface rounded-card p-1 shadow-card w-fit">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => {
                setActiveTab(tab.id);
                setActiveTopic(null);
              }}
              className={`px-4 py-2 text-sm font-medium rounded-button transition-colors ${
                activeTab === tab.id
                  ? "bg-primary text-white"
                  : "text-text-secondary hover:text-text-primary hover:bg-background"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

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
                  <Button size="sm" variant="secondary" onClick={handleNewFaq}>
                    <Plus size={12} className="mr-1" /> New
                  </Button>
                )}
              </div>
              {list.length === 0 ? (
                <p className="text-xs text-text-secondary">
                  {activeTab === "faqs"
                    ? "No FAQ entries yet. Add one from Insights or Review."
                    : "No policy entries yet."}
                </p>
              ) : (
                <ul className="space-y-1 max-h-[60vh] overflow-y-auto">
                  {list.map((entry) => (
                    <li key={entry.id}>
                      <button
                        onClick={() => setActiveTopic(entry.topic)}
                        className={`w-full text-left px-2 py-1.5 rounded-button text-sm transition-colors ${
                          activeTopic === entry.topic
                            ? "bg-accent-solid text-white"
                            : "hover:bg-background"
                        }`}
                      >
                        <span className="block truncate capitalize">
                          {entry.topic.replace(/_/g, " ").replace(/-/g, " ")}
                        </span>
                      </button>
                    </li>
                  ))}
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
                        onClick={() => handleDelete(selected.id, selected.topic)}
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
    </>
  );
}
