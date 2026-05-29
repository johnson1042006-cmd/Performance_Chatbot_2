"use client";

import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import PageContextBadge from "./PageContextBadge";
import LocationBadge from "./LocationBadge";
import SlaPill from "./SlaPill";
import { UserCheck } from "lucide-react";

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
    lastCustomerActivityAt?: string | null;
    customerCity?: string | null;
    customerRegion?: string | null;
    customerCountry?: string | null;
    qualityFlag?: {
      lowConfidenceLatest: boolean;
      negativeSentimentEver: boolean;
    };
    pendingHuman?: boolean;
  };
  isActive?: boolean;
  isKeyboardSelected?: boolean;
  onClaim?: (sessionId: string) => void;
  onSelect?: (sessionId: string) => void;
}

function getDisplayName(identifier: string): string {
  if (identifier.startsWith("Customer #")) return identifier;
  const hash = identifier.slice(-4).toUpperCase();
  return `Customer ${hash}`;
}

export default function SessionCard({
  session,
  isActive,
  isKeyboardSelected,
  onClaim,
  onSelect,
}: SessionCardProps) {
  const isUnclaimed = session.status === "waiting" || !session.claimedByKind;
  const isAi = session.claimedByKind === "ai" || session.status === "active_ai";
  const isHuman = session.claimedByKind === "human" || session.status === "active_human";

  const needsHuman =
    session.pendingHuman === true && session.status === "active_ai";

  const statusBadge = isUnclaimed
    ? { label: "In Queue", variant: "warning" as const }
    : needsHuman
    ? { label: "Needs human", variant: "warning" as const }
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
      data-testid="session-card"
      className={`p-3 border-b border-border cursor-pointer transition-colors hover:bg-background ${
        isActive ? `bg-accent/5 border-l-2 ${borderColor || "border-l-accent"}` : ""
      } ${
        isKeyboardSelected && !isActive
          ? "ring-2 ring-accent/40 ring-inset"
          : ""
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
            {!isUnclaimed && (
              <SlaPill
                lastCustomerActivityAt={session.lastCustomerActivityAt}
                compact
              />
            )}
            {isUnclaimed && (
              <SlaPill
                lastCustomerActivityAt={session.startedAt}
                compact
              />
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

      <div className="flex items-center gap-2 flex-wrap">
        <PageContextBadge
          pageContext={session.pageContext as Parameters<typeof PageContextBadge>[0]["pageContext"]}
          compact
        />
        <LocationBadge
          city={session.customerCity}
          region={session.customerRegion}
          country={session.customerCountry}
          compact
        />
      </div>

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
