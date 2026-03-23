import { renderMarkdown } from "@/lib/utils/renderMarkdown";

interface MessageBubbleProps {
  role: "customer" | "agent" | "ai";
  content: string;
  agentName?: string;
  sentAt?: string;
}

export default function MessageBubble({
  role,
  content,
  agentName,
  sentAt,
}: MessageBubbleProps) {
  const isCustomer = role === "customer";
  const isAI = role === "ai";

  return (
    <div className={`flex ${isCustomer ? "justify-end" : "justify-start"} mb-3`}>
      <div className="max-w-[80%]">
        {!isCustomer && (
          <div className="flex items-center gap-1.5 mb-1">
            {isAI && (
              <span className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium rounded bg-purple-100 text-purple-700">
                AI
              </span>
            )}
            <span className="text-xs text-text-secondary">
              {isAI ? "AI Assistant" : agentName || "Agent"}
            </span>
          </div>
        )}
        <div
          className={`px-3.5 py-2.5 text-sm leading-relaxed ${
            isCustomer
              ? "bg-accent text-white rounded-2xl rounded-br-md"
              : isAI
              ? "bg-white border border-purple-200 rounded-2xl rounded-bl-md border-l-2 border-l-ai-badge"
              : "bg-white border border-border rounded-2xl rounded-bl-md"
          }`}
        >
          <span dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }} />
        </div>
        {sentAt && (
          <span
            className={`text-[10px] text-text-secondary mt-1 block ${
              isCustomer ? "text-right" : "text-left"
            }`}
          >
            {new Date(sentAt).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        )}
      </div>
    </div>
  );
}
