"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Card from "@/components/ui/Card";
import { ArrowRight } from "lucide-react";

interface IntentRow {
  intent: string;
  count: number;
}

export default function TopIntentsCompact({ days = 7 }: { days?: number }) {
  const [rows, setRows] = useState<IntentRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/admin/topics?days=${days}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { intents: [] }))
      .then((d) => setRows((d.intents ?? []).slice(0, 6)))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [days]);

  const max = Math.max(1, ...rows.map((r) => r.count));

  return (
    <Card className="h-full">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-text-primary text-sm">
          Top intents ({days}d)
        </h3>
        <Link
          href="/dashboard/manager/insights"
          className="text-xs text-accent hover:underline flex items-center gap-1"
        >
          Insights <ArrowRight size={11} />
        </Link>
      </div>
      {loading ? (
        <p className="text-xs text-text-secondary">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-text-secondary">No tagged sessions yet.</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.intent} className="text-xs">
              <div className="flex items-center justify-between mb-0.5">
                <span className="capitalize">
                  {r.intent.replace(/_/g, " ")}
                </span>
                <span className="text-text-secondary">{r.count}</span>
              </div>
              <div className="h-1.5 bg-background rounded-full overflow-hidden">
                <div
                  className="h-full bg-accent"
                  style={{ width: `${(r.count / max) * 100}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
