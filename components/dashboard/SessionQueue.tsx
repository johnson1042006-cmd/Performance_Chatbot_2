"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useSession } from "next-auth/react";
import SessionCard from "./SessionCard";
import { DASHBOARD_CHANNEL } from "@/lib/pusher/channels";
import { Skeleton } from "@/components/ui/Skeleton";
import { MessageSquare } from "lucide-react";

interface Session {
  id: string;
  customerIdentifier: string;
  pageContext: Record<string, unknown> | null;
  startedAt: string;
  status: string;
  claimedByUserId: string | null;
  claimedByKind?: string | null;
  claimedBy?: { id: string; name: string } | null;
  waitSeconds?: number;
  lastCustomerActivityAt?: string | null;
  customerCity?: string | null;
  customerRegion?: string | null;
  customerCountry?: string | null;
  pendingHuman?: boolean;
}

const FILTERS = [
  { id: "all", label: "All" },
  { id: "mine", label: "Mine" },
  { id: "unclaimed", label: "Unclaimed" },
  { id: "ai", label: "AI handling" },
  { id: "awaiting", label: "Awaiting (>30s)" },
] as const;

type FilterId = (typeof FILTERS)[number]["id"];

interface SessionQueueProps {
  activeSessionId: string | null;
  selectedQueueId?: string | null;
  onSelectSession: (sessionId: string) => void;
  onClaimSession: (sessionId: string) => void;
  onUnclaimedCountChange?: (count: number) => void;
  /** Reports the visible (filtered) ordered IDs back to the parent so the
   *  agent-hotkeys hook can navigate them. */
  onVisibleIdsChange?: (ids: string[]) => void;
  refetchKey?: number;
}

function loadFilter(userId: string | undefined): FilterId {
  if (!userId || typeof window === "undefined") return "all";
  try {
    const v = localStorage.getItem(`pc-queue-filter:${userId}`);
    if (v && FILTERS.some((f) => f.id === v)) return v as FilterId;
  } catch {
    // ignore
  }
  return "all";
}

function saveFilter(userId: string | undefined, filter: FilterId): void {
  if (!userId || typeof window === "undefined") return;
  try {
    localStorage.setItem(`pc-queue-filter:${userId}`, filter);
  } catch {
    // ignore
  }
}

function applyFilter(
  sessions: Session[],
  filter: FilterId,
  userId: string | undefined
): Session[] {
  if (filter === "all") return sessions;
  const now = Date.now();
  return sessions.filter((s) => {
    switch (filter) {
      case "mine":
        return (
          s.claimedByKind === "human" &&
          !!userId &&
          s.claimedBy?.id === userId
        );
      case "unclaimed":
        return s.status === "waiting" || !s.claimedByKind;
      case "ai":
        return s.claimedByKind === "ai" || s.status === "active_ai";
      case "awaiting": {
        if (s.status === "closed") return false;
        if (!s.lastCustomerActivityAt) return false;
        const elapsed =
          (now - new Date(s.lastCustomerActivityAt).getTime()) / 1000;
        return elapsed > 30;
      }
      default:
        return true;
    }
  });
}

