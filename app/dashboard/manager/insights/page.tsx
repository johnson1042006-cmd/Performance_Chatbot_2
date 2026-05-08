"use client";

import { useCallback, useEffect, useState } from "react";
import TopBar from "@/components/ui/TopBar";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import { Plus } from "lucide-react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import AddToKbModal from "@/components/dashboard/manager/AddToKbModal";

interface IntentRow {
  intent: string;
  count: number;
}
interface TopicRow {
  tag: string;
  count: number;
}
interface UnansweredRow {
  id: string;
  started_at: string;
  closed_at: string | null;
  intent: string | null;
  topic_tags: string[];
  customer_email: string | null;
  customer_question: string | null;
  resolved: boolean | null;
  latest_ai_confidence: string | null;
}

function formatIntent(intent: string): string {
  return intent.replace(/_/g, " ");
}

export default function InsightsPage() {
  const [intents, setIntents] = useState<IntentRow[]>([]);
  const [topics, setTopics] = useState<TopicRow[]>([]);
  const [unanswered, setUnanswered] = useState<UnansweredRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [addQuestion, setAddQuestion] = useState<string | null>(null);
  const [days, setDays] = useState(30);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [topicsRes, unansweredRes] = await Promise.all([
        fetch(`/api/admin/topics?days=${days}`, { cache: "no-store" }),
        fetch(`/api/admin/unanswered?days=${days}`, { cache: "no-store" }),
      ]);
      const topicsData = topicsRes.ok ? await topicsRes.json() : null;
      const unansweredData = unansweredRes.ok ? await unansweredRes.json() : null;
      setIntents(topicsData?.intents ?? []);
      setTopics(topicsData?.topics ?? []);
      setUnanswered(unansweredData?.rows ?? []);
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <>
      <TopBar title="Insights">
        <select
          value={days}
          onChange={(e) => setDays(parseInt(e.target.value, 10))}
          className="px-3 py-1.5 text-xs border border-border rounded-button bg-surface"
        >
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
        </select>
      </TopBar>

      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card>
            <h3 className="font-semibold text-text-primary text-sm mb-3">
              Top intents
            </h3>
            {loading ? (
              <p className="text-xs text-text-secondary">Loading…</p>
            ) : intents.length === 0 ? (
              <p className="text-xs text-text-secondary">
                No tagged sessions yet.
              </p>
            ) : (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={intents.map((i) => ({
                      ...i,
                      label: formatIntent(i.intent),
                    }))}
                  >
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis
                      dataKey="label"
                      angle={-30}
                      textAnchor="end"
                      height={70}
                      fontSize={11}
                    />
                    <YAxis fontSize={11} />
                    <Tooltip />
                    <Bar dataKey="count" fill="#0ea5e9" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </Card>

          <Card>
            <h3 className="font-semibold text-text-primary text-sm mb-3">
              Top topic tags
            </h3>
            {loading ? (
              <p className="text-xs text-text-secondary">Loading…</p>
            ) : topics.length === 0 ? (
              <p className="text-xs text-text-secondary">
                No topic tags yet.
              </p>
            ) : (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={topics} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis type="number" fontSize={11} />
                    <YAxis
                      type="category"
                      dataKey="tag"
                      width={140}
                      fontSize={11}
                    />
                    <Tooltip />
                    <Bar dataKey="count" fill="#a855f7" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </Card>
        </div>

        <Card padding={false}>
          <div className="flex items-center justify-between px-6 py-3 border-b border-border">
            <h3 className="font-semibold text-sm">
              Unanswered ({unanswered.length})
            </h3>
            <span className="text-xs text-text-secondary">
              Sessions where the AI flagged unresolved or low confidence
            </span>
          </div>
          <div className="divide-y divide-border">
            {loading ? (
              <p className="px-6 py-6 text-xs text-text-secondary">Loading…</p>
            ) : unanswered.length === 0 ? (
              <p className="px-6 py-6 text-xs text-text-secondary">
                No unanswered sessions in this window.
              </p>
            ) : (
              unanswered.map((row) => (
                <div
                  key={row.id}
                  className="flex items-start justify-between gap-4 px-6 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <p
                      className="text-sm font-medium text-text-primary line-clamp-2"
                      data-testid="unanswered-question"
                    >
                      {row.customer_question || "(no customer message)"}
                    </p>
                    <div className="flex items-center gap-2 mt-1 text-xs text-text-secondary flex-wrap">
                      <span>{new Date(row.started_at).toLocaleString()}</span>
                      {row.intent && (
                        <span className="px-1.5 py-0.5 bg-background rounded">
                          {formatIntent(row.intent)}
                        </span>
                      )}
                      {row.latest_ai_confidence === "low" && (
                        <span className="px-1.5 py-0.5 bg-error/10 text-error rounded">
                          low confidence
                        </span>
                      )}
                      {row.resolved === false && (
                        <span className="px-1.5 py-0.5 bg-amber-100 text-amber-800 rounded">
                          unresolved
                        </span>
                      )}
                      {row.topic_tags?.slice(0, 3).map((t) => (
                        <span
                          key={t}
                          className="px-1.5 py-0.5 bg-purple-50 text-purple-700 rounded"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() =>
                      setAddQuestion(row.customer_question ?? "Untitled FAQ")
                    }
                    disabled={!row.customer_question}
                    data-testid="add-to-kb-button"
                  >
                    <Plus size={14} className="mr-1" />
                    Add to KB
                  </Button>
                </div>
              ))
            )}
          </div>
        </Card>
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
