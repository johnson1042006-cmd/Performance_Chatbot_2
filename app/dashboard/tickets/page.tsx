"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import TopBar from "@/components/ui/TopBar";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import { Ticket, Loader2 } from "lucide-react";
import TicketSlaPill from "@/components/dashboard/tickets/TicketSlaPill";
import TicketDetailModal from "@/components/dashboard/tickets/TicketDetailModal";
import { useSearchParams, useRouter } from "next/navigation";

interface TicketRow {
  id: string;
  ticketNumber: number;
  sessionId: string | null;
  subject: string;
  status: "open" | "pending" | "resolved" | "closed";
  priority: "urgent" | "high" | "normal" | "low";
  category: string | null;
  source: string;
  customerEmail: string | null;
  customerName: string | null;
  assignedTo: string | null;
  assignedToName: string | null;
  dueAt: string | null;
  slaBreached: boolean;
  createdAt: string;
}

const STATUSES = ["open", "pending", "resolved", "closed"] as const;
const PRIORITIES = ["urgent", "high", "normal", "low"] as const;

const STATUS_VARIANT: Record<
  TicketRow["status"],
  "info" | "warning" | "success" | "default"
> = {
  open: "info",
  pending: "warning",
  resolved: "success",
  closed: "default",
};

const PRIORITY_VARIANT: Record<
  TicketRow["priority"],
  "danger" | "warning" | "info" | "default"
> = {
  urgent: "danger",
  high: "warning",
  normal: "info",
  low: "default",
};

