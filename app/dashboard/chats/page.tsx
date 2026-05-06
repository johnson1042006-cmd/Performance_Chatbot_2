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
  claimedByKind?: string | null;
  claimedBy?: { id: string; name: string } | null;
  pageContext: Record<string, unknown> | null;
}

export default function LiveChatsPage() {
  const [activeSession, setActiveSession] = useState<SessionData | null>(null);
  const [unclaimedCount, setUnclaimedCount] = useState(0);

  const handleSelectSession = useCallback(async (sessionId: string) => {
    try {
      const res = await fetch(`/api/sessions/${sessionId}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
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
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.session) setActiveSession(data.session);
    } catch (error) {
      console.error("Failed to claim:", error);
    }
  }, []);

  const handleReleaseSession = useCallback(async (sessionId: string) => {
    try {
      const res = await fetch("/api/sessions/release", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.session) setActiveSession(data.session);
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

  const handleSessionUpdate = useCallback(async () => {
    if (!activeSession) return;
    try {
      const res = await fetch(`/api/sessions/${activeSession.id}`);
      if (!res.ok) return;
      const data = await res.json();
      if (data.session) setActiveSession(data.session);
    } catch {
      // non-fatal
    }
  }, [activeSession]);

  return (
    <>
      <TopBar title="Live Chats">
        <Badge variant="success" dot>
          Online
        </Badge>
        {unclaimedCount > 0 && (
          <Badge variant="warning">
            {unclaimedCount} queued
          </Badge>
        )}
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
            onUnclaimedCountChange={setUnclaimedCount}
          />
        </div>
        <div className="flex-1 bg-surface">
          {activeSession ? (
            <ChatPanel
              sessionId={activeSession.id}
              sessionStatus={activeSession.status}
              sessionClaimedByKind={activeSession.claimedByKind}
              sessionClaimedBy={activeSession.claimedBy}
              pageContext={activeSession.pageContext}
              onRelease={handleReleaseSession}
              onClaim={handleClaimSession}
              onClose={handleCloseSession}
              onSessionUpdate={handleSessionUpdate}
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
