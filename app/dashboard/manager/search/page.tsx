"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import TopBar from "@/components/ui/TopBar";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Search as SearchIcon,
} from "lucide-react";
import TranscriptModal from "@/components/dashboard/TranscriptModal";

interface SearchRow {
  id: string;
  started_at: string;
  closed_at: string | null;
  status: string;
  customer_email: string | null;
  customer_identifier: string;
  intent: string | null;
  agent_name: string | null;
  message_count: number;
  ai_count: number;
  ai_percent: number;
  snippet: string;
}

interface AgentOption {
  id: string;
  name: string;
}

const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "waiting", label: "Waiting" },
  { value: "active_human", label: "Active (human)" },
  { value: "active_ai", label: "Active (AI)" },
  { value: "closed", label: "Closed" },
];

/**
 * Render a ts_headline snippet WITHOUT trusting it as HTML.
 *
 * `messages.content` is raw customer/AI text — it is NOT HTML-escaped anywhere
 * upstream (redactPII does not strip tags), and `ts_headline` leaves the
 * surrounding text verbatim, so the snippet can contain live markup. We split
 * on the literal <mark>/</mark> sentinels we configure as StartSel/StopSel and
 * emit the intervening text as React text nodes, which React escapes. Any HTML
 * in a stored message therefore renders as inert text; the only thing an
 * attacker can influence by typing literal "<mark>" is cosmetic highlighting.
 */
