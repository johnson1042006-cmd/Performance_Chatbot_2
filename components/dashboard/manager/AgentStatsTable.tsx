"use client";

import { useEffect, useState } from "react";
import Card from "@/components/ui/Card";

interface AgentStat {
  agent_id: string;
  name: string;
  chats_handled: number;
  avg_first_response_seconds: number | null;
  avg_handle_time_seconds: number | null;
  csat_pct: number;
  release_rate: number;
  escalations_taken: number;
}

interface Props {
  /** When `compact`, the leaderboard caps to top 5 and hides some columns. */
  compact?: boolean;
  days?: number;
}

function formatSeconds(s: number | null): string {
  if (s === null || isNaN(s)) return "—";
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  return `${Math.round(s / 3600)}h ${Math.round((s % 3600) / 60)}m`;
}

export default function AgentStatsTable({ compact = false, days = 30 }: Props) {
  const [agents, setAgents] = useState<AgentStat[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/admin/agent-stats?days=${days}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { agents: [] }))
      .then((d) => setAgents(d.agents ?? []))
      .catch(() => setAgents([]))
      .finally(() => setLoading(false));
  }, [days]);

  const list = compact ? agents.slice(0, 5) : agents;

  return (
    <Card padding={false} className="h-full">
      <div className="flex items-center justify-between px-6 py-3 border-b border-border">
        <h3 className="font-semibold text-text-primary text-sm">
          {compact ? "Agent leaderboard" : `${days}-day agent rollup`}
        </h3>
        {!compact && (
          <span className="text-xs text-text-secondary">
            {agents.length} active agent{agents.length === 1 ? "" : "s"}
          </span>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-background">
              <th className="text-left px-4 py-2 font-medium text-text-secondary">Agent</th>
              <th className="text-right px-4 py-2 font-medium text-text-secondary">Chats</th>
              {!compact && (
                <th className="text-right px-4 py-2 font-medium text-text-secondary">FRT</th>
              )}
              {!compact && (
                <th className="text-right px-4 py-2 font-medium text-text-secondary">AHT</th>
              )}
              <th className="text-right px-4 py-2 font-medium text-text-secondary">CSAT</th>
              {!compact && (
                <th className="text-right px-4 py-2 font-medium text-text-secondary">
                  Release %
                </th>
              )}
              {!compact && (
                <th className="text-right px-4 py-2 font-medium text-text-secondary">
                  Escalations
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td
                  colSpan={compact ? 3 : 7}
                  className="px-4 py-6 text-center text-text-secondary"
                >
                  Loading…
                </td>
              </tr>
            ) : list.length === 0 ? (
              <tr>
                <td
                  colSpan={compact ? 3 : 7}
                  className="px-4 py-6 text-center text-text-secondary"
                >
                  No agent activity in this window.
                </td>
              </tr>
            ) : (
              list.map((a) => (
                <tr
                  key={a.agent_id}
                  className="border-b border-border last:border-b-0 hover:bg-background/50"
                >
                  <td className="px-4 py-2 truncate max-w-[160px]">{a.name}</td>
                  <td className="px-4 py-2 text-right">{a.chats_handled}</td>
                  {!compact && (
                    <td className="px-4 py-2 text-right">
                      {formatSeconds(a.avg_first_response_seconds)}
                    </td>
                  )}
                  {!compact && (
                    <td className="px-4 py-2 text-right">
                      {formatSeconds(a.avg_handle_time_seconds)}
                    </td>
                  )}
                  <td className="px-4 py-2 text-right">{a.csat_pct}%</td>
                  {!compact && (
                    <td className="px-4 py-2 text-right">{a.release_rate}%</td>
                  )}
                  {!compact && (
                    <td className="px-4 py-2 text-right">{a.escalations_taken}</td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
