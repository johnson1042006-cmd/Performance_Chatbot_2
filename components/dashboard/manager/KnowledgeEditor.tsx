"use client";

import { useState, useEffect } from "react";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import MarkdownMessage from "@/components/chat/MarkdownMessage";
import { Save, Clock } from "lucide-react";

interface KnowledgeEditorProps {
  topic: string;
  initialContent: string;
  updatedAt?: string;
  onSave: (topic: string, content: string) => Promise<void>;
}

export default function KnowledgeEditor({
  topic,
  initialContent,
  updatedAt,
  onSave,
}: KnowledgeEditorProps) {
  const [content, setContent] = useState(initialContent);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [mode, setMode] = useState<"edit" | "preview">("edit");

  useEffect(() => {
    setContent(initialContent);
    setMode("edit");
  }, [initialContent]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(topic, content);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  const tabClass = (active: boolean) =>
    `px-3 py-1 text-xs font-medium rounded-button transition-colors ${
      active
        ? "bg-primary text-white"
        : "text-text-secondary hover:text-text-primary hover:bg-background"
    }`;

  return (
    <Card>
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-text-primary capitalize">
          {topic.replace(/_/g, " ").replace(/-/g, " ")}
        </h3>
        {updatedAt && (
          <span className="flex items-center gap-1 text-xs text-text-secondary">
            <Clock size={12} />
            Updated{" "}
            {new Date(updatedAt).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </span>
        )}
      </div>

      <div className="flex gap-1 mb-2 bg-background rounded-button p-1 w-fit">
        <button
          type="button"
          onClick={() => setMode("edit")}
          className={tabClass(mode === "edit")}
        >
          Edit
        </button>
        <button
          type="button"
          onClick={() => setMode("preview")}
          className={tabClass(mode === "preview")}
        >
          Preview
        </button>
      </div>

      {mode === "edit" ? (
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={12}
          className="w-full px-3 py-2.5 text-sm border border-border rounded-button focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent resize-y font-mono"
        />
      ) : (
        <div className="w-full min-h-[18rem] px-3 py-2.5 text-sm border border-border rounded-button bg-surface overflow-y-auto">
          {content.trim() ? (
            <MarkdownMessage content={content} />
          ) : (
            <p className="text-text-secondary">Nothing to preview yet.</p>
          )}
        </div>
      )}

      <div className="flex items-center justify-end gap-2 mt-3">
        {saved && (
          <span className="text-xs text-success font-medium">Saved!</span>
        )}
        <Button onClick={handleSave} disabled={saving} size="sm">
          <Save size={14} className="mr-1.5" />
          {saving ? "Saving..." : "Save"}
        </Button>
      </div>
    </Card>
  );
}