function renderSnippet(snippet: string): ReactNode {
  const parts = snippet.split(/(<mark>|<\/mark>)/g);
  const nodes: ReactNode[] = [];
  let highlighting = false;
  let key = 0;
  for (const part of parts) {
    if (part === "<mark>") {
      highlighting = true;
      continue;
    }
    if (part === "</mark>") {
      highlighting = false;
      continue;
    }
    if (part === "") continue;
    nodes.push(
      highlighting ? (
        <mark key={key++}>{part}</mark>
      ) : (
        <span key={key++}>{part}</span>
      )
    );
  }
  return nodes;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function statusVariant(status: string) {
  switch (status) {
    case "waiting":
      return "warning" as const;
    case "active_human":
      return "success" as const;
    case "active_ai":
      return "ai" as const;
    case "closed":
      return "default" as const;
    default:
      return "default" as const;
  }
}

export default function ManagerSearchPage() {
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [status, setStatus] = useState("");
  const [agent, setAgent] = useState("");
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [page, setPage] = useState(1);
  const [results, setResults] = useState<SearchRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const limit = 25;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  const debounceRef = useRef<number | null>(null);

  useEffect(() => {
    fetch("/api/admin/users", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { users: [] }))
      .then((data) => {
        const opts: AgentOption[] = (data.users ?? [])
          .filter((u: { isActive: boolean }) => u.isActive)
          .map((u: { id: string; name: string }) => ({ id: u.id, name: u.name }));
        setAgents(opts);
      })
      .catch(() => {});
  }, []);

  const filterParams = useMemo(() => {
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    if (status) params.set("status", status);
    if (agent) params.set("agent", agent);
    return params;
  }, [q, from, to, status, agent]);

  const runSearch = useCallback(
    async (currentPage: number) => {
      if (!q.trim()) {
        setResults([]);
        setTotal(0);
        return;
      }
      setLoading(true);
      try {
        const params = new URLSearchParams(filterParams);
        params.set("page", String(currentPage));
        params.set("limit", String(limit));
        const res = await fetch(`/api/admin/search?${params.toString()}`, {
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setResults(data.results ?? []);
        setTotal(data.total ?? 0);
      } catch (err) {
        console.error("search failed", err);
        setResults([]);
        setTotal(0);
      } finally {
        setLoading(false);
      }
    },
    [q, filterParams]
  );

  // Debounce on every input change so the user gets feedback while typing.
  useEffect(() => {
    if (debounceRef.current) {
      window.clearTimeout(debounceRef.current);
    }
    debounceRef.current = window.setTimeout(() => {
      setPage(1);
      runSearch(1);
    }, 300);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [runSearch]);

  useEffect(() => {
    if (page !== 1) runSearch(page);
  }, [page, runSearch]);

  const handleExport = () => {
    const params = new URLSearchParams(filterParams);
    params.set("format", "csv");
    window.location.href = `/api/admin/export?${params.toString()}`;
  };

  return (
    <>
      <TopBar title="Search">
        <Button
          variant="secondary"
          size="sm"
          onClick={handleExport}
          disabled={!q.trim()}
        >
          <Download size={14} className="mr-1.5" />
          Export
        </Button>
      </TopBar>

      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        <Card>
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
            <div className="sm:col-span-5 relative">
              <SearchIcon
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary"
              />
              <input
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search transcripts (e.g. Tech-Air)"
                data-testid="search-input"
                className="w-full pl-9 pr-3 py-2 text-sm border border-border rounded-button focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent"
              />
            </div>
            <div className="sm:col-span-2">
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-border rounded-button focus:outline-none focus:ring-2 focus:ring-accent/20"
              />
            </div>
            <div className="sm:col-span-2">
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-border rounded-button focus:outline-none focus:ring-2 focus:ring-accent/20"
              />
            </div>
            <div className="sm:col-span-2">
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-border rounded-button focus:outline-none focus:ring-2 focus:ring-accent/20 bg-surface"
              >
                {STATUS_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-1">
              <select
                value={agent}
                onChange={(e) => setAgent(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-border rounded-button focus:outline-none focus:ring-2 focus:ring-accent/20 bg-surface"
              >
                <option value="">Any agent</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </Card>

        <Card padding={false}>
          <div className="flex items-center justify-between px-6 py-3 border-b border-border">
            <h3 className="font-semibold text-sm">
              {q.trim() ? `${total} match${total === 1 ? "" : "es"}` : "Type a query to search"}
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-background">
                  <th className="text-left px-6 py-3 font-medium text-text-secondary">
                    Started
                  </th>
                  <th className="text-left px-6 py-3 font-medium text-text-secondary">
                    Customer
                  </th>
                  <th className="text-left px-6 py-3 font-medium text-text-secondary">
                    Snippet
                  </th>
                  <th className="text-left px-6 py-3 font-medium text-text-secondary">
                    Status
                  </th>
                  <th className="text-left px-6 py-3 font-medium text-text-secondary">
                    Msgs
                  </th>
                  <th className="text-left px-6 py-3 font-medium text-text-secondary">
                    AI %
                  </th>
                  <th className="text-left px-6 py-3 font-medium text-text-secondary">
                    Agent
                  </th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-6 py-8 text-center text-text-secondary"
                    >
                      Searching…
                    </td>
                  </tr>
                ) : results.length === 0 ? (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-6 py-8 text-center text-text-secondary"
                    >
                      {q.trim() ? "No results" : "Search results appear here"}
                    </td>
                  </tr>
                ) : (
                  results.map((row) => (
                    <tr
                      key={row.id}
                      onClick={() => setOpenId(row.id)}
                      data-testid="search-result-row"
                      className="border-b border-border hover:bg-background/50 transition-colors cursor-pointer"
                    >
                      <td className="px-6 py-3 text-text-secondary whitespace-nowrap">
                        {formatDate(row.started_at)}
                      </td>
                      <td className="px-6 py-3 truncate max-w-[180px]">
                        {row.customer_email || row.customer_identifier}
                      </td>
                      <td
                        className="px-6 py-3 text-text-primary"
                        data-testid="search-result-snippet"
                      >
                        {renderSnippet(row.snippet)}
                      </td>
                      <td className="px-6 py-3">
                        <Badge variant={statusVariant(row.status)} dot>
                          {row.status.replace("_", " ")}
                        </Badge>
                      </td>
                      <td className="px-6 py-3">{row.message_count}</td>
                      <td className="px-6 py-3">
                        <span
                          className={
                            row.ai_percent > 50
                              ? "text-ai-badge font-medium"
                              : "text-text-secondary"
                          }
                        >
                          {row.ai_percent}%
                        </span>
                      </td>
                      <td className="px-6 py-3 text-text-secondary">
                        {row.agent_name ?? "—"}
                      </td>
                    </tr>
                  ))
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
                  aria-label="Previous page"
                >
                  <ChevronLeft size={14} />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                  aria-label="Next page"
                >
                  <ChevronRight size={14} />
                </Button>
              </div>
            </div>
          )}
        </Card>
      </div>

      {openId && (
        <TranscriptModal
          sessionId={openId}
          title="Transcript"
          onClose={() => setOpenId(null)}
        />
      )}
    </>
  );
}
