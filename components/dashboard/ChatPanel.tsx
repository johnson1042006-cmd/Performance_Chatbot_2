"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useSession } from "next-auth/react";
import MessageThread from "./MessageThread";
import PageContextBadge from "./PageContextBadge";
import AITrace from "./AITrace";
import NotesPanel from "./NotesPanel";
import HistoryPanel from "./HistoryPanel";
import LocationBadge from "./LocationBadge";
import CannedReplyPopover from "./CannedReplyPopover";
import Button from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import {
  Send,
  UserCheck,
  X,
  Users,
  RotateCcw,
  Sparkles,
  Ticket as TicketIcon,
} from "lucide-react";
import TicketDetailModal from "@/components/dashboard/tickets/TicketDetailModal";

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
  customerIdentifier?: string;
  customerCity?: string | null;
  customerRegion?: string | null;
  customerCountry?: string | null;
  onRelease: (sessionId: string) => void;
  onClaim: (sessionId: string) => void;
  onClose: (sessionId: string) => void;
  onSessionUpdate?: () => void;
  /** Optional: imperative ref so the parent (chats page) can trigger send
   *  via Cmd/Ctrl+Enter hotkey from outside the textarea. */
  sendRef?: React.MutableRefObject<(() => void) | null>;
  /** Optional: imperative ref so the parent can focus the textarea via "/"
   *  hotkey. */
  focusReplyRef?: React.MutableRefObject<(() => void) | null>;
  /** Phase 5.5: when set, the Convert-to-Ticket button is disabled and
   *  reads the existing ticket id from the session listing. */
  linkedTicketId?: string | null;
  linkedTicketNumber?: number | null;
}

type TabId = "trace" | "notes" | "history";

function getDisplayName(identifier?: string): string {
  if (!identifier) return "Customer";
  if (identifier.startsWith("Customer #")) return identifier;
  const hash = identifier.slice(-4).toUpperCase();
  return `Customer ${hash}`;
}

function draftKey(sessionId: string): string {
  return `pc-draft-${sessionId}`;
}

