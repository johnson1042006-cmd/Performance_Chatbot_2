"use client";

import { useState, useCallback } from "react";
import TopBar from "@/components/ui/TopBar";
import Badge from "@/components/ui/Badge";
import SessionQueue from "@/components/dashboard/SessionQueue";
import ChatPanel from "@/components/dashboard/ChatPanel";
import EmptyState from "@/components/dashboard/EmptyState";
import { MessageSquare } from "lucide-react";

interface SessionData {
  id: string;
  status: string;
  pageContext: Record<string, unknown> | null;
}

export default function LiveChatsPage() {
  const [activeSession, setActiveSession] = useState<SessionData | null>(null);

  const handleSelectSession = useCallback(async (sessionId: string) => {
    try {
      const res = await fetch(`/api/sessions/${sessionId}`);
      const data = await res.json();
      if (data.session) setActiveSession(data.session);
    } catch (error) {
      console.error("Failed to load session:", error);
    }
  }, []);

  const handleClaimSession = useCallback(async (sessionId: string) => {
    try {
      const res = await fetch("/api/sessions/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
      const data = await res.json();
      if (data.session) setActiveSession(data.session);
    } catch (error) {
      console.error("Failed to claim:", error);
    }
  }, []);

  const handleReleaseSession = useCallback(async (sessionId: string) => {
    try {
      await fetch("/api/sessions/release", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
      setActiveSession((prev) =>
        prev?.id === sessionId ? { ...prev, status: "active_ai" } : prev
      );
    } catch (error) {
      console.error("Failed to release:", error);
    }
  }, []);

  const handleCloseSession = useCallback(async (sessionId: string) => {
    try {
      await fetch("/api/sessions/close", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
      setActiveSession(null);
    } catch (error) {
      console.error("Failed to close:", error);
    }
  }, []);

  return (
    <>
      <TopBar title="Live Chats">
        <Badge variant="success" dot>
          Online
        </Badge>
      </TopBar>
      <div className="flex-1 flex overflow-hidden">
        <div className="w-[360px] border-r border-border bg-surface shrink-0 flex flex-col">
          <div className="px-4 py-3 border-b border-border">
            <h2 className="text-sm font-semibold text-text-primary">Chat Queue</h2>
          </div>
          <SessionQueue
            activeSessionId={activeSession?.id || null}
            onSelectSession={handleSelectSession}
            onClaimSession={handleClaimSession}
          />
        </div>
        <div className="flex-1 bg-surface">
          {activeSession ? (
            <ChatPanel
              sessionId={activeSession.id}
              sessionStatus={activeSession.status}
              pageContext={activeSession.pageContext}
              onRelease={handleReleaseSession}
              onClaim={handleClaimSession}
              onClose={handleCloseSession}
            />
          ) : (
            <EmptyState
              icon={MessageSquare}
              title="Select a conversation"
              description="Choose a chat from the queue to view and respond."
            />
          )}
        </div>
      </div>
    </>
  );
}
