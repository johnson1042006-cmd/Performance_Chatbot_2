import { renderMarkdown } from "@/lib/utils/renderMarkdown";

interface MessageBubbleProps {
  role: "customer" | "agent" | "ai";
  content: string;
  agentName?: string;
  sentAt?: string;
  // Persona props are pulled from /api/embed/config at the widget level and
  // forwarded here. Defaults match the seeded `bot_persona` knowledge_base
  // entry so the UI degrades gracefully if the config fetch fails.
  personaName?: string;
  personaAvatarUrl?: string;
}

export default function MessageBubble({
  role,
  content,
  agentName,
  sentAt,
  personaName,
  personaAvatarUrl,
}: MessageBubbleProps) {
  const isCustomer = role === "customer";
  const isAI = role === "ai";

  // For AI messages we display the persona (Jake) like a regular agent so the
  // customer doesn't feel like they're talking to a bot. The purple left
  // border and "AI" chip are intentionally gone — manager dashboard still
  // labels the message AI via the message-ai data-testid. Falls back to
  // "Assistant" if no persona was supplied.
  const displayName = isAI
    ? personaName || "Assistant"
    : agentName || "Agent";
  const displayAvatar = isAI ? personaAvatarUrl : undefined;
  const initials = displayName
    .split(" ")
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div
      className={`flex ${isCustomer ? "justify-end" : "justify-start"} mb-3`}
      data-testid={`message-${role}`}
    >
      <div className="max-w-[80%]">
        {!isCustomer && (
          <div className="flex items-center gap-1.5 mb-1">
            {displayAvatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={displayAvatar}
                alt={displayName}
                className="w-5 h-5 rounded-full bg-gray-200 object-cover"
              />
            ) : (
              <span className="w-5 h-5 rounded-full bg-gray-300 text-white text-[9px] font-semibold flex items-center justify-center">
                {initials || "?"}
              </span>
            )}
            <span className="text-xs text-text-secondary">{displayName}</span>
          </div>
        )}
        <div
          className={`px-3.5 py-2.5 text-sm leading-relaxed ${
            isCustomer
              ? "bg-accent-solid text-white rounded-2xl rounded-br-md"
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
