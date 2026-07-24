"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useStaffUser } from "@/components/providers/StaffSessionProvider";
import TopBar from "@/components/ui/TopBar";
import Badge from "@/components/ui/Badge";
import SessionQueue from "@/components/dashboard/SessionQueue";
import ChatPanel from "@/components/dashboard/ChatPanel";
import EmptyState from "@/components/dashboard/EmptyState";
import ChatTabStrip, {
  type PinnedChatTab,
} from "@/components/dashboard/ChatTabStrip";
import { useToast } from "@/components/ui/Toast";
import { useAgentHotkeys } from "@/lib/hotkeys/useAgentHotkeys";
import { MessageSquare } from "lucide-react";

interface SessionData {
  id: string;
  status: string;
  claimedByKind?: string | null;
  claimedBy?: { id: string; name: string } | null;
  pageContext: Record<string, unknown> | null;
  customerIdentifier: string;
  customerCity?: string | null;
  customerRegion?: string | null;
  customerCountry?: string | null;
  lastCustomerActivityAt?: string | null;
}

const MAX_PINNED = 6;

export default function LiveChatsPage() {
  const authSession = useStaffUser();
  const { addToast } = useToast();
  const [pinnedTabs, setPinnedTabs] = useState<SessionData[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [unclaimedCount, setUnclaimedCount] = useState(0);
  const [queueRefetchKey, setQueueRefetchKey] = useState(0);
  const [visibleQueueIds, setVisibleQueueIds] = useState<string[]>([]);
  const [selectedQueueId, setSelectedQueueId] = useState<string | null>(null);
  const [hotkeysEnabled, setHotkeysEnabled] = useState(true);

  const sendRef = useRef<(() => void) | null>(null);
  const focusReplyRef = useRef<(() => void) | null>(null);

  // Pull settings (hotkeysEnabled) once.
  useEffect(() => {
    fetch("/api/chat/settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data && typeof data.hotkeysEnabled === "boolean") {
          setHotkeysEnabled(data.hotkeysEnabled);
        }
      })
      .catch(() => {});
  }, []);

  const activeSession =
    pinnedTabs.find((t) => t.id === activeSessionId) ?? null;

  const fetchSession = useCallback(
    async (sessionId: string): Promise<SessionData | null> => {
      try {
        const res = await fetch(`/api/sessions/${sessionId}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        return (data.session as SessionData) ?? null;
      } catch (error) {
        console.error("Failed to load session:", error);
        return null;
      }
    },
    []
  );

  // Replace or append a tab in pinnedTabs by id.
  const upsertTab = useCallback((session: SessionData) => {
    setPinnedTabs((prev) => {
      const idx = prev.findIndex((t) => t.id === session.id);
      if (idx >= 0) {
        const copy = prev.slice();
        copy[idx] = session;
        return copy;
      }
      if (prev.length >= MAX_PINNED) {
        return prev;
      }
      return [...prev, session];
    });
  }, []);

  const handleSelectSession = useCallback(
    async (sessionId: string) => {
      const session = await fetchSession(sessionId);
      if (!session) return;
      // Selecting a session does NOT pin it — pinning happens on claim.
      // But if the agent already has it claimed, ensure it's in the strip.
      if (session.claimedByKind === "human" && session.claimedBy?.id === authSession?.user?.id) {
        upsertTab(session);
      }
      setActiveSessionId(session.id);
      // Replace any existing tab data for that id (so SLA stays current).
      setPinnedTabs((prev) =>
        prev.some((t) => t.id === session.id)
          ? prev.map((t) => (t.id === session.id ? session : t))
          : prev
      );
      // For non-pinned sessions, we still want the active to render — keep
      // a virtual entry in pinnedTabs so the ChatPanel can read its data.
      // Do NOT pin (max-cap aware), but pin if we have room and the agent
      // is just inspecting an unclaimed chat. Behavior: only pin on claim.
      if (!pinnedTabs.some((t) => t.id === session.id)) {
        // Provide a non-pinned active session by stashing it in a "preview"
        // slot. We render via activeSession lookup, so we must include it
        // somewhere. To keep it simple, append a transient tab and remove
        // it on de-select. To avoid crowding, only do this when not at cap.
        // (Acceptable trade-off: clicking around the queue will pin.)
        setPinnedTabs((prev) => {
          if (prev.some((t) => t.id === session.id)) return prev;
          if (prev.length >= MAX_PINNED) return prev;
          return [...prev, session];
        });
      }
    },
    [authSession, fetchSession, pinnedTabs, upsertTab]
  );

  const handleClaimSession = useCallback(
    async (sessionId: string) => {
      // Don't allow exceeding pinned cap on a fresh claim.
      const alreadyPinned = pinnedTabs.some((t) => t.id === sessionId);
      if (!alreadyPinned && pinnedTabs.length >= MAX_PINNED) {
        addToast(
          `You already have ${MAX_PINNED} chats. Close one before claiming another.`,
          "warning"
        );
        return;
      }
      try {
        const res = await fetch("/api/sessions/claim", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId }),
        });
        if (res.status === 409) {
          const data = await res.json();
          addToast(
            `Already claimed by ${data.claimedBy?.name ?? "another agent"}`,
            "warning"
          );
          setQueueRefetchKey((n) => n + 1);
          return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (data.session) {
          const session: SessionData = {
            ...data.session,
            claimedBy: authSession?.user
              ? { id: authSession.user.id!, name: authSession.user.name ?? "" }
              : null,
          };
          upsertTab(session);
          setActiveSessionId(session.id);
          setQueueRefetchKey((n) => n + 1);
        }
      } catch (error) {
        console.error("Failed to claim:", error);
        addToast("Failed to claim chat. Please try again.", "error");
      }
    },
    [authSession, addToast, pinnedTabs, upsertTab]
  );

  const handleReleaseSession = useCallback(
    async (sessionId: string) => {
      // Only unpin/clear when the server confirms the release. Otherwise the
      // agent believes they released while the server still has them claimed.
      try {
        const res = await fetch("/api/sessions/release", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      } catch (error) {
        console.error("Failed to release:", error);
        addToast("Failed to release chat. Please try again.", "error");
        return;
      }
      setPinnedTabs((prev) => prev.filter((t) => t.id !== sessionId));
      setActiveSessionId((id) => (id === sessionId ? null : id));
      setQueueRefetchKey((n) => n + 1);
    },
    [addToast]
  );

  const handleCloseSession = useCallback(
    async (sessionId: string) => {
      try {
        const res = await fetch("/api/sessions/close", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      } catch (error) {
        console.error("Failed to close:", error);
        addToast("Failed to close chat. Please try again.", "error");
        return;
      }
      setPinnedTabs((prev) => prev.filter((t) => t.id !== sessionId));
      setActiveSessionId((id) => (id === sessionId ? null : id));
      setQueueRefetchKey((n) => n + 1);
    },
    [addToast]
  );

  const handleSessionUpdate = useCallback(async () => {
    if (!activeSessionId) return;
    const session = await fetchSession(activeSessionId);
    if (session) upsertTab(session);
  }, [activeSessionId, fetchSession, upsertTab]);

  const handleSelectFromTabs = useCallback((id: string) => {
    setActiveSessionId(id);
  }, []);

  const handleCloseTab = useCallback((id: string) => {
    setPinnedTabs((prev) => prev.filter((t) => t.id !== id));
    setActiveSessionId((current) => (current === id ? null : current));
  }, []);

  // Default keyboard selection to the first visible queue id when none set.
  useEffect(() => {
    if (!selectedQueueId && visibleQueueIds.length > 0) {
      setSelectedQueueId(visibleQueueIds[0]);
    } else if (
      selectedQueueId &&
      !visibleQueueIds.includes(selectedQueueId) &&
      visibleQueueIds.length > 0
    ) {
      setSelectedQueueId(visibleQueueIds[0]);
    } else if (visibleQueueIds.length === 0) {
      setSelectedQueueId(null);
    }
  }, [visibleQueueIds, selectedQueueId]);

  useAgentHotkeys({
    enabled: hotkeysEnabled,
    queueIds: visibleQueueIds,
    selectedQueueId,
    activeSessionId,
    setSelectedQueueId,
    onClaim: (id) => handleClaimSession(id),
    onRelease: (id) => handleReleaseSession(id),
    onClose: (id) => handleCloseSession(id),
    onFocusReply: () => focusReplyRef.current?.(),
    onSend: () => sendRef.current?.(),
  });

  const tabsForStrip: PinnedChatTab[] = pinnedTabs.map((t) => ({
    id: t.id,
    customerIdentifier: t.customerIdentifier,
    lastCustomerActivityAt: t.lastCustomerActivityAt ?? null,
  }));

  return (
    <>
      <TopBar title="Live Chats">
        <Badge variant="success" dot>
          Online
        </Badge>
        {unclaimedCount > 0 && (
          <Badge variant="warning">{unclaimedCount} queued</Badge>
        )}
      </TopBar>
      <div className="flex-1 flex overflow-hidden">
        <div className="w-[360px] border-r border-border bg-surface shrink-0 flex flex-col">
          <div className="px-4 py-3 border-b border-border">
            <h2 className="text-sm font-semibold text-text-primary">
              Chat Queue
            </h2>
          </div>
          <SessionQueue
            activeSessionId={activeSessionId}
            selectedQueueId={selectedQueueId}
            onSelectSession={handleSelectSession}
            onClaimSession={handleClaimSession}
            onUnclaimedCountChange={setUnclaimedCount}
            onVisibleIdsChange={setVisibleQueueIds}
            refetchKey={queueRefetchKey}
          />
        </div>
        <div className="flex-1 bg-surface flex flex-col">
          <ChatTabStrip
            tabs={tabsForStrip}
            activeId={activeSessionId}
            onSelect={handleSelectFromTabs}
            onClose={handleCloseTab}
          />
          <div className="flex-1 overflow-hidden">
            {activeSession ? (
              <ChatPanel
                key={activeSession.id}
                sessionId={activeSession.id}
                sessionStatus={activeSession.status}
                sessionClaimedByKind={activeSession.claimedByKind}
                sessionClaimedBy={activeSession.claimedBy}
                pageContext={activeSession.pageContext}
                customerIdentifier={activeSession.customerIdentifier}
                customerCity={activeSession.customerCity}
                customerRegion={activeSession.customerRegion}
                customerCountry={activeSession.customerCountry}
                onRelease={handleReleaseSession}
                onClaim={() => {
                  setPinnedTabs((prev) =>
                    prev.map((t) =>
                      t.id === activeSession.id
                        ? {
                            ...t,
                            status: "active_human",
                            claimedByKind: "human",
                            claimedBy: authSession?.user
                              ? {
                                  id: authSession.user.id!,
                                  name: authSession.user.name ?? "",
                                }
                              : null,
                          }
                        : t
                    )
                  );
                  setQueueRefetchKey((n) => n + 1);
                  void handleSessionUpdate();
                }}
                onClose={handleCloseSession}
                onSessionUpdate={handleSessionUpdate}
                sendRef={sendRef}
                focusReplyRef={focusReplyRef}
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
      </div>
    </>
  );
}
