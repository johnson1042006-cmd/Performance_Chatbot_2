"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Trash2,
  Loader2,
  Sparkles,
  AlertCircle,
  CheckCircle,
  Info,
  AlertTriangle,
  type LucideIcon,
} from "lucide-react";
import {
  buildCleanupBanner,
  type CleanupBanner,
  type CleanupBannerVariant,
} from "./cleanupBanner";
export { buildCleanupBanner } from "./cleanupBanner";

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

const BANNER_STYLES: Record<CleanupBannerVariant, string> = {
  skipped:
    "bg-yellow-50 dark:bg-yellow-900/20 text-yellow-800 dark:text-yellow-200 border-yellow-200 dark:border-yellow-800",
  success:
    "bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-200 border-green-200 dark:border-green-800",
  empty:
    "bg-blue-50 dark:bg-blue-900/20 text-blue-800 dark:text-blue-200 border-blue-200 dark:border-blue-800",
  error:
    "bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-200 border-red-200 dark:border-red-800",
};

const BANNER_ICONS: Record<CleanupBannerVariant, LucideIcon> = {
  skipped: AlertCircle,
  success: CheckCircle,
  empty: Info,
  error: AlertTriangle,
};

export default function HistoryTable({ onSelectSession }: HistoryTableProps) {
  const [sessions, setSessions] = useState<SessionHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [cleanupRunning, setCleanupRunning] = useState(false);
  const [cleanupBanner, setCleanupBanner] = useState<CleanupBanner | null>(
    null
  );

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

  const handleDelete = async (
    e: React.MouseEvent,
    sessionId: string
  ) => {
    e.stopPropagation();
    if (deletingId) return;
    if (
      !window.confirm(
        "Delete this chat session and all its messages? This cannot be undone."
      )
    ) {
      return;
    }
    setDeletingId(sessionId);
    try {
      const res = await fetch(`/api/sessions/${sessionId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
    } catch (err) {
      console.error("Delete session failed:", err);
      alert("Failed to delete chat. Please try again.");
    } finally {
      setDeletingId(null);
    }
  };

  const showBanner = (banner: CleanupBanner) => {
    setCleanupBanner(banner);
    setTimeout(() => setCleanupBanner(null), 10_000);
  };

  const handleRunCleanup = async () => {
    if (cleanupRunning) return;
    if (
      !window.confirm(
        "Run cleanup now? This will permanently delete sessions older than the configured retention period."
      )
    ) {
      return;
    }
    setCleanupRunning(true);
    setCleanupBanner(null);
    try {
      const res = await fetch("/api/admin/cleanup", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      showBanner(buildCleanupBanner(data));
      await fetchHistory();
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Cleanup failed. See console for details.";
      console.error("Cleanup failed:", err);
      showBanner(buildCleanupBanner({}, msg));
    } finally {
      setCleanupRunning(false);
    }
  };

  const exportCSV = () => {
    // Phase 5: full transcripts export with tagger fields/CSAT/agent. The
    // server enforces manager-only access. This replaces the per-page
    // client-side CSV that only had a 6-column shape.
    window.location.href = "/api/admin/export?format=csv";
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
      <div className="flex items-center justify-between px-6 py-4 border-b border-border gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <h3 className="font-semibold text-text-primary">Chat History</h3>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="secondary"
            size="sm"
            onClick={handleRunCleanup}
            disabled={cleanupRunning}
          >
            {cleanupRunning ? (
              <Loader2 size={14} className="mr-1.5 animate-spin" />
            ) : (
              <Sparkles size={14} className="mr-1.5" />
            )}
            {cleanupRunning ? "Cleaning..." : "Run Cleanup"}
          </Button>
          <Button variant="secondary" size="sm" onClick={exportCSV}>
            <Download size={14} className="mr-1.5" />
            Export CSV
          </Button>
        </div>
      </div>

      {cleanupBanner && (() => {
        const Icon = BANNER_ICONS[cleanupBanner.variant];
        return (
          <div
            className={`flex items-start gap-2 px-6 py-3 border-b text-sm ${BANNER_STYLES[cleanupBanner.variant]}`}
          >
            <Icon size={16} className="mt-0.5 shrink-0" />
            <span>
              {cleanupBanner.message}
              {cleanupBanner.isSkipped && (
                <>
                  {" "}
                  <Link
                    href="/dashboard/manager/configure"
                    className="underline font-medium hover:opacity-80"
                  >
                    Configure retention period
                  </Link>
                </>
              )}
            </span>
          </div>
        );
      })()}

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
              <th className="text-right px-6 py-3 font-medium text-text-secondary">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} className="px-6 py-8 text-center text-text-secondary">
                  Loading...
                </td>
              </tr>
            ) : sessions.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-6 py-8 text-center text-text-secondary">
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
                    <td className="px-6 py-3 text-right">
                      <button
                        type="button"
                        onClick={(e) => handleDelete(e, s.id)}
                        disabled={deletingId === s.id}
                        title="Delete chat"
                        className="inline-flex items-center justify-center w-8 h-8 rounded-button text-text-secondary hover:text-error hover:bg-error/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {deletingId === s.id ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          <Trash2 size={14} />
                        )}
                      </button>
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
