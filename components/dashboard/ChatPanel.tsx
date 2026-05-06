"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useSession } from "next-auth/react";
import MessageThread from "./MessageThread";
import PageContextBadge from "./PageContextBadge";
import Button from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { Send, UserCheck, X, Users, RotateCcw } from "lucide-react";

interface Message {
  id: string;
  role: "customer" | "agent" | "ai";
  content: string;
  sentAt: string;
  agentName?: string;
}

interface OnlineAgent {
  id: string;
  name: string;
  email: string;
  isOnline: boolean;
}

interface ChatPanelProps {
  sessionId: string;
  sessionStatus: string;
  sessionClaimedByKind?: string | null;
  sessionClaimedBy?: { id: string; name: string } | null;
  pageContext: Record<string, unknown> | null;
  onRelease: (sessionId: string) => void;
  onClaim: (sessionId: string) => void;
  onClose: (sessionId: string) => void;
  onSessionUpdate?: () => void;
}

export default function ChatPanel({
  sessionId,
  sessionStatus,
  sessionClaimedByKind,
  sessionClaimedBy,
  pageContext,
  onRelease,
  onClaim,
  onClose,
  onSessionUpdate,
}: ChatPanelProps) {
  const { data: authSession } = useSession();
  const { addToast } = useToast();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [claimedByBanner, setClaimedByBanner] = useState<string | null>(null);
  const [showReassign, setShowReassign] = useState(false);
  const [onlineAgents, setOnlineAgents] = useState<OnlineAgent[]>([]);
  const [reassigning, setReassigning] = useState(false);
  const pollRef = useRef<NodeJS.Timeout | null>(null);

  const isManager = authSession?.user?.role === "store_manager";
  const isHuman = sessionClaimedByKind === "human" || sessionStatus === "active_human";
  const isAi = sessionClaimedByKind === "ai" || sessionStatus === "active_ai";
  const isUnclaimed = !sessionClaimedByKind && sessionStatus === "waiting";
  const myId = authSession?.user?.id;
  const isMyChat = isHuman && sessionClaimedBy?.id === myId;
  const canRelease = isMyChat || (isManager && isHuman) || (isManager && isAi);

  const fetchMessages = useCallback(async () => {
    try {
      const res = await fetch(`/api/sessions/${sessionId}/messages`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.messages) setMessages(data.messages);
    } catch (error) {
      console.error("Failed to fetch messages:", error);
    }
  }, [sessionId]);

  useEffect(() => {
    fetchMessages();
  }, [fetchMessages]);

  // Pusher real-time subscription
  useEffect(() => {
    let cleanup = () => {};
    import("@/lib/pusher/client").then(({ getPusherClient }) => {
      const pusher = getPusherClient();
      const channel = pusher.subscribe(`session-${sessionId}`);

      channel.bind("new-message", (data: Message) => {
        setMessages((prev) => {
          if (prev.some((m) => m.id === data.id)) return prev;
          return [...prev, data];
        });
      });

      channel.bind(
        "session-claimed",
        (data: { agentId?: string; agentName?: string; kind?: string; reassigned?: boolean }) => {
          // If another agent claimed while we're viewing
          if (data.agentId && data.agentId !== myId) {
            setClaimedByBanner(
              data.reassigned
                ? `This chat was reassigned to ${data.agentName ?? "another agent"}`
                : `This chat was claimed by ${data.agentName ?? "another agent"}`
            );
          }
          onSessionUpdate?.();
        }
      );

      channel.bind("session-released", () => {
        setClaimedByBanner(null);
        onSessionUpdate?.();
      });

      cleanup = () => {
        channel.unbind_all();
        pusher.unsubscribe(`session-${sessionId}`);
      };
    }).catch(() => {});
    return () => cleanup();
  }, [sessionId, myId, onSessionUpdate]);

  // Polling fallback — refresh messages every 3 seconds
  useEffect(() => {
    pollRef.current = setInterval(fetchMessages, 3000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [fetchMessages]);

  const fetchOnlineAgents = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/team-presence");
      if (!res.ok) return;
      const data = await res.json();
      // Show all active agents except current user
      setOnlineAgents(
        (data.agents ?? []).filter(
          (a: OnlineAgent) => a.id !== myId && a.isOnline
        )
      );
    } catch {
      // non-fatal
    }
  }, [myId]);

  useEffect(() => {
    if (showReassign) fetchOnlineAgents();
  }, [showReassign, fetchOnlineAgents]);

  const handleClaim = async () => {
    try {
      const res = await fetch("/api/sessions/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
      if (res.status === 409) {
        const data = await res.json();
        const name = data.claimedBy?.name ?? "another agent";
        addToast(`Already claimed by ${name}`, "warning");
        onSessionUpdate?.();
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      onClaim(sessionId);
    } catch (error) {
      console.error("Claim failed:", error);
      addToast("Failed to claim chat. Please try again.", "error");
    }
  };

  const handleReassign = async (targetUserId: string) => {
    setReassigning(true);
    try {
      const res = await fetch("/api/sessions/reassign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, targetUserId }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setShowReassign(false);
      onSessionUpdate?.();
      addToast("Chat reassigned successfully", "success");
    } catch {
      addToast("Failed to reassign chat", "error");
    } finally {
      setReassigning(false);
    }
  };

  const sendAgentMessage = async () => {
    if (!input.trim() || sending) return;
    const content = input.trim();
    setInput("");
    setSending(true);

    try {
      await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: content,
          sessionId,
          role: "agent",
          agentName: authSession?.user?.name,
        }),
      });
      await fetchMessages();
    } catch (error) {
      console.error("Failed to send:", error);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Claimed-by-other-agent banner */}
      {claimedByBanner && (
        <div className="shrink-0 bg-amber-50 border-b border-amber-200 px-4 py-2 flex items-center justify-between">
          <span className="text-xs font-medium text-amber-700">{claimedByBanner}</span>
          <button
            onClick={() => setClaimedByBanner(null)}
            className="text-amber-500 hover:text-amber-700 ml-3"
          >
            <X size={14} />
          </button>
        </div>
      )}

      <div className="shrink-0 border-b border-border p-3 space-y-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            {isUnclaimed && (
              <Button variant="primary" size="sm" onClick={handleClaim}>
                <UserCheck size={14} className="mr-1.5" />
                Claim Chat
              </Button>
            )}
            {(isAi || (isHuman && !isMyChat && !isManager)) && (
              <Button variant="primary" size="sm" onClick={handleClaim}>
                <UserCheck size={14} className="mr-1.5" />
                Take Over
              </Button>
            )}
            {canRelease && (
              <Button variant="secondary" size="sm" onClick={() => onRelease(sessionId)}>
                <RotateCcw size={14} className="mr-1.5" />
                Return to Queue
              </Button>
            )}
            {isManager && (isHuman || isAi) && (
              <div className="relative">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowReassign((v) => !v)}
                >
                  <Users size={14} className="mr-1.5" />
                  Reassign
                </Button>
                {showReassign && (
                  <div className="absolute top-full left-0 mt-1 w-56 bg-white border border-border rounded-button shadow-card-md z-20">
                    <div className="px-3 py-2 border-b border-border">
                      <p className="text-xs font-medium text-text-secondary">
                        Assign to online agent
                      </p>
                    </div>
                    {onlineAgents.length === 0 ? (
                      <p className="px-3 py-3 text-xs text-text-secondary">
                        No agents online
                      </p>
                    ) : (
                      onlineAgents.map((agent) => (
                        <button
                          key={agent.id}
                          disabled={reassigning}
                          onClick={() => handleReassign(agent.id)}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-background transition-colors"
                        >
                          <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block mr-2" />
                          {agent.name}
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
          <Button variant="ghost" size="sm" onClick={() => onClose(sessionId)}>
            <X size={14} className="mr-1" />
            Close
          </Button>
        </div>
        {sessionClaimedBy && isHuman && (
          <p className="text-xs text-text-secondary">
            Claimed by <span className="font-medium">{sessionClaimedBy.name}</span>
          </p>
        )}
        <PageContextBadge
          pageContext={pageContext as Parameters<typeof PageContextBadge>[0]["pageContext"]}
        />
      </div>

      <MessageThread messages={messages} />

      {isMyChat && (
        <div className="shrink-0 border-t border-border bg-surface px-4 py-3">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) =>
                e.key === "Enter" && !e.shiftKey && sendAgentMessage()
              }
              placeholder="Type a response..."
              className="flex-1 px-3.5 py-2.5 text-sm border border-border rounded-button focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent"
            />
            <Button
              onClick={sendAgentMessage}
              disabled={!input.trim() || sending}
            >
              <Send size={14} />
            </Button>
          </div>
        </div>
      )}

      {isAi && !isMyChat && (
        <div className="shrink-0 border-t border-border bg-purple-50 px-4 py-3 text-center">
          <p className="text-xs text-purple-700">
            AI is handling this conversation. Click &quot;Take Over&quot; to respond as a human.
          </p>
        </div>
      )}

      {isHuman && !isMyChat && (
        <div className="shrink-0 border-t border-border bg-blue-50 px-4 py-3 text-center">
          <p className="text-xs text-blue-700">
            This chat is assigned to{" "}
            <span className="font-medium">{sessionClaimedBy?.name ?? "an agent"}</span>.
            {isManager && " Use Reassign to transfer it."}
          </p>
        </div>
      )}

      {isUnclaimed && (
        <div className="shrink-0 border-t border-border bg-amber-50 px-4 py-3 text-center">
          <p className="text-xs text-amber-700">
            This chat is waiting in the queue. Claim it to start responding.
          </p>
        </div>
      )}
    </div>
  );
}
