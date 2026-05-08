"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import TopBar from "@/components/ui/TopBar";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import MetricCard from "@/components/dashboard/manager/MetricCard";
import { ThumbsUp, ThumbsDown } from "lucide-react";

interface FeedbackRow {
  id: string;
  sessionId: string;
  rating: string;
  comment: string | null;
  submittedAt: string;
  customerEmail: string | null;
}

interface FeedbackData {
  summary: {
    total: number;
    up: number;
    down: number;
    csat_pct: number;
  };
  recent: FeedbackRow[];
}

const DAY_OPTIONS = [7, 14, 30, 90];

export default function ManagerFeedbackPage() {
  const [data, setData] = useState<FeedbackData | null>(null);
  const [days, setDays] = useState<number>(30);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/admin/feedback?days=${days}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(res)))
      .then((d) => setData(d))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [days]);

  return (
    <>
      <TopBar title="Feedback" />
      <div className="flex-1 overflow-y-auto p-6">
        <div className="flex items-center gap-2 mb-4">
          <span className="text-sm text-text-secondary">Window:</span>
          {DAY_OPTIONS.map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`px-3 py-1 text-xs rounded-full border transition-colors ${
                days === d
                  ? "bg-accent text-white border-accent"
                  : "bg-white text-text-secondary border-border hover:border-accent/40"
              }`}
            >
              {d}d
            </button>
          ))}
        </div>

        <div className="grid grid-cols-4 gap-4 mb-6">
          <MetricCard
            title="Total Ratings"
            value={data?.summary.total ?? 0}
            subtitle={`Last ${days} days`}
          />
          <MetricCard
            title="Thumbs Up"
            value={data?.summary.up ?? 0}
            subtitle="Positive ratings"
            accent
          />
          <MetricCard
            title="Thumbs Down"
            value={data?.summary.down ?? 0}
            subtitle="Negative ratings"
          />
          <MetricCard
            title="CSAT"
            value={
              data && data.summary.up + data.summary.down > 0
                ? `${data.summary.csat_pct}%`
                : "—"
            }
            subtitle="Up / (up + down)"
            accent={Boolean(
              data && data.summary.csat_pct >= 80 && data.summary.total > 0
            )}
          />
        </div>

        <Card>
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-text-primary">
              Recent Feedback
            </h3>
            <span className="text-xs text-text-secondary">
              Showing {data?.recent.length ?? 0} most recent
            </span>
          </div>
          {loading && !data ? (
            <p className="text-sm text-text-secondary py-8 text-center">
              Loading...
            </p>
          ) : data?.recent.length === 0 ? (
            <p className="text-sm text-text-secondary py-8 text-center">
              No feedback yet in this window.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-text-secondary border-b border-border">
                  <tr>
                    <th className="py-2 pr-3">Rating</th>
                    <th className="py-2 pr-3">Submitted</th>
                    <th className="py-2 pr-3">Customer</th>
                    <th className="py-2 pr-3">Comment</th>
                    <th className="py-2 pr-3">Session</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.recent.map((row) => (
                    <tr key={row.id} className="border-b border-border/60">
                      <td className="py-2 pr-3">
                        {row.rating === "up" ? (
                          <Badge variant="success">
                            <ThumbsUp size={11} className="inline -mt-0.5 mr-0.5" />
                            Up
                          </Badge>
                        ) : (
                          <Badge variant="danger">
                            <ThumbsDown size={11} className="inline -mt-0.5 mr-0.5" />
                            Down
                          </Badge>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-xs text-text-secondary">
                        {new Date(row.submittedAt).toLocaleString()}
                      </td>
                      <td className="py-2 pr-3 text-xs text-text-secondary">
                        {row.customerEmail || "—"}
                      </td>
                      <td className="py-2 pr-3 text-xs text-text-primary max-w-md">
                        {row.comment || (
                          <span className="text-text-secondary italic">
                            (no comment)
                          </span>
                        )}
                      </td>
                      <td className="py-2 pr-3">
                        <Link
                          href={`/dashboard/history?sessionId=${row.sessionId}`}
                          className="text-xs text-accent hover:underline font-mono"
                        >
                          {row.sessionId.slice(0, 8)}
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
