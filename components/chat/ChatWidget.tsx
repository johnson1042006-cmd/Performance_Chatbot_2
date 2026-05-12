"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import ChatHeader from "./ChatHeader";
import MessageBubble from "./MessageBubble";
import QuickReplyChips, { type QuickReplyChipId } from "./QuickReplyChips";
import OrderLookupForm from "./OrderLookupForm";
import EmailCaptureForm from "./EmailCaptureForm";
import EndOfSessionCard from "./EndOfSessionCard";
import TechAirRequestForm from "./TechAirRequestForm";
import { detectTechAirServiceIntent } from "./techAirIntent";
import TireFitmentForm, { type TireFitmentPayload } from "./TireFitmentForm";
import ActionChips from "./ActionChips";
import { Send, Loader2, Clock } from "lucide-react";
import { Headphones } from "lucide-react";
import { tireCatalogUrlForRidingType } from "@/lib/search/tireCatalog";

interface Message {
  id: string;
  role: "customer" | "agent" | "ai";
  content: string;
  sentAt: string;
  agentName?: string;
}

interface Persona {
  name: string;
  title: string;
  avatarUrl: string;
}

const DEFAULT_PERSONA: Persona = {
  name: "Jake",
  title: "Product Specialist",
  avatarUrl: "/jake-avatar.svg",
};

const CHIP_AUTOSEND: Partial<Record<QuickReplyChipId, string>> = {
  return_exchange: "I'd like to start a return or exchange",
  helmet_sizing: "I need help with helmet sizing",
  tech_air: "I'd like to send my Tech-Air in for service",
  find_tires: "I need tires for my motorcycle",
};

interface PageContext {
  url: string;
  pageType: string;
  productName: string | null;
  productSku: string | null;
  categoryName: string | null;
  searchQuery: string | null;
}

import { resolveSessionState } from "./sessionState";

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

// Phase 3 helper: identifies optimistic ("temp-") and streaming
// ("streaming-") message ids so mergeRealMessage can swap them for the
// persisted server-generated id when it arrives. Hoisted outside the
// component so it stays referentially stable across renders.
const isTempId = (id: string): boolean =>
  id.startsWith("temp-") || id.startsWith("streaming-");

