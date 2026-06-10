"use client";

import { useRef, useEffect } from "react";
import Badge from "@/components/ui/Badge";
import { Skeleton } from "@/components/ui/Skeleton";
import MarkdownMessage from "@/components/chat/MarkdownMessage";

interface Message {
  id: string;
  role: "customer" | "agent" | "ai";
  content: string;
  sentAt: string;
  agentName?: string;
}

interface MessageThreadProps {
  messages: Message[];
  /** Shows skeleton bubbles while the initial fetch is in flight. */
  loading?: boolean;
}

export default function MessageThread({ messages, loading = false }: MessageThreadProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  if (loading && messages.length === 0) {
    return (
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        <div className="flex justify-end">
          <Skeleton className="h-10 w-1/2 rounded-xl" />
        </div>
        <div className="flex justify-start">
          <Skeleton className="h-16 w-2/3 rounded-xl" />
        </div>
        <div className="flex justify-end">
          <Skeleton className="h-10 w-2/5 rounded-xl" />
        </div>
      </div>
    );
  }

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
      {messages.map((msg) => {
        const isCustomer = msg.role === "customer";
        const isAI = msg.role === "ai";

        return (
          <div
            key={msg.id}
            className={`flex ${isCustomer ? "justify-end" : "justify-start"}`}
          >
            <div className="max-w-[75%]">
              {!isCustomer && (
                <div className="flex items-center gap-1.5 mb-1">
                  {isAI ? (
                    <Badge variant="ai">AI</Badge>
                  ) : (
                    <span className="text-xs font-medium text-text-primary">
                      {msg.agentName || "Agent"}
                    </span>
                  )}
                  <span className="text-[10px] text-text-secondary">
                    {new Date(msg.sentAt).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
              )}
              <div
                className={`px-3.5 py-2.5 text-sm leading-relaxed rounded-xl ${
                  isCustomer
                    ? "bg-gray-100 text-text-primary rounded-br-sm"
                    : isAI
                    ? "bg-purple-50 border border-purple-200 rounded-bl-sm"
                    : "bg-surface border border-border rounded-bl-sm"
                }`}
              >
                <MarkdownMessage content={msg.content} />
              </div>
              {isCustomer && (
                <span className="text-[10px] text-text-secondary mt-0.5 block text-right">
                  {new Date(msg.sentAt).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
