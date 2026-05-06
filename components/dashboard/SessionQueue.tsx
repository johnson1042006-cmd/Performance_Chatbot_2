"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import SessionCard from "./SessionCard";
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
}

interface SessionQueueProps {
  activeSessionId: string | null;
  onSelectSession: (sessionId: string) => void;
  onClaimSession: (sessionId: string) => void;
  onUnclaimedCountChange?: (count: number) => void;
  refetchKey?: number;
}

export default function SessionQueue({
  activeSessionId,
  onSelectSession,
  onClaimSession,
  onUnclaimedCountChange,
  refetchKey,
}: SessionQueueProps) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const pollRef = useRef<NodeJS.Timeout | null>(null);

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

  // Pusher real-time updates
  useEffect(() => {
    let cleanup = () => {};
    import("@/lib/pusher/client").then(({ getPusherClient }) => {
      const pusher = getPusherClient();
      const channel = pusher.subscribe("dashboard");

      channel.bind("session-update", () => fetchSessions());
      channel.bind("session-claimed", () => fetchSessions());
      channel.bind("session-released", () => fetchSessions());
      channel.bind("session-closed", () => fetchSessions());

      cleanup = () => {
        channel.unbind_all();
        pusher.unsubscribe("dashboard");
      };
    }).catch(() => {});
    return () => cleanup();
  }, [fetchSessions]);

  // Polling fallback — refresh every 5 seconds
  useEffect(() => {
    pollRef.current = setInterval(fetchSessions, 5000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [fetchSessions]);

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

  const unclaimed = sessions.filter((s) => s.status === "waiting");
  const claimed = sessions.filter((s) => s.status !== "waiting");

  if (sessions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
        <div className="w-12 h-12 bg-background rounded-full flex items-center justify-center mb-3">
          <MessageSquare size={20} className="text-text-secondary" />
        </div>
        <p className="text-sm font-medium text-text-primary mb-1">
          No active chats
        </p>
        <p className="text-xs text-text-secondary">
          New chats will appear here in real time
        </p>
      </div>
    );
  }

  return (
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
              onSelect={onSelectSession}
              onClaim={onClaimSession}
            />
          ))}
        </>
      )}
    </div>
  );
}
