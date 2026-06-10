"use client";

import { useEffect, useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import { AlertTriangle, X } from "lucide-react";
import { ALERTS_CHANNEL } from "@/lib/pusher/channels";

interface AlertEvent {
  id: string;
  kind: string;
  value: string | number;
  message: string;
  firedAt: string;
}

const FRIENDLY: Record<string, string> = {
  queue_depth: "Queue depth",
  ai_failure_rate_pct: "AI failure rate",
  no_agents_online_during_hours: "No agents online",
  ticket_sla_breach: "Ticket SLA breach",
};

/**
 * Manager-only banner pinned to the top of /dashboard. Polls
 * /api/admin/alert-events?status=unacked on mount + listens to the
 * "alerts" Pusher channel for live updates. Hidden for agents and when
 * there are no unacked alerts.
 */
export default function AlertsBanner() {
  const { data: session } = useSession();
  const isManager = session?.user?.role === "store_manager";
  const [events, setEvents] = useState<AlertEvent[]>([]);

  const fetchEvents = useCallback(async () => {
    if (!isManager) return;
    try {
      const res = await fetch("/api/admin/alert-events?status=unacked", {
        cache: "no-store",
      });
      if (!res.ok) return;
      const data = await res.json();
      setEvents(data.events ?? []);
    } catch {
      // non-fatal
    }
  }, [isManager]);

  useEffect(() => {
    void fetchEvents();
    if (!isManager) return;
    let cleanup = () => {};
    import("@/lib/pusher/client")
      .then(({ acquireChannel, releaseChannel }) => {
        const channel = acquireChannel(ALERTS_CHANNEL);
        const onAlertFired = () => void fetchEvents();
        channel.bind("alert-fired", onAlertFired);
        cleanup = () => {
          channel.unbind("alert-fired", onAlertFired);
          releaseChannel(ALERTS_CHANNEL);
        };
      })
      .catch(() => {});
    return () => cleanup();
  }, [fetchEvents, isManager]);

  const handleAck = async (id: string) => {
    try {
      await fetch(`/api/admin/alert-events/${id}/ack`, { method: "POST" });
      setEvents((prev) => prev.filter((e) => e.id !== id));
    } catch {
      // non-fatal
    }
  };

  if (!isManager || events.length === 0) return null;

  return (
    <div
      className="bg-error/10 border-b border-error/30 px-6 py-2.5"
      data-testid="alerts-banner"
    >
      <ul className="space-y-1.5">
        {events.map((e) => (
          <li
            key={e.id}
            className="flex items-center justify-between gap-3 text-sm"
          >
            <div className="flex items-center gap-2 min-w-0">
              <AlertTriangle size={14} className="text-error shrink-0" />
              <span className="font-medium text-error">
                {FRIENDLY[e.kind] ?? e.kind}
              </span>
              <span className="text-text-secondary truncate">{e.message}</span>
            </div>
            <button
              onClick={() => handleAck(e.id)}
              className="text-error hover:text-error/80 shrink-0"
              aria-label="Dismiss alert"
              title="Dismiss"
            >
              <X size={14} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
