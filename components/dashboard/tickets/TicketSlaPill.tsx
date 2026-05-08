"use client";

import { useEffect, useState } from "react";
import { Clock, AlertTriangle } from "lucide-react";
import { slaColorClass, type SlaTier } from "@/lib/utils/sla";

interface TicketSlaPillProps {
  /** ISO string for the ticket's `due_at`. Null means no SLA configured. */
  dueAt: string | Date | null | undefined;
  /** When true, render the breached visual regardless of remaining time. */
  breached?: boolean;
  /** When true, don't tick the timer (useful for resolved/closed tickets). */
  freeze?: boolean;
  compact?: boolean;
}

/**
 * Countdown variant of [SlaPill]. Reuses the same `slaColorClass` palette
 * as the agent-side pill so the entire dashboard speaks the same color
 * language. Semantics:
 *   green  > 1 hour remaining
 *   amber  ≤ 1 hour remaining
 *   red    breached (or `breached` prop)
 */
export default function TicketSlaPill({
  dueAt,
  breached = false,
  freeze = false,
  compact = false,
}: TicketSlaPillProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (freeze) return;
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [freeze]);

  if (!dueAt) {
    return (
      <span
        className={`inline-flex items-center gap-1 rounded-full border bg-gray-100 text-gray-600 border-gray-200 ${
          compact ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-xs"
        }`}
      >
        <Clock size={compact ? 9 : 11} className="shrink-0" />
        no sla
      </span>
    );
  }

  const due =
    dueAt instanceof Date ? dueAt.getTime() : new Date(dueAt).getTime();
  const remainingMs = due - now;
  const tier: SlaTier = breached || remainingMs < 0 ? "red" : remainingMs <= 60 * 60 * 1000 ? "amber" : "green";
  const label = remainingMs < 0
    ? `${formatDuration(Math.abs(remainingMs))} past due`
    : `${formatDuration(remainingMs)} left`;
  const isBreached = breached || remainingMs < 0;

  return (
    <span
      role="status"
      data-testid="ticket-sla-pill"
      data-sla-tier={tier}
      data-breached={isBreached ? "true" : "false"}
      className={`inline-flex items-center gap-1 rounded-full border ${slaColorClass(
        tier
      )} ${compact ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-xs"}`}
    >
      {isBreached ? (
        <AlertTriangle size={compact ? 9 : 11} className="shrink-0" />
      ) : (
        <Clock size={compact ? 9 : 11} className="shrink-0" />
      )}
      {label}
    </span>
  );
}

function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) {
    const remM = minutes % 60;
    return remM > 0 ? `${hours}h ${remM}m` : `${hours}h`;
  }
  const days = Math.floor(hours / 24);
  return `${days}d`;
}
