"use client";

import { useEffect, useState } from "react";
import TopBar from "@/components/ui/TopBar";
import Card from "@/components/ui/Card";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  Tooltip,
  YAxis,
  XAxis,
  BarChart,
  Bar,
  CartesianGrid,
} from "recharts";
import TicketsByAgentTable from "@/components/dashboard/manager/TicketsByAgentTable";
import { Loader2 } from "lucide-react";

interface CategoryRow {
  category: string;
  count: number;
}
interface AgentRow {
  agentId: string;
  name: string;
  openCount: number;
  resolvedCount: number;
  breachedCount: number;
  avgResolutionHours: number | null;
}
interface SparkPoint {
  date: string;
  openCount: number;
}
interface StatsResponse {
  days: number;
  openCount: number;
  totalInWindow: number;
  resolvedInWindow: number;
  breachedInWindow: number;
  breachRatePct: number;
  avgResolutionHours: number | null;
  byCategory: CategoryRow[];
  byAgent: AgentRow[];
  sparkline: SparkPoint[];
}

export default function ManagerTicketsStatsPage() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<StatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/admin/tickets/stats?days=${days}`, { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => setData(d))
      .catch((e) =>
        setError(e instanceof Error ? e.message : "Failed to load stats")
      )
      .finally(() => setLoading(false));
  }, [days]);

  return (
    <>
      <TopBar title="Ticket stats" />
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        <Card>
          <div className="flex items-center gap-2">
            <label className="text-xs text-text-secondary">Window:</label>
            <select
              value={days}
              onChange={(e) => setDays(parseInt(e.target.value, 10) || 30)}
              className="text-xs border border-border rounded px-2 py-1 bg-surface"
            >
              {[7, 14, 30, 60, 90].map((d) => (
                <option key={d} value={d}>
                  {d} days
                </option>
              ))}
            </select>
          </div>
        </Card>

        {loading ? (
          <Card>
            <p className="text-sm text-text-secondary">
              <Loader2 size={14} className="inline animate-spin mr-2" />
              Loading…
            </p>
          </Card>
        ) : error ? (
          <Card>
            <p className="text-sm text-red-700">{error}</p>
          </Card>
        ) : !data ? null : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
              <Metric label="Open" value={data.openCount} />
              <Metric
                label={`Created (${days}d)`}
                value={data.totalInWindow}
              />
              <Metric
                label="SLA breach rate"
                value={`${data.breachRatePct}%`}
                accent={data.breachRatePct > 0 ? "danger" : undefined}
              />
              <Metric
                label="Avg resolve (h)"
                value={
                  data.avgResolutionHours !== null
                    ? `${data.avgResolutionHours}h`
                    : "—"
                }
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Card>
                <h3 className="font-semibold text-text-primary text-sm mb-3">
                  Open tickets over time
                </h3>
                <div className="h-56">
                  {data.sparkline.length > 1 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={data.sparkline}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                        <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                        <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                        <Tooltip
                          formatter={(v: unknown) => [Number(v) || 0, "Open"]}
                          contentStyle={{ fontSize: 11 }}
                        />
                        <Line
                          type="monotone"
                          dataKey="openCount"
                          stroke="#6366f1"
                          strokeWidth={2}
                          dot={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  ) : (
                    <p className="text-xs text-text-secondary">
                      Not enough data yet.
                    </p>
                  )}
                </div>
              </Card>

              <Card>
                <h3 className="font-semibold text-text-primary text-sm mb-3">
                  Tickets by category
                </h3>
                <div className="h-56">
                  {data.byCategory.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={data.byCategory}
                        layout="vertical"
                        margin={{ top: 4, right: 8, bottom: 4, left: 8 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                        <XAxis type="number" tick={{ fontSize: 10 }} allowDecimals={false} />
                        <YAxis
                          type="category"
                          dataKey="category"
                          width={100}
                          tick={{ fontSize: 10 }}
                        />
                        <Tooltip contentStyle={{ fontSize: 11 }} />
                        <Bar dataKey="count" fill="#0ea5e9" />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <p className="text-xs text-text-secondary">
                      No tickets in this window.
                    </p>
                  )}
                </div>
              </Card>
            </div>

            <TicketsByAgentTable rows={data.byAgent} />
          </>
        )}
      </div>
    </>
  );
}

function Metric({
  label,
  value,
  accent,
}: {
  label: string;
  value: string | number;
  accent?: "danger";
}) {
  return (
    <Card>
      <div
        className={`text-3xl font-bold ${
          accent === "danger" ? "text-error" : "text-text-primary"
        }`}
      >
        {value}
      </div>
      <div className="text-xs uppercase tracking-wide text-text-secondary mt-1">
        {label}
      </div>
    </Card>
  );
}