export default function ChatPanel({
  sessionId,
  sessionStatus,
  sessionClaimedByKind,
  sessionClaimedBy,
  pageContext,
  customerIdentifier,
  customerCity,
  customerRegion,
  customerCountry,
  onRelease,
  onClaim,
  onClose,
  onSessionUpdate,
  sendRef,
  focusReplyRef,
  linkedTicketId,
  linkedTicketNumber,
}: ChatPanelProps) {
  const { data: authSession } = useSession();
  const { addToast } = useToast();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [claimedByBanner, setClaimedByBanner] = useState<string | null>(null);
  const [justClaimed, setJustClaimed] = useState(false);
  const [showReassign, setShowReassign] = useState(false);
  const [onlineAgents, setOnlineAgents] = useState<OnlineAgent[]>([]);
  const [reassigning, setReassigning] = useState(false);
  const [closedLocal, setClosedLocal] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>("trace");
  const [showSlashPopover, setShowSlashPopover] = useState(false);
  const [aiEnabled, setAiEnabled] = useState(true);
  const [suggesting, setSuggesting] = useState(false);
  const [convertingTicket, setConvertingTicket] = useState(false);
  const [localTicketId, setLocalTicketId] = useState<string | null>(
    linkedTicketId ?? null
  );
  const [localTicketNumber, setLocalTicketNumber] = useState<number | null>(
    linkedTicketNumber ?? null
  );
  const [showTicketModal, setShowTicketModal] = useState(false);

  useEffect(() => {
    setLocalTicketId(linkedTicketId ?? null);
    setLocalTicketNumber(linkedTicketNumber ?? null);
  }, [linkedTicketId, linkedTicketNumber]);

  const handleConvertToTicket = async () => {
    if (convertingTicket || localTicketId) return;
    setConvertingTicket(true);
    try {
      const firstCustomer = messages.find((m) => m.role === "customer");
      const subject = (firstCustomer?.content ?? "Follow-up from chat")
        .trim()
        .slice(0, 120);
      const res = await fetch("/api/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: "chat",
          sessionId,
          subject,
          priority: "normal",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409 && data.ticketId) {
        setLocalTicketId(data.ticketId);
        setShowTicketModal(true);
        addToast("Ticket already exists for this session", "warning");
        return;
      }
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      if (data.ticket?.id) {
        setLocalTicketId(data.ticket.id);
        setLocalTicketNumber(data.ticket.ticketNumber);
        setShowTicketModal(true);
        addToast(`Ticket #${data.ticket.ticketNumber} created`, "success");
      }
    } catch (e) {
      addToast(
        e instanceof Error ? e.message : "Failed to create ticket",
        "error"
      );
    } finally {
      setConvertingTicket(false);
    }
  };
  const pollRef = useRef<NodeJS.Timeout | null>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const sendInFlightRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const isManager = authSession?.user?.role === "store_manager";
  const isClosed = closedLocal || sessionStatus === "closed";
  const isHuman =
    !isClosed &&
    (sessionClaimedByKind === "human" || sessionStatus === "active_human");
  const isAi =
    !isClosed &&
    (sessionClaimedByKind === "ai" || sessionStatus === "active_ai");
  const isUnclaimed =
    !isClosed && !sessionClaimedByKind && sessionStatus === "waiting";
  const myId = authSession?.user?.id;
  const isMyChat =
    !isClosed &&
    (justClaimed || (isHuman && !!myId && sessionClaimedBy?.id === myId));
  const canRelease =
    !isClosed &&
    (isMyChat || (isManager && isHuman) || (isManager && isAi));

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

  // Hydrate input from sessionStorage draft when session changes.
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(draftKey(sessionId));
      setInput(saved ?? "");
    } catch {
      setInput("");
    }
    setShowSlashPopover(false);
  }, [sessionId]);

  // Pull aiEnabled once so the AI Suggest button can be disabled.
  useEffect(() => {
    fetch("/api/chat/settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data && typeof data.aiEnabled === "boolean") {
          setAiEnabled(data.aiEnabled);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let channel: any = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let pusherInstance: any = null;

    import("@/lib/pusher/client").then(({ getPusherClient }) => {
      if (cancelled) return;
      pusherInstance = getPusherClient();
      channel = pusherInstance.subscribe(`session-${sessionId}`);
      channel.unbind("new-message");
      channel.unbind("session-claimed");
      channel.unbind("session-released");
      channel.unbind("session-closed");

      channel.bind("new-message", (data: Message) => {
        setMessages((prev) => {
          if (prev.some((m) => m.id === data.id)) return prev;
          return [...prev, data];
        });
      });

      channel.bind(
        "session-claimed",
        (data: { agentId?: string; agentName?: string; kind?: string; reassigned?: boolean }) => {
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
        setJustClaimed(false);
        setClaimedByBanner(null);
        onSessionUpdate?.();
      });

      channel.bind("session-closed", () => {
        setClosedLocal(true);
        setJustClaimed(false);
        setClaimedByBanner(null);
        setShowReassign(false);
        onSessionUpdate?.();
      });
    }).catch(() => {});

    return () => {
      cancelled = true;
      channel?.unbind_all();
      pusherInstance?.unsubscribe(`session-${sessionId}`);
    };
  }, [sessionId, myId, onSessionUpdate]);

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

  useEffect(() => {
    setJustClaimed(false);
    setClosedLocal(false);
    setClaimedByBanner(null);
  }, [sessionId]);

  const emitTyping = useCallback(() => {
    if (typingTimeoutRef.current) return;
    typingTimeoutRef.current = setTimeout(() => {
      typingTimeoutRef.current = null;
    }, 2000);
    fetch(`/api/sessions/${sessionId}/typing`, { method: "POST" }).catch(() => {});
  }, [sessionId]);

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
      setJustClaimed(true);
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

  const sendAgentMessage = useCallback(async () => {
    if (!input.trim() || sending || sendInFlightRef.current) return;
    sendInFlightRef.current = true;
    const content = input.trim();
    setInput("");
    try {
      sessionStorage.removeItem(draftKey(sessionId));
    } catch {
      // ignore
    }
    setSending(true);
    setShowSlashPopover(false);
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = null;
    }

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
      sendInFlightRef.current = false;
      setSending(false);
    }
  }, [input, sending, sessionId, authSession, fetchMessages]);

  // Expose send + focusReply to the parent (chats page) for hotkeys.
  useEffect(() => {
    if (sendRef) sendRef.current = sendAgentMessage;
    return () => {
      if (sendRef) sendRef.current = null;
    };
  }, [sendRef, sendAgentMessage]);

  useEffect(() => {
    if (focusReplyRef) {
      focusReplyRef.current = () => {
        textareaRef.current?.focus();
      };
    }
    return () => {
      if (focusReplyRef) focusReplyRef.current = null;
    };
  }, [focusReplyRef]);

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setInput(value);
    try {
      if (value) sessionStorage.setItem(draftKey(sessionId), value);
      else sessionStorage.removeItem(draftKey(sessionId));
    } catch {
      // storage quota or disabled — non-fatal
    }
    if (isMyChat) emitTyping();
    setShowSlashPopover(value.startsWith("/"));
  };

  const handleSelectCanned = (body: string) => {
    setInput(body);
    try {
      sessionStorage.setItem(draftKey(sessionId), body);
    } catch {
      // ignore
    }
    setShowSlashPopover(false);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (el) {
        el.focus();
        const end = body.length;
        el.setSelectionRange(end, end);
      }
    });
  };

  const handleAiSuggest = async () => {
    if (!aiEnabled || suggesting) return;
    if (input.trim().length > 0) {
      const ok = window.confirm(
        "Replace your current draft with the AI suggestion?"
      );
      if (!ok) return;
    }
    setSuggesting(true);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/ai-suggest`, {
        method: "POST",
      });
      if (res.status === 429) {
        addToast(
          "AI suggest limit reached (30/hour). Try again later.",
          "warning"
        );
        return;
      }
      if (res.status === 503) {
        addToast("AI is disabled in bot settings.", "warning");
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const suggestion: string = data.suggestion ?? "";
      setInput(suggestion);
      try {
        if (suggestion)
          sessionStorage.setItem(draftKey(sessionId), suggestion);
      } catch {
        // ignore
      }
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (el) {
          el.focus();
          const end = suggestion.length;
          el.setSelectionRange(end, end);
        }
      });
    } catch (err) {
      console.error("AI suggest failed:", err);
      addToast("Failed to generate suggestion. Please try again.", "error");
    } finally {
      setSuggesting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (showSlashPopover) {
      // Let the popover handle ArrowUp/Down/Enter/Escape via document listener.
      if (
        e.key === "ArrowDown" ||
        e.key === "ArrowUp" ||
        e.key === "Enter" ||
        e.key === "Escape"
      ) {
        return;
      }
    }
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      sendAgentMessage();
      return;
    }
    if (e.key === "Enter" && !e.shiftKey && !showSlashPopover) {
      e.preventDefault();
      sendAgentMessage();
    }
  };

  const TabButton = ({
    id,
    label,
    count,
  }: {
    id: TabId;
    label: string;
    count?: number;
  }) => (
    <button
      type="button"
      role="tab"
      aria-selected={activeTab === id}
      onClick={() => setActiveTab(id)}
      data-testid={`chat-tab-${id}`}
      className={`px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
        activeTab === id
          ? "border-accent text-text-primary"
          : "border-transparent text-text-secondary hover:text-text-primary"
      }`}
    >
      {label}
      {typeof count === "number" && count > 0 && (
        <span className="ml-1 px-1.5 py-px text-[10px] rounded-full bg-accent/10 text-accent">
          {count}
        </span>
      )}
    </button>
  );

  const showAgentTabs = !!authSession?.user; // any authed user can see notes/history

  return (
    <div className="flex flex-col h-full">
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
            <span
              className="text-sm font-semibold text-text-primary"
              data-testid="chat-customer-name"
            >
              {getDisplayName(customerIdentifier)}
            </span>
            <LocationBadge
              city={customerCity}
              region={customerRegion}
              country={customerCountry}
              compact
            />
          </div>
          <Button variant="ghost" size="sm" onClick={() => onClose(sessionId)}>
            <X size={14} className="mr-1" />
            Close
          </Button>
        </div>
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
            {!isClosed && (isMyChat || isManager) && (
              <Button
                variant="ghost"
                size="sm"
                disabled={convertingTicket || !!localTicketId}
                onClick={() => {
                  if (localTicketId) {
                    setShowTicketModal(true);
                  } else {
                    void handleConvertToTicket();
                  }
                }}
                title={
                  localTicketId
                    ? localTicketNumber
                      ? `Linked ticket #${localTicketNumber} — open`
                      : "Ticket already exists"
                    : "Open a tracked ticket for this chat"
                }
                data-testid="convert-to-ticket-button"
              >
                <TicketIcon size={14} className="mr-1.5" />
                {localTicketId
                  ? localTicketNumber
                    ? `Ticket #${localTicketNumber}`
                    : "Ticket linked"
                  : convertingTicket
                  ? "Converting…"
                  : "Convert to Ticket"}
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

      {showAgentTabs && (
        <div
          className="shrink-0 border-t border-border bg-background/40"
          data-testid="chat-tabs"
        >
          <div className="flex items-center gap-1 px-2 border-b border-border" role="tablist">
            <TabButton id="trace" label="AI Trace" />
            <TabButton id="notes" label="Notes" />
            <TabButton id="history" label="History" />
          </div>
          {activeTab === "trace" && (
            <AITrace sessionId={sessionId} />
          )}
          {activeTab === "notes" && (
            <NotesPanel sessionId={sessionId} />
          )}
          {activeTab === "history" && customerIdentifier && (
            <HistoryPanel
              sessionId={sessionId}
              customerIdentifier={customerIdentifier}
            />
          )}
        </div>
      )}

      {isClosed && (
        <div className="shrink-0 border-t border-border bg-slate-100 px-4 py-3 text-center">
          <p className="text-xs text-slate-600">
            This chat is closed. The customer was notified the conversation
            ended.
          </p>
        </div>
      )}

      {!isClosed && isMyChat && (
        <div className="shrink-0 border-t border-border bg-surface px-4 py-3 relative">
          <CannedReplyPopover
            sessionId={sessionId}
            query={input}
            open={showSlashPopover}
            onSelect={handleSelectCanned}
            onClose={() => setShowSlashPopover(false)}
          />
          <div className="flex items-end gap-2">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              rows={2}
              placeholder="Type a response… ( / for canned replies )"
              data-testid="chat-reply-textarea"
              className="flex-1 px-3.5 py-2.5 text-sm border border-border rounded-button focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent resize-y"
            />
            <div className="flex flex-col gap-1.5 shrink-0">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleAiSuggest}
                disabled={!aiEnabled || suggesting}
                title={
                  aiEnabled
                    ? "Generate a suggested reply"
                    : "AI is disabled in bot settings"
                }
                data-testid="ai-suggest-btn"
              >
                <Sparkles size={14} className="mr-1" />
                {suggesting ? "…" : "AI suggest"}
              </Button>
              <Button
                onClick={sendAgentMessage}
                disabled={!input.trim() || sending}
                data-testid="chat-send-btn"
              >
                <Send size={14} />
              </Button>
            </div>
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

      {showTicketModal && localTicketId && (
        <TicketDetailModal
          ticketId={localTicketId}
          onClose={() => setShowTicketModal(false)}
        />
      )}
    </div>
  );
}
