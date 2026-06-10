"use client";

import { useEffect, useState } from "react";
import Card from "@/components/ui/Card";
import Link from "next/link";
import { Skeleton } from "@/components/ui/Skeleton";
import { ThumbsDown, ThumbsUp, AlertTriangle } from "lucide-react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  Tooltip,
  YAxis,
  XAxis,
} from "recharts";

interface CsatComment {
  session_id: string;
  rating: string;
  comment: string;
  submitted_at: string;
  customer_email: string | null;
}

interface CsatResponse {
  total_responses: number;
  thumbs_up: number;
  thumbs_down: number;
  csat_pct: number;
  recent_comments: CsatComment[];
  daily_pct: { date: string; pct: number; count: number }[];
}

export default function CsatCard() {
  const [data, setData] = useState<CsatResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    fetch("/api/admin/csat?days=30", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((d) => setData(d))
      .catch(() => {
        setData(null);
        setLoadError(true);
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <Card className="h-full">
        <div className="space-y-3">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-9 w-24" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-3 w-2/3" />
        </div>
      </Card>
    );
  }

  if (loadError) {
    return (
      <Card className="h-full">
        <h3 className="font-semibold text-text-primary text-sm mb-2">
          CSAT (30 days)
        </h3>
        <div className="flex items-center gap-2 text-sm text-text-secondary">
          <AlertTriangle size={14} className="text-amber-500 shrink-0" />
          Couldn&apos;t load CSAT data. Refresh to try again.
        </div>
      </Card>
    );
  }

  const csatPct = data?.csat_pct ?? 0;
  const total = data?.total_responses ?? 0;
  const thumbsUp = data?.thumbs_up ?? 0;
  const thumbsDown = data?.thumbs_down ?? 0;

  const sparkline = (data?.daily_pct ?? []).map((p) => ({
    date: p.date,
    pct: p.pct,
  }));

  const negatives = (data?.recent_comments ?? [])
    .filter((c) => c.rating === "down")
    .slice(0, 3);

  return (
    <Card className="h-full">
      <div className="flex items-baseline justify-between mb-2">
        <h3 className="font-semibold text-text-primary text-sm">
          CSAT (30 days)
        </h3>
        <span className="text-xs text-text-secondary">
          {total} response{total === 1 ? "" : "s"}
        </span>
      </div>

      <div className="flex items-end gap-4 mb-3">
        <div>
          <div className="text-3xl font-bold text-text-primary">{csatPct}%</div>
          <div className="flex gap-3 mt-1 text-xs text-text-secondary">
            <span className="flex items-center gap-1">
              <ThumbsUp size={11} className="text-success" /> {thumbsUp}
            </span>
            <span className="flex items-center gap-1">
              <ThumbsDown size={11} className="text-error" /> {thumbsDown}
            </span>
          </div>
        </div>
        <div className="flex-1 h-12 -mb-1">
          {sparkline.length > 1 && (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={sparkline}>
                <XAxis dataKey="date" hide />
                <YAxis domain={[0, 100]} hide />
                <Tooltip
                  formatter={(v: unknown) => [`${Number(v) || 0}%`, "CSAT"]}
                  labelFormatter={(l: unknown) => String(l ?? "")}
                  contentStyle={{ fontSize: 11 }}
                />
                <Line
                  type="monotone"
                  dataKey="pct"
                  stroke="#0ea5e9"
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className="border-t border-border pt-2 mt-2">
        <h4 className="text-xs font-semibold text-text-secondary mb-1">
          Negative feedback to review
        </h4>
        {negatives.length === 0 ? (
          <p className="text-xs text-text-secondary">No recent thumbs-down.</p>
        ) : (
          <ul className="space-y-1.5">
            {negatives.map((c) => (
              <li
                key={c.session_id + c.submitted_at}
                className="text-xs text-text-primary"
              >
                <Link
                  href={`/dashboard/manager/feedback`}
                  className="block hover:bg-background rounded-card p-1.5 -m-1.5 transition-colors"
                >
                  <span className="line-clamp-2">{c.comment}</span>
                  <span className="text-[10px] text-text-secondary mt-0.5 block">
                    {c.customer_email ?? "anonymous"} ·{" "}
                    {new Date(c.submitted_at).toLocaleDateString()}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
