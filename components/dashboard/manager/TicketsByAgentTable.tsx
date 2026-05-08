"use client";

import Card from "@/components/ui/Card";

interface AgentRow {
  agentId: string;
  name: string;
  openCount: number;
  resolvedCount: number;
  breachedCount: number;
  avgResolutionHours: number | null;
}

interface Props {
  rows: AgentRow[];
  loading?: boolean;
}

export default function TicketsByAgentTable({ rows, loading }: Props) {
  return (
    <Card padding={false} className="h-full">
      <div className="px-6 py-3 border-b border-border">
        <h3 className="font-semibold text-text-primary text-sm">
          Workload by agent
        </h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-background">
              <th className="text-left px-4 py-2 font-medium text-text-secondary">
                Agent
              </th>
              <th className="text-right px-4 py-2 font-medium text-text-secondary">
                Open
              </th>
              <th className="text-right px-4 py-2 font-medium text-text-secondary">
                Resolved
              </th>
              <th className="text-right px-4 py-2 font-medium text-text-secondary">
                Breached
              </th>
              <th className="text-right px-4 py-2 font-medium text-text-secondary">
                Avg resolve (h)
              </th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td
                  colSpan={5}
                  className="px-4 py-6 text-center text-text-secondary"
                >
                  Loading…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  className="px-4 py-6 text-center text-text-secondary"
                >
                  No agents with tickets in this window.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr
                  key={r.agentId}
                  className="border-b border-border last:border-b-0"
                >
                  <td className="px-4 py-2 text-text-primary">{r.name}</td>
                  <td className="px-4 py-2 text-right text-text-primary tabular-nums">
                    {r.openCount}
                  </td>
                  <td className="px-4 py-2 text-right text-text-primary tabular-nums">
                    {r.resolvedCount}
                  </td>
                  <td
                    className={`px-4 py-2 text-right tabular-nums ${
                      r.breachedCount > 0 ? "text-error" : "text-text-primary"
                    }`}
                  >
                    {r.breachedCount}
                  </td>
                  <td className="px-4 py-2 text-right text-text-primary tabular-nums">
                    {r.avgResolutionHours !== null
                      ? r.avgResolutionHours
                      : "—"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