export default function SessionQueue({
  activeSessionId,
  selectedQueueId,
  onSelectSession,
  onClaimSession,
  onUnclaimedCountChange,
  onVisibleIdsChange,
  refetchKey,
}: SessionQueueProps) {
  const { data: authSession } = useSession();
  const userId = authSession?.user?.id;
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterId>("all");
  // Hydrate filter from localStorage once we know the user.
  useEffect(() => {
    if (userId) setFilter(loadFilter(userId));
  }, [userId]);

  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch("/api/sessions");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.sessions) setSessions(data.sessions);
      onUnclaimedCountChange?.(data.unclaimedCount ?? 0);
    } catch (error) {
      console.error("Failed to fetch sessions:", error);
    } finally {
      setLoading(false);
    }
  }, [onUnclaimedCountChange]);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  useEffect(() => {
    if (!refetchKey) return;
    fetchSessions();
  }, [refetchKey, fetchSessions]);

  // The "dashboard" channel is SHARED across the app (Sidebar, AlertsBell,
  // analytics widgets). Cleanup must only unbind this component's own handler
  // references — unbind_all()/unsubscribe() here would silently disconnect
  // every other listener on the channel.
  useEffect(() => {
    let cleanup = () => {};
    import("@/lib/pusher/client").then(({ acquireChannel, releaseChannel }) => {
      const channel = acquireChannel(DASHBOARD_CHANNEL);
      const refetch = () => fetchSessions();
      const events = [
        "session-update",
        "session-claimed",
        "session-released",
        "session-closed",
        // The escalation chime + desktop notification fire globally from
        // Sidebar.tsx (via notifyEscalation) so they work on every page — here
        // we only refresh the queue to avoid a duplicate notification.
        "escalation-requested",
      ];
      for (const event of events) channel.bind(event, refetch);
      cleanup = () => {
        for (const event of events) channel.unbind(event, refetch);
        releaseChannel(DASHBOARD_CHANNEL);
      };
    }).catch(() => {});
    return () => cleanup();
  }, [fetchSessions]);

  const filtered = useMemo(
    () => applyFilter(sessions, filter, userId),
    [sessions, filter, userId]
  );

  // Notify parent of visible ordered IDs for hotkey navigation.
  useEffect(() => {
    onVisibleIdsChange?.(filtered.map((s) => s.id));
  }, [filtered, onVisibleIdsChange]);

  const handleFilterChange = (id: FilterId) => {
    setFilter(id);
    saveFilter(userId, id);
  };

  if (loading) {
    return (
      <div className="p-3 space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-1/2" />
            <Skeleton className="h-6 w-full" />
          </div>
        ))}
      </div>
    );
  }

  const unclaimed = filtered.filter((s) => s.status === "waiting");
  const claimed = filtered.filter((s) => s.status !== "waiting");

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div
        className="shrink-0 px-3 py-2 border-b border-border flex flex-wrap gap-1"
        role="tablist"
        aria-label="Queue filters"
        data-testid="queue-filters"
      >
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            role="tab"
            aria-selected={filter === f.id}
            data-testid={`queue-filter-${f.id}`}
            onClick={() => handleFilterChange(f.id)}
            className={`px-2 py-1 text-[11px] font-medium rounded-full border transition-colors ${
              filter === f.id
                ? "bg-accent-solid text-white border-accent-solid"
                : "bg-surface text-text-secondary border-border hover:bg-background"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
          <div className="w-12 h-12 bg-background rounded-full flex items-center justify-center mb-3">
            <MessageSquare size={20} className="text-text-secondary" />
          </div>
          <p className="text-sm font-medium text-text-primary mb-1">
            {sessions.length === 0 ? "No active chats" : "No chats match filter"}
          </p>
          <p className="text-xs text-text-secondary">
            {sessions.length === 0
              ? "New chats will appear here in real time"
              : "Try a different view above"}
          </p>
        </div>
      ) : (
        <div className="overflow-y-auto flex-1">
          {unclaimed.length > 0 && (
            <>
              <div className="px-3 py-1.5 bg-amber-50 border-b border-amber-100">
                <span className="text-xs font-semibold text-amber-700 uppercase tracking-wide">
                  In Queue ({unclaimed.length})
                </span>
              </div>
              {unclaimed.map((session) => (
                <SessionCard
                  key={session.id}
                  session={session}
                  isActive={session.id === activeSessionId}
                  isKeyboardSelected={session.id === selectedQueueId}
                  onSelect={onSelectSession}
                  onClaim={onClaimSession}
                />
              ))}
            </>
          )}
          {claimed.length > 0 && (
            <>
              <div className="px-3 py-1.5 bg-background border-b border-border">
                <span className="text-xs font-semibold text-text-secondary uppercase tracking-wide">
                  Active ({claimed.length})
                </span>
              </div>
              {claimed.map((session) => (
                <SessionCard
                  key={session.id}
                  session={session}
                  isActive={session.id === activeSessionId}
                  isKeyboardSelected={session.id === selectedQueueId}
                  onSelect={onSelectSession}
                  onClaim={onClaimSession}
                />
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
