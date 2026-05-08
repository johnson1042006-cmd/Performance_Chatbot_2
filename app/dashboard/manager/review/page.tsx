"use client";

import { useCallback, useEffect, useState } from "react";
import TopBar from "@/components/ui/TopBar";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import { Plus, AlertCircle } from "lucide-react";
import AddToKbModal from "@/components/dashboard/manager/AddToKbModal";

interface SurroundingMessage {
  id: string;
  role: string;
  content: string;
  sent_at: string;
}

interface ReviewItem {
  session_id: string;
  message_id: string;
  content: string;
  sent_at: string;
  intent: string | null;
  customer_question: string | null;
  surrounding: SurroundingMessage[];
}

export default function ReviewQueuePage() {
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [addQuestion, setAddQuestion] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/review-queue", { cache: "no-store" });
      const data = res.ok ? await res.json() : { items: [] };
      setItems(data.items ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <>
      <TopBar title="Review queue" />
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        <Card>
          <div className="flex items-center gap-2 text-sm text-text-secondary">
            <AlertCircle size={14} />
            Showing AI replies flagged with low confidence in the last 7 days.
            Use “Add to KB” to record an answer for next time.
          </div>
        </Card>

        {loading ? (
          <Card>
            <p className="text-sm text-text-secondary">Loading…</p>
          </Card>
        ) : items.length === 0 ? (
          <Card>
            <p className="text-sm text-text-secondary">
              No low-confidence replies in the last 7 days.
            </p>
          </Card>
        ) : (
          items.map((item) => (
            <Card key={item.message_id} padding={false}>
              <div className="flex items-center justify-between px-6 py-3 border-b border-border">
                <div className="flex items-center gap-2 text-sm">
                  <span className="font-medium">
                    {new Date(item.sent_at).toLocaleString()}
                  </span>
                  {item.intent && (
                    <span className="px-1.5 py-0.5 bg-background rounded text-xs">
                      {item.intent.replace(/_/g, " ")}
                    </span>
                  )}
                  <span className="px-1.5 py-0.5 bg-error/10 text-error text-xs rounded">
                    low confidence
                  </span>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    setAddQuestion(
                      item.customer_question || "Untitled review FAQ"
                    )
                  }
                  data-testid="review-add-to-kb"
                >
                  <Plus size={14} className="mr-1" /> Add to KB
                </Button>
              </div>
              <div className="px-6 py-4 space-y-2">
                {item.surrounding.map((m) => (
                  <div
                    key={m.id}
                    className={`text-xs p-2 rounded-card ${
                      m.id === item.message_id
                        ? "bg-error/10 border border-error/30"
                        : m.role === "customer"
                        ? "bg-background"
                        : m.role === "ai"
                        ? "bg-purple-50"
                        : "bg-emerald-50"
                    }`}
                  >
                    <p className="text-[10px] uppercase font-semibold text-text-secondary mb-1">
                      {m.role}
                      {m.id === item.message_id && (
                        <span className="ml-2 normal-case text-error">
                          flagged
                        </span>
                      )}
                    </p>
                    <p className="whitespace-pre-wrap break-words text-text-primary">
                      {m.content}
                    </p>
                  </div>
                ))}
              </div>
            </Card>
          ))
        )}
      </div>

      {addQuestion && (
        <AddToKbModal
          question={addQuestion}
          onClose={() => setAddQuestion(null)}
          onSaved={() => void refresh()}
        />
      )}
    </>
  );
}
