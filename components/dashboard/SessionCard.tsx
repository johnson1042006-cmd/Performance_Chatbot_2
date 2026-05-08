"use client";

import { useEffect, useState } from "react";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import PageContextBadge from "./PageContextBadge";
import { Clock, UserCheck } from "lucide-react";

interface SessionCardProps {
  session: {
    id: string;
    customerIdentifier: string;
    pageContext: Record<string, unknown> | null;
    startedAt: string;
    status: string;
    claimedByUserId: string | null;
    claimedByKind?: string | null;
    claimedBy?: { id: string; name: string } | null;
    waitSeconds?: number;
    // Phase 3: derived quality indicator computed in /api/sessions GET.
    qualityFlag?: {
      lowConfidenceLatest: boolean;
      negativeSentimentEver: boolean;
    };
  };
  isActive?: boolean;
  onClaim?: (sessionId: string) => void;
  onSelect?: (sessionId: string) => void;
}

function getDisplayName(identifier: string): string {
  if (identifier.startsWith("Customer #")) return identifier;
  const hash = identifier.slice(-4).toUpperCase();
  return `Customer ${hash}`;
}

function useWaitTimer(startedAt: string) {
  const [seconds, setSeconds] = useState(() =>
    Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000)
  );

  useEffect(() => {
    const id = setInterval(() => {
      setSeconds(Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  return seconds;
}

function formatWait(seconds: number): { text: string; variant: "success" | "warning" | "danger" } {
  if (seconds < 60) return { text: `${seconds}s`, variant: "success" };
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 5) return { text: `${m}m ${s}s`, variant: seconds < 90 ? "success" : "warning" };
  return { text: `${m}m`, variant: "danger" };
}

export default function SessionCard({
  session,
  isActive,
  onClaim,
  onSelect,
}: SessionCardProps) {
  const waitSeconds = useWaitTimer(session.startedAt);
  const wait = formatWait(waitSeconds);

  const isUnclaimed = session.status === "waiting" || !session.claimedByKind;
  const isAi = session.claimedByKind === "ai" || session.status === "active_ai";
  const isHuman = session.claimedByKind === "human" || session.status === "active_human";

  const statusBadge = isUnclaimed
    ? { label: "In Queue", variant: "warning" as const }
    : isAi
    ? { label: "AI Active", variant: "ai" as const }
    : isHuman
    ? { label: "Human Active", variant: "success" as const }
    : { label: session.status, variant: "default" as const };

  const borderColor = isUnclaimed
    ? "border-l-amber-400"
    : isAi
    ? "border-l-purple-400"
    : isHuman
    ? "border-l-emerald-400"
    : "";

  return (
    <div
      onClick={() => onSelect?.(session.id)}
      className={`p-3 border-b border-border cursor-pointer transition-colors hover:bg-background ${
        isActive ? `bg-accent/5 border-l-2 ${borderColor || "border-l-accent"}` : ""
      }`}
    >
      <div className="flex items-start justify-between mb-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-text-primary truncate flex items-center gap-1.5">
            {getDisplayName(session.customerIdentifier)}
            {(session.qualityFlag?.lowConfidenceLatest ||
              session.qualityFlag?.negativeSentimentEver) && (
              <span
                data-testid="session-quality-flag"
                title={
                  session.qualityFlag?.negativeSentimentEver
                    ? "Customer frustration detected"
                    : "AI low-confidence reply"
                }
                className="inline-block w-1.5 h-1.5 rounded-full bg-red-500 shrink-0"
              />
            )}
          </p>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <Badge variant={statusBadge.variant} dot>
              {statusBadge.label}
            </Badge>
            {isUnclaimed && (
              <span className={`flex items-center gap-1 text-xs font-medium ${
                wait.variant === "danger"
                  ? "text-red-600"
                  : wait.variant === "warning"
                  ? "text-amber-600"
                  : "text-text-secondary"
              }`}>
                <Clock size={10} />
                waiting {wait.text}
              </span>
            )}
            {(isAi || isHuman) && session.claimedBy && (
              <span className="flex items-center gap-1 text-xs text-text-secondary">
                <UserCheck size={10} />
                {isHuman ? session.claimedBy.name : "AI"}
              </span>
            )}
          </div>
        </div>
      </div>

      <PageContextBadge
        pageContext={session.pageContext as Parameters<typeof PageContextBadge>[0]["pageContext"]}
        compact
      />

      {isUnclaimed && onClaim && (
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
