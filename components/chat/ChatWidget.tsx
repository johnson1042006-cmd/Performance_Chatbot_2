"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import ChatHeader from "./ChatHeader";
import MessageBubble from "./MessageBubble";
import { Send, Loader2 } from "lucide-react";

interface Message {
  id: string;
  role: "customer" | "agent" | "ai";
  content: string;
  sentAt: string;
  agentName?: string;
}

interface PageContext {
  url: string;
  pageType: string;
  productName: string | null;
  productSku: string | null;
  categoryName: string | null;
  searchQuery: string | null;
}

interface BotSettings {
  aiEnabled: boolean;
  fallbackTimerSeconds: number;
}

export default function ChatWidget() {
  const searchParams = useSearchParams();
  const customerIdentifier = searchParams.get("sessionId") || "";
  const [dbSessionId, setDbSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [waitingForReply, setWaitingForReply] = useState(false);
  const [pageContext, setPageContext] = useState<PageContext | null>(null);
  const [agentClaimed, setAgentClaimed] = useState(false);
  const [botSettings, setBotSettings] = useState<BotSettings>({
    aiEnabled: true,
    fallbackTimerSeconds: 60,
  });
  const scrollRef = useRef<HTMLDivElement>(null);
  const initialized = useRef(false);
  const fallbackTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.data?.type === "pc-page-context") {
        setPageContext(event.data.context);
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  useEffect(() => {
    fetch("/api/chat/settings")
      .then((res) => res.json())
      .then((data) => setBotSettings(data))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!customerIdentifier || initialized.current) return;
    initialized.current = true;

    async function initSession() {
      try {
        const res = await fetch("/api/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ customerIdentifier }),
        });
        const data = await res.json();
        if (data.session?.id) {
          setDbSessionId(data.session.id);
          const msgRes = await fetch(`/api/sessions/${data.session.id}/messages`);
          if (msgRes.ok) {
            const msgData = await msgRes.json();
            if (msgData.messages?.length) setMessages(msgData.messages);
          }
        }
      } catch {
        // Will retry on next message send
      }
    }
    initSession();
  }, [customerIdentifier]);

  const subscribeToChannel = useCallback(() => {
    if (!dbSessionId) return () => {};
    let cleanup = () => {};
    import("@/lib/pusher/client").then(({ getPusherClient }) => {
      const pusher = getPusherClient();
      const channel = pusher.subscribe(`session-${dbSessionId}`);
      channel.bind("new-message", (data: Message) => {
        setMessages((prev) => {
          if (prev.some((m) => m.id === data.id)) return prev;
          const tempMatch = prev.find(
            (m) => m.id.startsWith("temp-") && m.content === data.content && m.role === data.role
          );
          if (tempMatch) {
            return prev.map((m) => (m.id === tempMatch.id ? data : m));
          }
          return [...prev, data];
        });
        if (data.role === "ai" || data.role === "agent") {
          setWaitingForReply(false);
        }
      });
      channel.bind("session-claimed", () => {
        setAgentClaimed(true);
        if (fallbackTimerRef.current) {
          clearTimeout(fallbackTimerRef.current);
          fallbackTimerRef.current = null;
        }
      });
      cleanup = () => {
        channel.unbind_all();
        pusher.unsubscribe(`session-${dbSessionId}`);
      };
    });
    return cleanup;
  }, [dbSessionId]);

  useEffect(() => {
    if (!dbSessionId) return;
    const cleanup = subscribeToChannel();
    return () => cleanup();
  }, [dbSessionId, subscribeToChannel]);

  const userScrolledUp = useRef(false);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    userScrolledUp.current = distFromBottom > 80;
  }, []);

  useEffect(() => {
    if (userScrolledUp.current) return;
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  const triggerAIFallback = async (latestMessage: string, sid: string) => {
    // #region agent log
    console.log('[PC-DBG H-D] triggerAIFallback called', {sid});
    // #endregion
    try {
      const res = await fetch("/api/chat/ai-fallback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: sid,
          latestMessage,
          pageContext,
        }),
      });
      const data = await res.json();
      // #region agent log
      console.log('[PC-DBG H-B-C-E] ai-fallback response', {status:res.status, hasMessage:!!data.message, keys:Object.keys(data), skipped:data.skipped, error:data.error});
      // #endregion
      if (data.message) {
        setMessages((prev) => {
          if (prev.some((m) => m.id === data.message.id)) return prev;
          return [...prev, data.message];
        });
        setWaitingForReply(false);
      } else {
        // Always clear the spinner — message absent means skipped, error, or timeout
        setWaitingForReply(false);
      }
    } catch (err) {
      // #region agent log
      console.log('[PC-DBG H-C-E] ai-fallback exception', String(err));
      // #endregion
      setWaitingForReply(false);
    }
  };

  const sendMessage = async () => {
    if (!input.trim() || sending) return;
    const content = input.trim();
    setInput("");
    setSending(true);
    setWaitingForReply(true);

    window.parent.postMessage({ type: "pc-chat-send" }, "*");

    const tempMsg: Message = {
      id: "temp-" + Date.now(),
      role: "customer",
      content,
      sentAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, tempMsg]);

    try {
      let sid = dbSessionId;
      if (!sid) {
        const sRes = await fetch("/api/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ customerIdentifier, pageContext }),
        });
        const sData = await sRes.json();
        if (sData.session?.id) {
          sid = sData.session.id;
          setDbSessionId(sid);
        }
      }

      if (!sid) {
        setSending(false);
        setWaitingForReply(false);
        return;
      }

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: content,
          sessionId: sid,
          pageContext,
        }),
      });
      const data = await res.json();
      if (data.message) {
        setMessages((prev) =>
          prev.map((m) => (m.id === tempMsg.id ? data.message : m))
        );
      }

      // Sync agentClaimed from server session state — catches sessions claimed
      // in a prior browser session where the Pusher event was missed
      if (data.sessionStatus === "active_human") {
        setAgentClaimed(true);
        setWaitingForReply(false);
      } else if (botSettings.aiEnabled && !agentClaimed) {
        // For AI-handled sessions (waiting / active_ai), respond quickly.
        // Only use the full fallbackTimerSeconds if the session status is
        // something unexpected — gives agents a window in those cases only.
        const delay =
          data.sessionStatus === "waiting" || data.sessionStatus === "active_ai"
            ? 2000
            : botSettings.fallbackTimerSeconds * 1000;

        if (fallbackTimerRef.current) clearTimeout(fallbackTimerRef.current);
        // #region agent log
        console.log('[PC-DBG H-A-B] timer set', {delay, sessionStatus:data.sessionStatus, aiEnabled:botSettings.aiEnabled});
        // #endregion
        fallbackTimerRef.current = setTimeout(() => {
          triggerAIFallback(content, sid!);
        }, delay);
      } else {
        // AI disabled and no human agent — clear the spinner
        setWaitingForReply(false);
      }
    } catch {
      setWaitingForReply(false);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex flex-col h-screen bg-background">
      <ChatHeader />
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-4 py-3 space-y-1"
      >
        {messages.length === 0 && (
          <div className="text-center py-12">
            <div className="w-12 h-12 bg-accent/10 rounded-full flex items-center justify-center mx-auto mb-3">
              <span className="text-accent text-lg">👋</span>
            </div>
            <p className="text-sm text-text-secondary">
              Welcome to Performance Cycle! How can we help you today?
            </p>
          </div>
        )}
        {messages.map((msg) => (
          <MessageBubble
            key={msg.id}
            role={msg.role}
            content={msg.content}
            sentAt={msg.sentAt}
            agentName={msg.agentName}
          />
        ))}
        {waitingForReply && (
          <div className="flex items-center gap-2 py-2 px-1">
            <div className="w-7 h-7 bg-surface-elevated rounded-full flex items-center justify-center">
              <Loader2 size={14} className="animate-spin text-text-secondary" />
            </div>
            <span className="text-xs text-text-secondary">Typing...</span>
          </div>
        )}
      </div>
      <div className="border-t border-border bg-surface px-3 py-3 shrink-0">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && sendMessage()}
            placeholder="Type your message..."
            className="flex-1 px-3.5 py-2.5 text-sm border border-border rounded-full focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent bg-background"
          />
          <button
            onClick={sendMessage}
            disabled={!input.trim() || sending}
            className="w-10 h-10 bg-accent hover:bg-accent/90 text-white rounded-full flex items-center justify-center transition-colors disabled:opacity-40"
          >
            <Send size={16} />
          </button>
        </div>
        <p className="text-[10px] text-text-secondary text-center mt-2">
          Powered by Performance Cycle
        </p>
      </div>
    </div>
  );
}
