"use client";

import { useState, useEffect, useCallback } from "react";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import { ChevronLeft, ChevronRight, Download } from "lucide-react";

interface SessionHistory {
  id: string;
  customerIdentifier: string;
  pageContext: Record<string, unknown> | null;
  startedAt: string;
  closedAt: string | null;
  status: string;
  messageCount: number;
  aiMessageCount: number;
}

interface HistoryTableProps {
  onSelectSession?: (sessionId: string) => void;
}

export default function HistoryTable({ onSelectSession }: HistoryTableProps) {
  const [sessions, setSessions] = useState<SessionHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const fetchHistory = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/sessions/history?page=${page}&limit=15`
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.sessions) {
        setSessions(data.sessions);
        setTotalPages(data.totalPages || 1);
      }
    } catch (error) {
      console.error("Failed to fetch history:", error);
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  const exportCSV = () => {
    const headers = "ID,Customer,Status,Started,Messages,AI Messages\n";
    const rows = sessions
      .map(
        (s) =>
          `${s.id},${s.customerIdentifier},${s.status},${s.startedAt},${s.messageCount},${s.aiMessageCount}`
      )
      .join("\n");
    const blob = new Blob([headers + rows], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `chat-history-page-${page}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const statusVariant = (status: string) => {
    switch (status) {
      case "waiting": return "warning" as const;
      case "active_human": return "success" as const;
      case "active_ai": return "ai" as const;
      case "closed": return "default" as const;
      default: return "default" as const;
    }
  };

  return (
    <Card padding={false}>
      <div className="flex items-center justify-between px-6 py-4 border-b border-border">
        <h3 className="font-semibold text-text-primary">Chat History</h3>
        <Button variant="secondary" size="sm" onClick={exportCSV}>
          <Download size={14} className="mr-1.5" />
          Export CSV
        </Button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-background">
              <th className="text-left px-6 py-3 font-medium text-text-secondary">
                Date
              </th>
              <th className="text-left px-6 py-3 font-medium text-text-secondary">
                Customer
              </th>
              <th className="text-left px-6 py-3 font-medium text-text-secondary">
                Status
              </th>
              <th className="text-left px-6 py-3 font-medium text-text-secondary">
                Messages
              </th>
              <th className="text-left px-6 py-3 font-medium text-text-secondary">
                AI Ratio
              </th>
              <th className="text-left px-6 py-3 font-medium text-text-secondary">
                Duration
              </th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="px-6 py-8 text-center text-text-secondary">
                  Loading...
                </td>
              </tr>
            ) : sessions.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-6 py-8 text-center text-text-secondary">
                  No chat history
                </td>
              </tr>
            ) : (
              sessions.map((s) => {
                const duration = s.closedAt
                  ? Math.round(
                      (new Date(s.closedAt).getTime() -
                        new Date(s.startedAt).getTime()) /
                        60000
                    )
                  : null;
                const aiRatio =
                  s.messageCount > 0
                    ? Math.round((s.aiMessageCount / s.messageCount) * 100)
                    : 0;

                return (
                  <tr
                    key={s.id}
                    onClick={() => onSelectSession?.(s.id)}
                    className="border-b border-border hover:bg-background/50 transition-colors cursor-pointer"
                  >
                    <td className="px-6 py-3 text-text-secondary">
                      {new Date(s.startedAt).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                    <td className="px-6 py-3 font-medium truncate max-w-[150px]">
                      {s.customerIdentifier.startsWith("Customer #") ? s.customerIdentifier : `Customer ${s.customerIdentifier.slice(-4).toUpperCase()}`}
                    </td>
                    <td className="px-6 py-3">
                      <Badge variant={statusVariant(s.status)} dot>
                        {s.status.replace("_", " ")}
                      </Badge>
                    </td>
                    <td className="px-6 py-3">{s.messageCount}</td>
                    <td className="px-6 py-3">
                      <span
                        className={
                          aiRatio > 50
                            ? "text-ai-badge font-medium"
                            : "text-text-secondary"
                        }
                      >
                        {aiRatio}% AI
                      </span>
                    </td>
                    <td className="px-6 py-3 text-text-secondary">
                      {duration !== null ? `${duration}m` : "Active"}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between px-6 py-3 border-t border-border">
          <span className="text-xs text-text-secondary">
            Page {page} of {totalPages}
          </span>
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              <ChevronLeft size={14} />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              <ChevronRight size={14} />
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
