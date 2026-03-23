"use client";

import { useRef, useEffect } from "react";
import Badge from "@/components/ui/Badge";
import { renderMarkdown } from "@/lib/utils/renderMarkdown";

interface Message {
  id: string;
  role: "customer" | "agent" | "ai";
  content: string;
  sentAt: string;
  agentName?: string;
}

interface MessageThreadProps {
  messages: Message[];
}

export default function MessageThread({ messages }: MessageThreadProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

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
                <span dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }} />
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
