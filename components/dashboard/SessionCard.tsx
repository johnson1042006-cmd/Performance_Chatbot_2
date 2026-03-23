"use client";

import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import PageContextBadge from "./PageContextBadge";
import { Clock } from "lucide-react";

interface SessionCardProps {
  session: {
    id: string;
    customerIdentifier: string;
    pageContext: Record<string, unknown> | null;
    startedAt: string;
    status: string;
    claimedByUserId: string | null;
  };
  isActive?: boolean;
  onClaim?: (sessionId: string) => void;
  onSelect?: (sessionId: string) => void;
}

function getDisplayName(identifier: string): string {
  if (identifier.startsWith("Customer #")) return identifier;
  // Generate a short friendly name from non-standard identifiers
  const hash = identifier.slice(-4).toUpperCase();
  return `Customer ${hash}`;
}

function getWaitTime(startedAt: string): { text: string; variant: "success" | "warning" | "danger" } {
  const seconds = Math.floor(
    (Date.now() - new Date(startedAt).getTime()) / 1000
  );
  if (seconds < 60) {
    return { text: `${seconds}s`, variant: "success" };
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 5) {
    return { text: `${minutes}m ${seconds % 60}s`, variant: seconds < 90 ? "success" : "warning" };
  }
  return { text: `${minutes}m`, variant: "danger" };
}

export default function SessionCard({
  session,
  isActive,
  onClaim,
  onSelect,
}: SessionCardProps) {
  const wait = getWaitTime(session.startedAt);
  const statusBadge = {
    waiting: { label: "Waiting", variant: "warning" as const },
    active_human: { label: "Human", variant: "success" as const },
    active_ai: { label: "AI Active", variant: "ai" as const },
    closed: { label: "Closed", variant: "default" as const },
  }[session.status] || { label: session.status, variant: "default" as const };

  return (
    <div
      onClick={() => onSelect?.(session.id)}
      className={`p-3 border-b border-border cursor-pointer transition-colors hover:bg-background ${
        isActive ? "bg-accent/5 border-l-2 border-l-accent" : ""
      }`}
    >
      <div className="flex items-start justify-between mb-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-text-primary truncate">
            {getDisplayName(session.customerIdentifier)}
          </p>
          <div className="flex items-center gap-2 mt-1">
            <Badge variant={statusBadge.variant} dot>
              {statusBadge.label}
            </Badge>
            <span className="flex items-center gap-1 text-xs text-text-secondary">
              <Clock size={10} />
              {wait.text}
            </span>
          </div>
        </div>
      </div>

      <PageContextBadge
        pageContext={session.pageContext as Parameters<typeof PageContextBadge>[0]["pageContext"]}
        compact
      />

      {session.status === "waiting" && onClaim && (
        <Button
          variant="primary"
          size="sm"
          className="mt-2 w-full"
          onClick={(e) => {
            e.stopPropagation();
            onClaim(session.id);
          }}
        >
          Claim Chat
        </Button>
      )}
    </div>
  );
}
