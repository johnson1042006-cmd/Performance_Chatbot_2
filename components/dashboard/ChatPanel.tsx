"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useSession } from "next-auth/react";
import MessageThread from "./MessageThread";
import PageContextBadge from "./PageContextBadge";
import Button from "@/components/ui/Button";
import { Send, Bot, UserCheck, X } from "lucide-react";

interface Message {
  id: string;
  role: "customer" | "agent" | "ai";
  content: string;
  sentAt: string;
  agentName?: string;
}

interface ChatPanelProps {
  sessionId: string;
  sessionStatus: string;
  pageContext: Record<string, unknown> | null;
  onRelease: (sessionId: string) => void;
  onClaim: (sessionId: string) => void;
  onClose: (sessionId: string) => void;
}

export default function ChatPanel({
  sessionId,
  sessionStatus,
  pageContext,
  onRelease,
  onClaim,
  onClose,
}: ChatPanelProps) {
  const { data: authSession } = useSession();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const pollRef = useRef<NodeJS.Timeout | null>(null);

  const fetchMessages = useCallback(async () => {
    try {
      const res = await fetch(`/api/sessions/${sessionId}/messages`);
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
      cleanup = () => {
        channel.unbind_all();
        pusher.unsubscribe(`session-${sessionId}`);
      };
    }).catch(() => {
      // Pusher unavailable — handled by polling below
    });
    return () => cleanup();
  }, [sessionId]);

  // Polling fallback — refresh messages every 3 seconds
  useEffect(() => {
    pollRef.current = setInterval(fetchMessages, 3000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [fetchMessages]);

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

  const isHuman = sessionStatus === "active_human";

  return (
    <div className="flex flex-col h-full">
      <div className="shrink-0 border-b border-border p-3 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {isHuman ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => onRelease(sessionId)}
              >
                <Bot size={14} className="mr-1.5" />
                Hand to AI
              </Button>
            ) : (
              <Button
                variant="primary"
                size="sm"
                onClick={() => onClaim(sessionId)}
              >
                <UserCheck size={14} className="mr-1.5" />
                Take Over
              </Button>
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onClose(sessionId)}
          >
            <X size={14} className="mr-1" />
            Close
          </Button>
        </div>
        <PageContextBadge
          pageContext={pageContext as Parameters<typeof PageContextBadge>[0]["pageContext"]}
        />
      </div>

      <MessageThread messages={messages} />

      {isHuman && (
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

      {!isHuman && (
        <div className="shrink-0 border-t border-border bg-purple-50 px-4 py-3 text-center">
          <p className="text-xs text-purple-700">
            AI is handling this conversation. Click &quot;Take Over&quot; to respond as a human.
          </p>
        </div>
      )}
    </div>
  );
}
