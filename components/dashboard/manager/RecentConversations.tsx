import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import PageContextBadge from "@/components/dashboard/PageContextBadge";
import { MessageSquare } from "lucide-react";

interface Session {
  id: string;
  customerIdentifier: string;
  pageContext: Record<string, unknown> | null;
  startedAt: string;
  status: string;
}

interface RecentConversationsProps {
  sessions: Session[];
}

export default function RecentConversations({
  sessions,
}: RecentConversationsProps) {
  const statusVariant = (status: string) => {
    switch (status) {
      case "waiting": return "warning" as const;
      case "active_human": return "success" as const;
      case "active_ai": return "ai" as const;
      case "closed": return "default" as const;
      default: return "default" as const;
    }
  };

  return (
    <Card>
      <div className="flex items-center gap-2 mb-4">
        <MessageSquare size={18} className="text-text-secondary" />
        <h3 className="font-semibold text-text-primary">
          Recent Conversations
        </h3>
      </div>

      {sessions.length === 0 ? (
        <div className="text-center py-8 text-text-secondary text-sm">
          No conversations yet
        </div>
      ) : (
        <div className="space-y-2">
          {sessions.map((s) => (
            <div
              key={s.id}
              className="flex items-center justify-between py-2 px-2 rounded-button hover:bg-background transition-colors"
            >
              <div className="flex items-center gap-3 min-w-0">
                <span className="text-sm text-text-primary truncate max-w-[120px]">
                  {s.customerIdentifier.startsWith("Customer #") ? s.customerIdentifier : `Customer ${s.customerIdentifier.slice(-4).toUpperCase()}`}
                </span>
                <PageContextBadge
                  pageContext={s.pageContext as Parameters<typeof PageContextBadge>[0]["pageContext"]}
                  compact
                />
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={statusVariant(s.status)} dot>
                  {s.status.replace("_", " ")}
                </Badge>
                <span className="text-xs text-text-secondary">
                  {new Date(s.startedAt).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
