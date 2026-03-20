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
}

interface SessionQueueProps {
  activeSessionId: string | null;
  onSelectSession: (sessionId: string) => void;
  onClaimSession: (sessionId: string) => void;
}

export default function SessionQueue({
  activeSessionId,
  onSelectSession,
  onClaimSession,
}: SessionQueueProps) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const pollRef = useRef<NodeJS.Timeout | null>(null);

  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch("/api/sessions");
      const data = await res.json();
      if (data.sessions) setSessions(data.sessions);
    } catch (error) {
      console.error("Failed to fetch sessions:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

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
    }).catch(() => {
      // Pusher unavailable — handled by polling below
    });
    return () => cleanup();
  }, [fetchSessions]);

  // Polling fallback — refresh session list every 5 seconds
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
    <div className="overflow-y-auto">
      {sessions.map((session) => (
        <SessionCard
          key={session.id}
          session={session}
          isActive={session.id === activeSessionId}
          onSelect={onSelectSession}
          onClaim={onClaimSession}
        />
      ))}
    </div>
  );
}
