"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import ChatHeader from "./ChatHeader";
import MessageBubble from "./MessageBubble";
import { Send, Loader2, Clock } from "lucide-react";

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

import { type SessionState, resolveSessionState } from "./sessionState";

const EMBED_CUSTOMER_STORAGE_KEY = "pc-embed-customer-id";
const SESSION_FETCH_MS = 25_000;
const CHAT_POST_MS = 55_000;
const HEARTBEAT_INTERVAL_MS = 30_000;

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
  /**
   * sessionState tracks what the server told us about claim status.
   *  - 'idle'         initial / session not yet started
   *  - 'waiting'      queued, no claim yet
   *  - 'active_ai'    AI has claimed and responded
   *  - 'active_human' human agent has claimed
   *  - 'closed'       session ended (sweep, agent close, or 410 from /api/chat)
   */
  const [sessionState, setSessionState] = useState<
    "idle" | "waiting" | "active_ai" | "active_human" | "closed"
  >("idle");
  const scrollRef = useRef<HTMLDivElement>(null);
  const sessionInitStartedForKey = useRef<string | null>(null);
  const sendInFlightRef = useRef(false);
  const heartbeatRef = useRef<NodeJS.Timeout | null>(null);
  const typingClearRef = useRef<NodeJS.Timeout | null>(null);
  const dbSessionIdRef = useRef<string | null>(null);
  dbSessionIdRef.current = dbSessionId;

  // ── Page context from parent frame ─────────────────────────────────────────
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.data?.type === "pc-page-context") {
        setPageContext(event.data.context);
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  // ── Session init ────────────────────────────────────────────────────────────
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
          const status = data.session.status;
          if (status === "active_human") setSessionState("active_human");
          else if (status === "active_ai") setSessionState("active_ai");
          else if (status === "waiting") setSessionState("waiting");
          else if (status === "closed") setSessionState("closed");

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

  // ── Customer heartbeat ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!dbSessionId) return;
    // Once the session is closed there's nothing to keep alive; skip heartbeats
    // entirely until the customer starts a fresh session.
    if (sessionState === "closed") return;

    const ping = () => {
      fetch(`/api/sessions/${dbSessionId}/heartbeat`, { method: "POST" }).catch(() => {});
    };

    const sendEnd = () => {
      navigator.sendBeacon(`/api/sessions/${dbSessionId}/end`);
    };

    // Start heartbeat
    ping();
    heartbeatRef.current = setInterval(() => {
      if (document.visibilityState === "visible") ping();
    }, HEARTBEAT_INTERVAL_MS);

    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        ping();
      } else {
        sendEnd();
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("beforeunload", sendEnd);

    return () => {
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("beforeunload", sendEnd);
    };
  }, [dbSessionId, sessionState]);

  // ── Polling fallback for missed Pusher events ───────────────────────────────
  useEffect(() => {
    if (!dbSessionId) return;
    const POLL_MS = 8_000;
    const poll = async () => {
      try {
        const res = await fetch(`/api/sessions/${dbSessionId}/messages`);
        if (!res.ok) return;
        const data = await res.json();
        const fetched: Message[] = data.messages ?? [];
        if (fetched.length === 0) return;
        setMessages((prev) => {
          let next = prev;
          for (const m of fetched) {
            next = mergeRealMessage(next, m);
          }
          return next;
        });
      } catch {
        // non-fatal
      }
    };
    const tid = setInterval(poll, POLL_MS);
    return () => clearInterval(tid);
  }, [dbSessionId]);

  // ── Session-status poll (runs only while waiting for a claim) ───────────────
  useEffect(() => {
    if (!dbSessionId || sessionState !== "waiting") return;
    const poll = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch(`/api/sessions/${dbSessionId}`);
        if (!res.ok) return;
        const data = await res.json();
        const kind = data.session?.claimedByKind as string | null | undefined;
        if (kind === "human") setSessionState("active_human");
        else if (kind === "ai") setSessionState("active_ai");
      } catch {
        // non-fatal
      }
    };
    const tid = setInterval(poll, 4_000);
    return () => clearInterval(tid);
  }, [dbSessionId, sessionState]);

  // Merge a single real (non-temp) message into the list. Drops it if the
  // ID is already present, otherwise replaces the FIRST matching temp by
  // content+role, otherwise appends. Any OTHER temps that match content+role
  // are dropped — those are orphans from earlier failed sends.
  const mergeRealMessage = (prev: Message[], incoming: Message): Message[] => {
    if (incoming.id.startsWith("temp-")) return prev;
    if (prev.some((m) => m.id === incoming.id)) {
      return prev.filter(
        (m) =>
          !(m.id.startsWith("temp-") &&
            m.content === incoming.content &&
            m.role === incoming.role)
      );
    }
    let replaced = false;
    const out: Message[] = [];
    for (const m of prev) {
      const isOrphanMatch =
        m.id.startsWith("temp-") &&
        m.content === incoming.content &&
        m.role === incoming.role;
      if (isOrphanMatch && !replaced) {
        out.push(incoming);
        replaced = true;
      } else if (isOrphanMatch) {
        continue;
      } else {
        out.push(m);
      }
    }
    if (!replaced) out.push(incoming);
    return out;
  };

  // ── Pusher subscription ─────────────────────────────────────────────────────
  const handleNewMessage = useCallback((data: Message) => {
    setMessages((prev) => mergeRealMessage(prev, data));
    if (data.role === "ai" || data.role === "agent") {
      setWaitingForReply(false);
      // Also transition from "waiting" → "active_ai" here. `session-claimed`
      // and `new-message` are independent Pusher events; if `new-message`
      // arrives first the session is still queued, and without this branch
      // the amber waiting banner would persist alongside the AI's reply.
      setSessionState((prev) => resolveSessionState(prev, data.role));
    }
  }, []);

  const handleTyping = useCallback(() => {
    setWaitingForReply(true);
    if (typingClearRef.current) clearTimeout(typingClearRef.current);
    typingClearRef.current = setTimeout(() => setWaitingForReply(false), 3000);
  }, []);

  const handleClaimed = useCallback((data: { kind?: string }) => {
    if (data.kind === "human") setSessionState("active_human");
    else if (data.kind === "ai") setSessionState("active_ai");
    setWaitingForReply(false);
  }, []);

  const handleReleased = useCallback(() => {
    setSessionState("waiting");
  }, []);

  const handleClosed = useCallback(() => {
    setSessionState("closed");
    setWaitingForReply(false);
    if (typingClearRef.current) {
      clearTimeout(typingClearRef.current);
      typingClearRef.current = null;
    }
  }, []);

  // Starts a fresh session: rotate the sessionStorage key so the init effect
  // creates a new DB session. Existing message history is cleared from view.
  const startNewSession = useCallback(() => {
    const fresh = `embed_${crypto.randomUUID()}`;
    try {
      sessionStorage.setItem(EMBED_CUSTOMER_STORAGE_KEY, fresh);
    } catch {
      // ignore storage failures; we still rotate in-memory
    }
    setMessages([]);
    setDbSessionId(null);
    setSessionState("idle");
    setWaitingForReply(false);
    setInput("");
    sessionInitStartedForKey.current = null;
    setVisitorKey(fresh);
  }, []);

  useEffect(() => {
    if (!dbSessionId) return;
    let cancelled = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let channel: any = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let pusherInstance: any = null;

    import("@/lib/pusher/client").then(({ getPusherClient }) => {
      if (cancelled) return;
      pusherInstance = getPusherClient();
      channel = pusherInstance.subscribe(`session-${dbSessionId}`);
      // Unbind before binding — guards against Pusher reusing a channel object
      // that still holds handlers from a previous subscription cycle (the server-side
      // unsubscribe acknowledgment is async, so the channel can be handed back with
      // stale listeners still attached).
      channel.unbind("new-message");
      channel.unbind("typing");
      channel.unbind("session-claimed");
      channel.unbind("session-released");
      channel.unbind("session-closed");
      channel.bind("new-message", handleNewMessage);
      channel.bind("typing", handleTyping);
      channel.bind("session-claimed", handleClaimed);
      channel.bind("session-released", handleReleased);
      channel.bind("session-closed", handleClosed);
      console.log(
        "[Pusher] new-message handler count after bind:",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (channel as any).callbacks?._callbacks?.["new-message"]?.length ?? "unknown"
      );
    });

    return () => {
      cancelled = true;
      channel?.unbind_all();
      pusherInstance?.unsubscribe(`session-${dbSessionId}`);
    };
  }, [dbSessionId, handleNewMessage, handleTyping, handleClaimed, handleReleased, handleClosed]);

  // ── Auto-scroll ─────────────────────────────────────────────────────────────
  const userScrolledUp = useRef(false);
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    userScrolledUp.current = el.scrollHeight - el.scrollTop - el.clientHeight > 80;
  }, []);

  useEffect(() => {
    if (userScrolledUp.current) return;
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  // ── Send message ────────────────────────────────────────────────────────────
  const appendLocalError = useCallback((text: string) => {
    setMessages((prev) => [
      ...prev,
      {
        id: `notice-${Date.now()}`,
        role: "ai",
        content: text,
        sentAt: new Date().toISOString(),
      },
    ]);
    setWaitingForReply(false);
  }, []);

  const sendMessage = async () => {
    const trimmed = input.trim();
    if (!trimmed || sendInFlightRef.current) return;
    if (sessionState === "closed") return;
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
          appendLocalError(
            "Could not reach the server to start chat (timed out). Check your connection and try again."
          );
          setMessages((prev) => prev.filter((m) => m.id !== tempMsg.id));
          return;
        }
        const sData = await sRes.json().catch(() => ({}));
        if (sData.session?.id) {
          sid = sData.session.id;
          setDbSessionId(sid);
        }
      }

      if (!sid) {
        appendLocalError(
          "We couldn't start your chat session. Refresh and try again."
        );
        setMessages((prev) => prev.filter((m) => m.id !== tempMsg.id));
        return;
      }

      let res: Response;
      try {
        res = await fetchWithTimeout(
          "/api/chat",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message: content, sessionId: sid, pageContext }),
          },
          CHAT_POST_MS
        );
      } catch {
        appendLocalError("Your message timed out. Try again.");
        setMessages((prev) => prev.filter((m) => m.id !== tempMsg.id));
        return;
      }

      const data = await res.json().catch(() => ({}));

      if (res.status === 410 || data.code === "session_closed") {
        // Server says this session has ended. Drop the optimistic temp,
        // flip into closed state so the UI offers a fresh-start CTA.
        setMessages((prev) => prev.filter((m) => m.id !== tempMsg.id));
        setSessionState("closed");
        setWaitingForReply(false);
        appendLocalError(
          typeof data.error === "string"
            ? data.error
            : "This conversation has ended. Please start a new chat."
        );
        return;
      }

      if (!res.ok) {
        appendLocalError(
          typeof data.error === "string"
            ? `${data.error} Try again.`
            : "Your message didn't go through. Please try again."
        );
        setMessages((prev) => prev.filter((m) => m.id !== tempMsg.id));
        return;
      }

      if (data.message) {
        setMessages((prev) => mergeRealMessage(prev, data.message));
      }

      // Update session state from server response
      const serverStatus = data.sessionStatus as string | undefined;
      if (serverStatus === "active_human") {
        setSessionState("active_human");
        setWaitingForReply(false);
      } else if (serverStatus === "active_ai") {
        setSessionState("active_ai");
        setWaitingForReply(false);
      } else if (serverStatus === "waiting") {
        setSessionState("waiting");
        // Don't show "typing…" indefinitely when queued
        setWaitingForReply(false);
      }
    } catch {
      setMessages((prev) => prev.filter((m) => m.id !== tempMsg.id));
      appendLocalError("Something went wrong. Please refresh and try again.");
    } finally {
      sendInFlightRef.current = false;
      setSending(false);
    }
  };

  // ── Status banner for the customer ─────────────────────────────────────────
  const renderStatusBanner = () => {
    // Only show "Waiting for an agent" once the customer has actually said
    // something. A freshly-created session is `waiting` server-side by default,
    // so without this guard the amber banner would appear on the welcome screen
    // before the customer has typed anything.
    if (
      sessionState === "waiting" &&
      messages.some((m) => m.role === "customer")
    ) {
      return (
        <div className="flex items-center gap-2 py-2 px-3 mx-1 my-1 bg-amber-50 rounded-lg border border-amber-100">
          <Clock size={13} className="text-amber-500 shrink-0 animate-pulse" />
          <span className="text-xs text-amber-700">
            Waiting for an agent — we&apos;ll be with you shortly.
          </span>
        </div>
      );
    }
    if (sessionState === "active_ai") {
      return (
        <div className="flex items-center gap-2 py-2 px-3 mx-1 my-1 bg-blue-50 rounded-lg border border-blue-100">
          <span className="w-1.5 h-1.5 rounded-full bg-blue-400 shrink-0" />
          <span className="text-xs text-blue-700">
            AI Assistant is helping you. A team member can take over if needed.
          </span>
        </div>
      );
    }
    if (sessionState === "active_human") {
      return (
        <div className="flex items-center gap-2 py-2 px-3 mx-1 my-1 bg-emerald-50 rounded-lg border border-emerald-100">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
          <span className="text-xs text-emerald-700">
            You&apos;re connected with our team — they&apos;ll reply shortly.
          </span>
        </div>
      );
    }
    return null;
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
        {renderStatusBanner()}
        {waitingForReply && sessionState !== "waiting" && (
          <div className="flex items-center gap-1.5 py-2 px-1">
            <div className="w-7 h-7 bg-surface-elevated rounded-full flex items-center justify-center">
              <span className="flex gap-0.5">
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className="w-1.5 h-1.5 rounded-full bg-text-secondary animate-bounce"
                    style={{ animationDelay: `${i * 0.15}s` }}
                  />
                ))}
              </span>
            </div>
            <span className="text-xs text-text-secondary">Typing...</span>
          </div>
        )}
      </div>
      <div className="relative z-20 border-t border-border bg-surface px-3 py-3 shrink-0">
        {sessionState === "closed" ? (
          <div className="flex flex-col items-center gap-2 py-2">
            <p
              className="text-xs text-text-secondary text-center"
              data-testid="chat-ended-message"
            >
              This conversation has ended.
            </p>
            <button
              type="button"
              onClick={startNewSession}
              data-testid="chat-start-new"
              className="px-4 py-2 text-sm font-medium rounded-full bg-accent text-white hover:bg-accent/90 transition-colors"
            >
              Start a new chat
            </button>
          </div>
        ) : (
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
              disabled={!input.trim() || sending}
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
        )}
        <p className="text-[10px] text-text-secondary text-center mt-2">
          Powered by Performance Cycle
        </p>
      </div>
    </div>
  );
}
