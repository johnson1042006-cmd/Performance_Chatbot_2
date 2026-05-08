"use client";

import { useEffect, useState } from "react";
import Card from "@/components/ui/Card";
import Link from "next/link";
import { Ticket, AlertTriangle } from "lucide-react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  Tooltip,
  YAxis,
  XAxis,
} from "recharts";

interface SparkPoint {
  date: string;
  openCount: number;
}

interface StatsResponse {
  openCount: number;
  breachedInWindow: number;
  breachRatePct: number;
  avgResolutionHours: number | null;
  sparkline?: SparkPoint[];
}

export default function TicketsHubCard() {
  const [data, setData] = useState<StatsResponse | null>(null);

  useEffect(() => {
    fetch("/api/admin/tickets/stats?days=7", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setData(d))
      .catch(() => setData(null));
  }, []);

  const openCount = data?.openCount ?? 0;
  const breached = data?.breachedInWindow ?? 0;
  const avgHours = data?.avgResolutionHours;
  const sparkline = data?.sparkline ?? [];

  return (
    <Card className="h-full">
      <div className="flex items-baseline justify-between mb-2">
        <h3 className="font-semibold text-text-primary text-sm flex items-center gap-1.5">
          <Ticket size={14} className="text-text-secondary" />
          Tickets (7 days)
        </h3>
        <Link
          href="/dashboard/manager/tickets"
          className="text-xs text-text-secondary hover:text-text-primary"
        >
          Stats →
        </Link>
      </div>

      <div className="grid grid-cols-3 gap-2 mb-3">
        <Stat label="Open" value={openCount} />
        <Stat
          label="Breached"
          value={breached}
          accent={breached > 0 ? "danger" : undefined}
          icon={
            breached > 0 ? (
              <AlertTriangle size={11} className="text-error" />
            ) : null
          }
        />
        <Stat
          label="Avg resolve"
          value={avgHours !== null && avgHours !== undefined ? `${avgHours}h` : "—"}
        />
      </div>

      <div className="h-12">
        {sparkline.length > 1 ? (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={sparkline}>
              <XAxis dataKey="date" hide />
              <YAxis hide />
              <Tooltip
                formatter={(v: unknown) => [Number(v) || 0, "Open"]}
                labelFormatter={(l: unknown) => String(l ?? "")}
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
          <p className="text-[11px] text-text-secondary">
            Not enough data yet for a sparkline.
          </p>
        )}
      </div>
    </Card>
  );
}

function Stat({
  label,
  value,
  accent,
  icon,
}: {
  label: string;
  value: number | string;
  accent?: "danger";
  icon?: React.ReactNode;
}) {
  return (
    <div>
      <div
        className={`text-2xl font-bold ${
          accent === "danger" ? "text-error" : "text-text-primary"
        } flex items-center gap-1`}
      >
        {icon}
        {value}
      </div>
      <div className="text-[10px] uppercase font-semibold text-text-secondary tracking-wide">
        {label}
      </div>
    </div>
  );
}
