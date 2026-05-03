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

const EMBED_CUSTOMER_STORAGE_KEY = "pc-embed-customer-id";
/** On `/embed`, never wait longer than this before invoking AI (human-first window). */
const EMBED_MAX_HUMAN_FIRST_WAIT_SECONDS = 6;

const SESSION_FETCH_MS = 25_000;
const CHAT_POST_MS = 55_000;

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  ms: number
): Promise<Response> {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(tid);
  }
}

export default function ChatWidget() {
  const searchParams = useSearchParams();
  const urlSessionId = searchParams.get("sessionId")?.trim() ?? "";

  // Stable ID when embed.js omits sessionId: without this each POST used anon_UUID()
  // and init skipped entirely (`customerIdentifier` was falsy), breaking continuity.
  const [visitorKey, setVisitorKey] = useState("");
  useEffect(() => {
    if (urlSessionId) {
      setVisitorKey(urlSessionId);
      return;
    }
    try {
      let stored = sessionStorage.getItem(EMBED_CUSTOMER_STORAGE_KEY);
      if (!stored) {
        stored = `embed_${crypto.randomUUID()}`;
        sessionStorage.setItem(EMBED_CUSTOMER_STORAGE_KEY, stored);
      }
      setVisitorKey(stored);
    } catch {
      setVisitorKey(`embed_${crypto.randomUUID()}`);
    }
  }, [urlSessionId]);

  const customerIdentifier = visitorKey;

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
  const sessionInitStartedForKey = useRef<string | null>(null);
  const fallbackTimerRef = useRef<NodeJS.Timeout | null>(null);
  /** Sync guard so rapid double-clicks cannot enqueue two sends before React re-renders. */
  const sendInFlightRef = useRef(false);

  const appendAiNotice = useCallback((text: string) => {
    const notice: Message = {
      id: `notice-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      role: "ai",
      content: text,
      sentAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, notice]);
    setWaitingForReply(false);
  }, []);

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
    if (!customerIdentifier) return;
    if (sessionInitStartedForKey.current === customerIdentifier) return;
    sessionInitStartedForKey.current = customerIdentifier;

    async function initSession() {
      try {
        const res = await fetchWithTimeout(
          "/api/sessions",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ customerIdentifier }),
          },
          SESSION_FETCH_MS
        );
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
        // sendMessage will POST /api/sessions again
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
      const data = await res.json().catch(() => ({}));
      if (data.message) {
        setMessages((prev) => {
          if (prev.some((m) => m.id === data.message.id)) return prev;
          return [...prev, data.message];
        });
        setWaitingForReply(false);
        return;
      }
      if (data.skipped && data.reason === "Session is handled by a human agent") {
        appendAiNotice(
          "A team member is handling this chat — they'll reply shortly."
        );
        return;
      }
      appendAiNotice(
        typeof data.error === "string"
          ? `${data.error} Please try sending your message again.`
          : "Something went wrong generating a reply. Please try again."
      );
    } catch {
      appendAiNotice(
        "We couldn't reach the assistant. Check your connection and try again."
      );
    }
  };

  const sendMessage = async () => {
    const trimmed = input.trim();
    if (!trimmed || sendInFlightRef.current) return;
    sendInFlightRef.current = true;
    const content = trimmed;
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
        let sRes: Response;
        try {
          sRes = await fetchWithTimeout(
            "/api/sessions",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ customerIdentifier, pageContext }),
            },
            SESSION_FETCH_MS
          );
        } catch {
          appendAiNotice(
            "Could not reach the server to start chat (timed out). Check your connection and try again."
          );
          return;
        }
        const sData = await sRes.json().catch(() => ({}));
        if (sData.session?.id) {
          sid = sData.session.id;
          setDbSessionId(sid);
        }
      }

      if (!sid) {
        appendAiNotice(
          "We couldn't start your chat session (connection issue). Refresh and try again."
        );
        return;
      }

      let res: Response;
      try {
        res = await fetchWithTimeout(
          "/api/chat",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              message: content,
              sessionId: sid,
              pageContext,
            }),
          },
          CHAT_POST_MS
        );
      } catch {
        appendAiNotice(
          "Your message timed out before the server responded. Try again."
        );
        return;
      }
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        appendAiNotice(
          typeof data.error === "string"
            ? `${data.error} Try again in a moment.`
            : "Your message didn't go through. Please try again."
        );
        return;
      }

      if (data.message) {
        setMessages((prev) =>
          prev.map((m) => (m.id === tempMsg.id ? data.message : m))
        );
      }

      const onEmbed =
        typeof window !== "undefined" &&
        window.location.pathname.includes("/embed");
      const humanFirstSeconds = onEmbed
        ? Math.min(
            botSettings.fallbackTimerSeconds,
            EMBED_MAX_HUMAN_FIRST_WAIT_SECONDS
          )
        : botSettings.fallbackTimerSeconds;

      // Sync agentClaimed from server session state — catches sessions claimed
      // in a prior browser session where the Pusher event was missed
      if (data.sessionStatus === "active_human") {
        setAgentClaimed(true);
        appendAiNotice(
          "You're connected with our team — someone will reply shortly."
        );
      } else if (botSettings.aiEnabled && !agentClaimed) {
        // waiting: give human agents the fallback window before AI takes over.
        // On `/embed`, cap wait so visitors aren't staring at a blank chat for 60s.
        const delay =
          data.sessionStatus === "active_ai"
            ? 2000
            : humanFirstSeconds * 1000;

        if (fallbackTimerRef.current) clearTimeout(fallbackTimerRef.current);
        fallbackTimerRef.current = setTimeout(() => {
          triggerAIFallback(content, sid!);
        }, delay);
      } else {
        appendAiNotice(
          "AI replies are turned off — our staff will respond when available."
        );
      }
    } catch {
      appendAiNotice(
        "Something went wrong. Please refresh and try again."
      );
    } finally {
      sendInFlightRef.current = false;
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
      <div className="relative z-20 border-t border-border bg-surface px-3 py-3 shrink-0">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter" || e.shiftKey) return;
              e.preventDefault();
              void sendMessage();
            }}
            placeholder="Type your message..."
            data-testid="chat-input"
            autoComplete="off"
            className="flex-1 px-3.5 py-2.5 text-sm border border-border rounded-full focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent bg-background"
          />
          <button
            type="button"
            onClick={() => void sendMessage()}
            disabled={!input.trim()}
            aria-busy={sending}
            data-testid="chat-send"
            className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors text-white shrink-0 ${
              !input.trim()
                ? "bg-accent/35 cursor-not-allowed opacity-60"
                : sending
                  ? "bg-accent/80 cursor-wait"
                  : "bg-accent hover:bg-accent/90"
            }`}
          >
            {sending ? (
              <Loader2 size={16} className="animate-spin" aria-hidden />
            ) : (
              <Send size={16} aria-hidden />
            )}
          </button>
        </div>
        <p className="text-[10px] text-text-secondary text-center mt-2">
          Powered by Performance Cycle
        </p>
      </div>
    </div>
  );
}
