"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import ChatHeader from "./ChatHeader";
import MessageBubble from "./MessageBubble";
import { Send } from "lucide-react";

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

export default function ChatWidget() {
  const searchParams = useSearchParams();
  const sessionId = searchParams.get("sessionId") || "";
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [pageContext, setPageContext] = useState<PageContext | null>(null);
  const [agentClaimed, setAgentClaimed] = useState(false);
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
    if (!sessionId || initialized.current) return;
    initialized.current = true;

    fetch(`/api/sessions/${sessionId}/messages`)
      .then((res) => (res.ok ? res.json() : { messages: [] }))
      .then((data) => {
        if (data.messages?.length) setMessages(data.messages);
      })
      .catch(() => {});
  }, [sessionId]);

  const subscribeToChannel = useCallback(() => {
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
      channel.bind("session-claimed", () => {
        setAgentClaimed(true);
        if (fallbackTimerRef.current) {
          clearTimeout(fallbackTimerRef.current);
          fallbackTimerRef.current = null;
        }
      });
      cleanup = () => {
        channel.unbind_all();
        pusher.unsubscribe(`session-${sessionId}`);
      };
    });
    return cleanup;
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId) return;
    const cleanup = subscribeToChannel();
    return () => cleanup();
  }, [sessionId, subscribeToChannel]);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  const triggerAIFallback = async (latestMessage: string) => {
    try {
      await fetch("/api/chat/ai-fallback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          latestMessage,
          pageContext,
        }),
      });
    } catch {
      // AI fallback will be retried on next message
    }
  };

  const sendMessage = async () => {
    if (!input.trim() || sending) return;
    const content = input.trim();
    setInput("");
    setSending(true);

    window.parent.postMessage({ type: "pc-chat-send" }, "*");

    const tempMsg: Message = {
      id: "temp-" + Date.now(),
      role: "customer",
      content,
      sentAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, tempMsg]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: content,
          sessionId,
          pageContext,
        }),
      });
      const data = await res.json();
      if (data.message) {
        setMessages((prev) =>
          prev.map((m) => (m.id === tempMsg.id ? data.message : m))
        );
      }

      if (data.sessionStatus !== "active_human" && !agentClaimed) {
        if (fallbackTimerRef.current) clearTimeout(fallbackTimerRef.current);
        fallbackTimerRef.current = setTimeout(() => {
          triggerAIFallback(content);
        }, 60000);
      }
    } catch {
      // keep temp message visible
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex flex-col h-screen bg-background">
      <ChatHeader />
      <div
        ref={scrollRef}
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