export default function ChatWidget() {
  // Read `sessionId` from the URL in the browser. Do not use `useSearchParams()`:
  // in production builds it keeps this subtree suspended, so `/embed` and `/chat`
  // stayed on their Suspense "Loading chat..." fallback indefinitely in Playwright.
  const [visitorKey, setVisitorKey] = useState("");
  useEffect(() => {
    const fromUrl =
      typeof window !== "undefined"
        ? new URLSearchParams(window.location.search).get("sessionId")?.trim() ??
          ""
        : "";
    if (fromUrl) {
      setVisitorKey(fromUrl);
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
  }, []);

  const customerIdentifier = visitorKey;

  const [dbSessionId, setDbSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [waitingForReply, setWaitingForReply] = useState(false);
  const [pageContext, setPageContext] = useState<PageContext | null>(null);
  const [persona, setPersona] = useState<Persona>(DEFAULT_PERSONA);
  const [chipForm, setChipForm] = useState<
    "none" | "order_lookup" | "email_capture" | "tech_air" | "tire_fitment"
  >("none");
  const [humanBannerVisible, setHumanBannerVisible] = useState(false);
  const [tireContext, setTireContext] = useState<TireFitmentPayload | null>(null);
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

  // ── Persona / boot config ──────────────────────────────────────────────────
  // Best-effort fetch — failure falls back to DEFAULT_PERSONA so the chat
  // never displays anonymously. Manager edits to the bot_persona KB row
  // propagate within the 60s s-maxage window.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/embed/config")
      .then((r) => (r.ok ? r.json() : null))
      .then((cfg) => {
        if (cancelled || !cfg?.persona) return;
        setPersona({
          name: cfg.persona.name ?? DEFAULT_PERSONA.name,
          title: cfg.persona.title ?? DEFAULT_PERSONA.title,
          avatarUrl: cfg.persona.avatarUrl ?? DEFAULT_PERSONA.avatarUrl,
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
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
      }
      // No sendEnd on hidden — that's normal tab switching, not abandonment.
      // beforeunload still fires sendEnd on actual tab close. The stale sweep
      // is the backstop for genuinely abandoned sessions.
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
  // Phase 3: also treats `streaming-` prefix as temp so the in-progress
  // SSE bubble gets replaced when the real persisted message id arrives
  // via Pusher (or via the `message` SSE event).
  const mergeRealMessage = (prev: Message[], incoming: Message): Message[] => {
    if (isTempId(incoming.id)) return prev;
    if (prev.some((m) => m.id === incoming.id)) {
      return prev.filter(
        (m) =>
          !(isTempId(m.id) &&
            m.content === incoming.content &&
            m.role === incoming.role)
      );
    }
    let replaced = false;
    const out: Message[] = [];
    for (const m of prev) {
      const isOrphanMatch =
        isTempId(m.id) &&
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
      channel.unbind("request-contact");
      channel.bind("new-message", handleNewMessage);
      channel.bind("typing", handleTyping);
      channel.bind("session-claimed", handleClaimed);
      channel.bind("session-released", handleReleased);
      channel.bind("session-closed", handleClosed);
      // Phase 3: server fires `request-contact` after auto-escalation when
      // no agents are online so we render the email-capture form without
      // requiring the customer to tap "Talk to a human".
      channel.bind("request-contact", () => {
        setChipForm("email_capture");
      });
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

  /**
   * POSTs /api/chat with `Accept: text/event-stream`. The route returns SSE
   * only for the AI inline branches; otherwise it returns JSON (queued,
   * human-claimed, errors). Outcomes:
   *  - "sse_done"    — SSE consumed cleanly; Pusher will deliver real id.
   *  - "sse_error"   — SSE started but errored mid-stream; caller surfaces a
   *                    notice (do NOT re-POST — the customer message has
   *                    already been persisted server-side).
   *  - "json"        — server returned a JSON response; payload is forwarded
   *                    to the caller for the existing handling path.
   *  - "transport"   — fetch threw before any response; safe to retry/notify.
   */
  type SseOutcome =
    | { kind: "sse_done" }
    | { kind: "sse_error"; error?: string }
    | { kind: "json"; status: number; data: Record<string, unknown> }
    | { kind: "transport" };

  const streamAiOverSse = async (
    sid: string,
    content: string,
    ctx: PageContext | null
  ): Promise<SseOutcome> => {
    let res: Response;
    try {
      res = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify({ message: content, sessionId: sid, pageContext: ctx }),
      });
    } catch {
      return { kind: "transport" };
    }
    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("text/event-stream") || !res.body) {
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      return { kind: "json", status: res.status, data };
    }

    const streamingId = `streaming-${Date.now()}`;
    let bubbleAdded = false;
    let assembled = "";

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    const flushEvent = (evt: { event: string; data: string }) => {
      if (evt.event === "token") {
        try {
          const parsed = JSON.parse(evt.data) as { text?: string };
          if (parsed.text) {
            assembled += parsed.text;
            if (!bubbleAdded) {
              bubbleAdded = true;
              setMessages((prev) => [
                ...prev,
                {
                  id: streamingId,
                  role: "ai",
                  content: assembled,
                  sentAt: new Date().toISOString(),
                },
              ]);
            } else {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === streamingId ? { ...m, content: assembled } : m
                )
              );
            }
            setWaitingForReply(false);
            setSessionState((p) => resolveSessionState(p, "ai"));
          }
        } catch {
          // malformed event — ignore
        }
      } else if (evt.event === "tool_use") {
        // Tool call in progress — do not add a bubble yet. The bubble will be
        // created naturally when the first real token arrives after all tool
        // calls complete. This prevents placeholder narration ("looking that
        // up…") from appearing and then being jammed against the final reply.
      } else if (evt.event === "message") {
        // The server sends a `message` event once the AI turn is fully
        // persisted. If it carries `autoEscalated` with agentsOnline=false
        // we show the email-capture form inline — this is the reliable path
        // when Pusher's `request-contact` races with the subscription setup
        // (dynamic import) and the event is missed.
        try {
          const parsed = JSON.parse(evt.data) as {
            autoEscalated?: { reason: string; agentsOnline: boolean } | null;
          };
          if (parsed.autoEscalated && !parsed.autoEscalated.agentsOnline) {
            setChipForm("email_capture");
          }
        } catch {
          // malformed — ignore
        }
      } else if (evt.event === "error") {
        try {
          const parsed = JSON.parse(evt.data) as { message?: string };
          throw new Error(parsed.message || "stream_error");
        } catch (err) {
          throw err instanceof Error ? err : new Error("stream_error");
        }
      }
    };

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nlIdx: number;
        while ((nlIdx = buffer.indexOf("\n\n")) >= 0) {
          const chunk = buffer.slice(0, nlIdx);
          buffer = buffer.slice(nlIdx + 2);
          const lines = chunk.split("\n");
          let event = "message";
          const dataLines: string[] = [];
          for (const line of lines) {
            if (line.startsWith("event:")) event = line.slice(6).trim();
            else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
          }
          if (dataLines.length === 0) continue;
          flushEvent({ event, data: dataLines.join("\n") });
        }
      }
    } catch (err) {
      // Drop the partial bubble; rely on Pusher's `new-message` delivering
      // the persisted final text if the server still managed to save it.
      if (bubbleAdded) {
        setMessages((prev) => prev.filter((m) => m.id !== streamingId));
      }
      return { kind: "sse_error", error: err instanceof Error ? err.message : undefined };
    }

    // If the server emitted only events (no message text yet), it may have
    // had a pre-stream error. The Pusher `new-message` event will still
    // arrive with the final saved text — leave the bubble in place if we
    // assembled anything, otherwise drop it.
    if (bubbleAdded && assembled.length === 0) {
      setMessages((prev) => prev.filter((m) => m.id !== streamingId));
    }

    return { kind: "sse_done" };
  };

  const sendMessage = async (override?: string) => {
    const candidate = override ?? input;
    const trimmed = candidate.trim();
    if (!trimmed || sendInFlightRef.current) return;
    if (sessionState === "closed") return;

    // Lightweight intent match for customer-typed messages that should open
    // a structured flow instead of sending free-text.
    const lower = trimmed.toLowerCase();
    const wantsTechAir = detectTechAirServiceIntent(trimmed);
    if (wantsTechAir) {
      if (!override) setInput("");
      const ensureSession = async (): Promise<string | null> => {
        if (dbSessionIdRef.current) return dbSessionIdRef.current;
        try {
          const sRes = await fetchWithTimeout(
            "/api/sessions",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ customerIdentifier, pageContext }),
            },
            SESSION_FETCH_MS
          );
          const sData = await sRes.json().catch(() => ({}));
          if (sData.session?.id) {
            setDbSessionId(sData.session.id);
            return sData.session.id as string;
          }
          return null;
        } catch {
          return null;
        }
      };
      const sid = await ensureSession();
      if (sid) setChipForm("tech_air");
      else
        appendLocalError(
          "We couldn't start the Tech-Air form right now. Please try again."
        );
      return;
    }

    const wantsTires =
      lower.includes("tires for my") ||
      lower.includes("tire fitment") ||
      lower.includes("what tires fit");
    if (wantsTires) {
      if (!override) setInput("");
      const ensureSession = async (): Promise<string | null> => {
        if (dbSessionIdRef.current) return dbSessionIdRef.current;
        try {
          const sRes = await fetchWithTimeout(
            "/api/sessions",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ customerIdentifier, pageContext }),
            },
            SESSION_FETCH_MS
          );
          const sData = await sRes.json().catch(() => ({}));
          if (sData.session?.id) {
            setDbSessionId(sData.session.id);
            return sData.session.id as string;
          }
          return null;
        } catch {
          return null;
        }
      };
      const sid = await ensureSession();
      if (sid) setChipForm("tire_fitment");
      else
        appendLocalError(
          "We couldn't start the tire fitment form right now. Please try again."
        );
      return;
    }

    sendInFlightRef.current = true;
    const content = trimmed;
    if (!override) setInput("");
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

      // Phase 3: POST with `Accept: text/event-stream`. The server returns
      // SSE for the AI inline branches and JSON for queued / human-claimed
      // / error cases. The helper handles both — we only need to retry on
      // a true transport failure (fetch threw before getting any response).
      const sseOutcome = await streamAiOverSse(sid, content, pageContext);
      if (sseOutcome.kind === "sse_done") {
        setSessionState((p) => resolveSessionState(p, "ai"));
        return;
      }
      if (sseOutcome.kind === "sse_error") {
        appendLocalError(
          "We had trouble streaming the reply. Please try again in a moment."
        );
        return;
      }

      let res: Response;
      let data: Record<string, unknown>;
      if (sseOutcome.kind === "json") {
        // Synthesize a Response-like shape so the existing branches below
        // keep working without a second POST.
        data = sseOutcome.data;
        res = { ok: sseOutcome.status >= 200 && sseOutcome.status < 300, status: sseOutcome.status } as Response;
      } else {
        // True transport failure — POST again over plain JSON as a last resort.
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
        data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      }

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
        setMessages((prev) => mergeRealMessage(prev, data.message as Message));
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

  // ── Quick-reply chip dispatcher ────────────────────────────────────────────
  const handleChip = useCallback(
    async (id: QuickReplyChipId) => {
      setHumanBannerVisible(false);
      if (id === "track_order") {
        setChipForm("order_lookup");
        return;
      }
      if (id === "tech_air") {
        // Ensure we have a session before opening the form.
        if (!dbSessionIdRef.current) {
          try {
            const sRes = await fetchWithTimeout(
              "/api/sessions",
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ customerIdentifier, pageContext }),
              },
              SESSION_FETCH_MS
            );
            const sData = await sRes.json().catch(() => ({}));
            if (sData.session?.id) setDbSessionId(sData.session.id);
          } catch {
            appendLocalError(
              "We couldn't start your chat session. Please try again."
            );
            return;
          }
        }
        setChipForm("tech_air");
        return;
      }
      if (id === "find_tires") {
        if (!dbSessionIdRef.current) {
          try {
            const sRes = await fetchWithTimeout(
              "/api/sessions",
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ customerIdentifier, pageContext }),
              },
              SESSION_FETCH_MS
            );
            const sData = await sRes.json().catch(() => ({}));
            if (sData.session?.id) setDbSessionId(sData.session.id);
          } catch {
            appendLocalError(
              "We couldn't start your chat session. Please try again."
            );
            return;
          }
        }
        setChipForm("tire_fitment");
        return;
      }
      if (id === "talk_to_human") {
        // Need a session id to ask the server about agents.
        if (!dbSessionId) return;
        try {
          const res = await fetch(
            `/api/sessions/${dbSessionId}/request-human`,
            { method: "POST" }
          );
          const data = await res.json().catch(() => ({}));
          if (data.status === "queued_for_human") {
            setHumanBannerVisible(true);
          } else if (data.status === "needs_email") {
            setChipForm("email_capture");
          }
        } catch {
          // Network failure — fall back to email capture so we don't strand
          // the customer with a tap that did nothing.
          setChipForm("email_capture");
        }
        return;
      }
      const canned = CHIP_AUTOSEND[id];
      if (canned) void sendMessage(canned);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dbSessionId]
  );

  const submitTireFitment = useCallback((payload: TireFitmentPayload) => {
    const url = tireCatalogUrlForRidingType(payload.ridingType);
    const content = `Thanks — for a **${payload.year} ${payload.make} ${payload.model}** used for **${payload.ridingType}**, the team can confirm exact fitment and recommend the right **Continental / Dunlop / Metzeler / Michelin / MotoZ / Shinko** options.\n\nStop by 7375 S Fulton St in Centennial for in-store fitment, or browse the catalog at ${url} filtered to your bike's category. Want me to connect you to the team for a specific recommendation?`;
    const msg = {
      id: `notice-${Date.now()}`,
      role: "ai" as const,
      content,
      sentAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, msg]);
    setSessionState((p) => resolveSessionState(p, "ai"));
    setTireContext(payload);
  }, []);

  const handleActionChip = useCallback(
    async (id: string) => {
      if (id !== "connect_team") return;
      if (!dbSessionIdRef.current || !tireContext) return;
      try {
        const res = await fetch(`/api/sessions/${dbSessionIdRef.current}/tire-escalate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tire: tireContext }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          appendLocalError(
            typeof data.error === "string"
              ? data.error
              : "Couldn't connect you to the team right now."
          );
          return;
        }
        setHumanBannerVisible(true);
        setTireContext(null);
      } catch {
        appendLocalError("Network error. Please try again.");
      }
    },
    [appendLocalError, tireContext]
  );

  // ── Status banner for the customer ─────────────────────────────────────────
  const renderStatusBanner = () => {
    if (humanBannerVisible) {
      return (
        <div
          className="flex items-center gap-2 py-2 px-3 mx-1 my-1 bg-emerald-50 rounded-lg border border-emerald-100"
          data-testid="connecting-human-banner"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0 animate-pulse" />
          <span className="text-xs text-emerald-700">
            Connecting you to a human — hang tight.
          </span>
        </div>
      );
    }
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
          <div className="text-center py-8">
            <div className="w-12 h-12 bg-accent/10 rounded-full flex items-center justify-center mx-auto mb-3">
              <span className="text-accent text-lg">👋</span>
            </div>
            <p className="text-sm text-text-secondary">
              Welcome to Performance Cycle! How can we help you today?
            </p>
          </div>
        )}
        {messages.length === 0 &&
          (sessionState === "idle" || sessionState === "waiting") &&
          chipForm === "none" && (
            <QuickReplyChips onSelect={handleChip} disabled={sending} />
          )}
        {chipForm === "order_lookup" && dbSessionId && (
          <OrderLookupForm
            sessionId={dbSessionId}
            onClose={() => setChipForm("none")}
          />
        )}
        {chipForm === "email_capture" && dbSessionId && (
          <EmailCaptureForm
            sessionId={dbSessionId}
            onClose={() => setChipForm("none")}
          />
        )}
        {chipForm === "tech_air" && dbSessionId && (
          <TechAirRequestForm
            sessionId={dbSessionId}
            onClose={() => setChipForm("none")}
          />
        )}
        {chipForm === "tire_fitment" && (
          <TireFitmentForm
            onClose={() => setChipForm("none")}
            onSubmit={submitTireFitment}
          />
        )}
        {messages.map((msg) => (
          <MessageBubble
            key={msg.id}
            role={msg.role}
            content={msg.content}
            sentAt={msg.sentAt}
            agentName={msg.agentName}
            personaName={persona.name}
            personaAvatarUrl={persona.avatarUrl}
          />
        ))}
        {tireContext && (
          <ActionChips
            testId="tire-fitment-actions"
            chips={[
              {
                id: "connect_team",
                label: "Connect me to the team",
                icon: Headphones,
              },
            ]}
            onSelect={handleActionChip}
          />
        )}
        {renderStatusBanner()}
        {waitingForReply && sessionState !== "waiting" && (
          <div className="flex items-center gap-1.5 py-2 px-1">
            <div className="w-7 h-7 bg-gray-100 rounded-full flex items-center justify-center">
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
        {sessionState === "closed" && dbSessionId ? (
          <EndOfSessionCard
            sessionId={dbSessionId}
            onStartNew={startNewSession}
          />
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
              className="flex-1 px-3.5 py-2.5 text-sm border border-border rounded-none focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent bg-background"
            />
            <button
              type="button"
              onClick={() => void sendMessage()}
              disabled={!input.trim() || sending}
              aria-busy={sending}
              aria-label="Send message"
              data-testid="chat-send"
              className={`w-10 h-10 rounded-button flex items-center justify-center transition-colors text-white shrink-0 ${
                !input.trim()
                  ? "bg-accent/35 cursor-not-allowed opacity-60"
                  : sending
                    ? "bg-accent/80 cursor-wait"
                    : "bg-accent hover:bg-accent-hover"
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