function ageHours(createdAt: string): string {
  const ms = Date.now() - new Date(createdAt).getTime();
  const hours = Math.floor(ms / (60 * 60 * 1000));
  if (hours < 1) {
    const minutes = Math.max(0, Math.floor(ms / 60_000));
    return `${minutes}m`;
  }
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

export default function TicketsPage() {
  const router = useRouter();
  const params = useSearchParams();
  const [rows, setRows] = useState<TicketRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>(
    params.get("status") ?? "open,pending"
  );
  const [priorityFilter, setPriorityFilter] = useState<string>(
    params.get("priority") ?? ""
  );
  const [openTicketId, setOpenTicketId] = useState<string | null>(
    params.get("ticketId")
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const sp = new URLSearchParams();
      if (statusFilter) sp.set("status", statusFilter);
      if (priorityFilter) sp.set("priority", priorityFilter);
      const res = await fetch(`/api/tickets?${sp.toString()}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRows(data.tickets ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load tickets");
    } finally {
      setLoading(false);
    }
  }, [statusFilter, priorityFilter]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Live updates from the alerts channel.
  useEffect(() => {
    let cleanup = () => {};
    import("@/lib/pusher/client")
      .then(({ getPusherClient }) => {
        const pusher = getPusherClient();
        const channel = pusher.subscribe("alerts");
        const handler = () => void refresh();
        channel.bind("ticket-created", handler);
        channel.bind("ticket-status-changed", handler);
        channel.bind("ticket-resolved", handler);
        channel.bind("ticket-sla-breached", handler);
        cleanup = () => {
          channel.unbind_all();
          pusher.unsubscribe("alerts");
        };
      })
      .catch(() => {});
    return () => cleanup();
  }, [refresh]);

  const visibleRows = useMemo(() => rows, [rows]);

  const handleOpen = (id: string) => {
    setOpenTicketId(id);
    const sp = new URLSearchParams(params.toString());
    sp.set("ticketId", id);
    router.replace(`/dashboard/tickets?${sp.toString()}`);
  };

  const handleCloseModal = () => {
    setOpenTicketId(null);
    const sp = new URLSearchParams(params.toString());
    sp.delete("ticketId");
    const qs = sp.toString();
    router.replace(qs ? `/dashboard/tickets?${qs}` : "/dashboard/tickets");
    void refresh();
  };

  return (
    <>
      <TopBar title="Tickets" />
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        <Card>
          <div className="flex items-center gap-3 flex-wrap">
            <Ticket size={16} className="text-text-secondary" />
            <span className="text-sm text-text-secondary">Filters:</span>
            <Filter
              label="Status"
              value={statusFilter}
              onChange={setStatusFilter}
              options={[
                { value: "", label: "Any" },
                { value: "open,pending", label: "Active (open + pending)" },
                ...STATUSES.map((s) => ({ value: s, label: s })),
              ]}
            />
            <Filter
              label="Priority"
              value={priorityFilter}
              onChange={setPriorityFilter}
              options={[
                { value: "", label: "Any" },
                ...PRIORITIES.map((p) => ({ value: p, label: p })),
              ]}
            />
          </div>
        </Card>

        <Card padding={false}>
          {loading ? (
            <div className="px-5 py-10 text-center text-sm text-text-secondary">
              <Loader2 size={16} className="inline animate-spin mr-2" />
              Loading tickets…
            </div>
          ) : error ? (
            <div className="px-5 py-6 text-sm text-red-700">{error}</div>
          ) : visibleRows.length === 0 ? (
            <div className="px-5 py-10 text-center text-sm text-text-secondary">
              No tickets match the current filters.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-background">
                    <th className="text-left px-4 py-2 font-medium text-text-secondary">
                      #
                    </th>
                    <th className="text-left px-4 py-2 font-medium text-text-secondary">
                      Subject
                    </th>
                    <th className="text-left px-4 py-2 font-medium text-text-secondary">
                      Status
                    </th>
                    <th className="text-left px-4 py-2 font-medium text-text-secondary">
                      Priority
                    </th>
                    <th className="text-left px-4 py-2 font-medium text-text-secondary">
                      Assignee
                    </th>
                    <th className="text-left px-4 py-2 font-medium text-text-secondary">
                      Category
                    </th>
                    <th className="text-left px-4 py-2 font-medium text-text-secondary">
                      Age
                    </th>
                    <th className="text-left px-4 py-2 font-medium text-text-secondary">
                      SLA
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((t) => (
                    <tr
                      key={t.id}
                      className="border-b border-border last:border-b-0 cursor-pointer hover:bg-background"
                      onClick={() => handleOpen(t.id)}
                      data-testid="ticket-row"
                      data-ticket-id={t.id}
                      data-priority={t.priority}
                    >
                      <td className="px-4 py-2 font-mono text-xs text-text-secondary">
                        #{t.ticketNumber}
                      </td>
                      <td className="px-4 py-2">
                        <div className="font-medium text-text-primary truncate max-w-md">
                          {t.subject}
                        </div>
                        <div className="text-xs text-text-secondary truncate max-w-md">
                          {t.customerName ||
                            t.customerEmail ||
                            "(no customer)"}
                        </div>
                      </td>
                      <td className="px-4 py-2">
                        <Badge variant={STATUS_VARIANT[t.status]}>
                          {t.status}
                        </Badge>
                      </td>
                      <td className="px-4 py-2">
                        <Badge variant={PRIORITY_VARIANT[t.priority]}>
                          {t.priority}
                        </Badge>
                      </td>
                      <td className="px-4 py-2 text-text-primary text-xs">
                        {t.assignedToName ?? (
                          <span className="text-text-secondary">
                            Unassigned
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-xs text-text-primary">
                        {t.category ?? "—"}
                      </td>
                      <td className="px-4 py-2 text-xs text-text-secondary">
                        {ageHours(t.createdAt)}
                      </td>
                      <td className="px-4 py-2">
                        <TicketSlaPill
                          dueAt={t.dueAt}
                          breached={t.slaBreached}
                          freeze={
                            t.status === "resolved" || t.status === "closed"
                          }
                          compact
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      {openTicketId && (
        <TicketDetailModal
          ticketId={openTicketId}
          onClose={handleCloseModal}
          onUpdated={() => void refresh()}
        />
      )}
    </>
  );
}

function Filter({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="flex items-center gap-1.5 text-xs">
      <span className="text-text-secondary">{label}:</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="text-xs border border-border rounded px-2 py-1 bg-surface"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
