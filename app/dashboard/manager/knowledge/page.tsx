"use client";

import { useState, useEffect, useCallback } from "react";
import TopBar from "@/components/ui/TopBar";
import KnowledgeEditor from "@/components/dashboard/manager/KnowledgeEditor";
import PairingsTable from "@/components/dashboard/manager/PairingsTable";

interface KnowledgeEntry {
  id: string;
  topic: string;
  content: string;
  updatedAt: string;
}

const TABS = [
  { id: "return_policy", label: "Return Policy" },
  { id: "service_info", label: "Service Info" },
  { id: "ebike_info", label: "E-Bikes" },
  { id: "store_hours", label: "Store Hours" },
  { id: "pairings", label: "Product Pairings" },
];

export default function KnowledgeBasePage() {
  const [entries, setEntries] = useState<KnowledgeEntry[]>([]);
  const [activeTab, setActiveTab] = useState("return_policy");

  const fetchEntries = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/knowledge");
      const data = await res.json();
      if (data.entries) setEntries(data.entries);
    } catch (error) {
      console.error("Failed to fetch knowledge:", error);
    }
  }, []);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  const handleSave = async (topic: string, content: string) => {
    await fetch("/api/admin/knowledge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic, content }),
    });
    fetchEntries();
  };

  const getEntry = (topic: string) =>
    entries.find((e) => e.topic === topic);

  return (
    <>
      <TopBar title="Knowledge Base" />
      <div className="flex-1 overflow-y-auto p-6">
        <div className="flex gap-1 mb-6 bg-surface rounded-card p-1 shadow-card w-fit">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
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

        {activeTab === "pairings" ? (
          <PairingsTable />
        ) : (
          <KnowledgeEditor
            key={activeTab}
            topic={activeTab}
            initialContent={getEntry(activeTab)?.content || ""}
            updatedAt={getEntry(activeTab)?.updatedAt}
            onSave={handleSave}
          />
        )}
      </div>
    </>
  );
}
