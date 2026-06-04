"use client";

import { useEffect, useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import { Bell, X } from "lucide-react";
import { FRIENDLY } from "./alertFriendlyNames";
import { notifyEscalation } from "./notifyEscalation";

interface AlertEvent {
  id: string;
  kind: string;
  value: string | number;
  message: string;
  firedAt: string;
}


/**
 * Manager-only bell icon that sits in the Sidebar bottom panel. Shows the
 * unacked alert count and a popover listing the last 10 events. Updates
 * via 30s polling and the "alerts" Pusher channel.
 */
export default function AlertsBell() {
  const { data: session } = useSession();
  const isManager = session?.user?.role === "store_manager";
  const [events, setEvents] = useState<AlertEvent[]>([]);
  const [open, setOpen] = useState(false);

  const fetchEvents = useCallback(async () => {
    if (!isManager) return;
    try {
      const res = await fetch(
        "/api/admin/alert-events?status=unacked&limit=10",
        { cache: "no-store" }
      );
      if (!res.ok) return;
      const data = await res.json();
      setEvents(data.events ?? []);
    } catch {
      // non-fatal
    }
  }, [isManager]);

  useEffect(() => {
    if (!isManager) return;
    void fetchEvents();
    const id = setInterval(fetchEvents, 30_000);
    let cleanup = () => {};
    import("@/lib/pusher/client")
      .then(({ getPusherClient }) => {
        const pusher = getPusherClient();
        const channel = pusher.subscribe("alerts");
        channel.bind("alert-fired", () => void fetchEvents());
        cleanup = () => {
          channel.unbind_all();
          pusher.unsubscribe("alerts");
        };
      })
      .catch(() => {});
    return () => {
      clearInterval(id);
      cleanup();
    };
  }, [fetchEvents, isManager]);

  if (!isManager) return null;

  const handleAck = async (id: string) => {
    try {
      await fetch(`/api/admin/alert-events/${id}/ack`, { method: "POST" });
      setEvents((prev) => prev.filter((e) => e.id !== id));
    } catch {
      // non-fatal
    }
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative text-white/60 hover:text-white transition-colors"
        aria-label="Alerts"
        data-testid="alerts-bell"
      >
        <Bell size={16} />
        {events.length > 0 && (
          <span className="absolute -top-1 -right-1 bg-error text-white text-[10px] font-bold rounded-full px-1 min-w-[14px] h-[14px] flex items-center justify-center">
            {events.length}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute bottom-full mb-2 left-0 w-72 max-w-[calc(100vw-5rem)] max-h-72 overflow-y-auto bg-surface text-text-primary rounded-card shadow-card-md border border-border z-50">
          <div className="flex items-center justify-between px-3 py-2 border-b border-border">
            <span className="text-xs font-semibold">Alerts</span>
            <button
              onClick={() => setOpen(false)}
              aria-label="Close"
              className="text-text-secondary hover:text-text-primary"
            >
              <X size={12} />
            </button>
          </div>
          <div className="px-3 py-2 border-b border-border">
            <button
              onClick={() =>
                notifyEscalation({
                  sessionId: `test-${crypto.randomUUID()}`,
                  reason: "explicit_request",
                  urgency: "normal",
                })
              }
              title="Test notification & chime"
              className="w-full text-left text-xs font-medium text-accent-solid hover:underline"
            >
              Test escalation chime
            </button>
          </div>
          {events.length === 0 ? (
            <p className="px-3 py-3 text-xs text-text-secondary">
              No active alerts.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {events.map((e) => (
                <li key={e.id} className="px-3 py-2 flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-error">
                      {FRIENDLY[e.kind] ?? e.kind}
                    </p>
                    <p className="text-xs text-text-secondary line-clamp-2">
                      {e.message}
                    </p>
                    <p className="text-[10px] text-text-secondary/80 mt-0.5">
                      {new Date(e.firedAt).toLocaleString()}
                    </p>
                  </div>
                  <button
                    onClick={() => handleAck(e.id)}
                    className="text-text-secondary hover:text-text-primary"
                    aria-label="Dismiss"
                  >
                    <X size={12} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
