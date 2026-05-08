"use client";

import { X } from "lucide-react";
import SlaPill from "./SlaPill";

export interface PinnedChatTab {
  id: string;
  customerIdentifier?: string;
  lastCustomerActivityAt?: string | null;
}

interface ChatTabStripProps {
  tabs: PinnedChatTab[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
}

function getDisplayName(identifier?: string): string {
  if (!identifier) return "Customer";
  if (identifier.startsWith("Customer #")) return identifier;
  const hash = identifier.slice(-4).toUpperCase();
  return `Customer ${hash}`;
}

/**
 * Phase 4 multi-chat tab strip. Renders one tab per pinned/claimed session.
 * Each tab shows the customer name + an SLA pill and an X button. Switching
 * tabs swaps the active session.
 */
export default function ChatTabStrip({
  tabs,
  activeId,
  onSelect,
  onClose,
}: ChatTabStripProps) {
  if (tabs.length === 0) return null;

  return (
    <div
      role="tablist"
      data-testid="chat-tab-strip"
      className="shrink-0 flex items-stretch border-b border-border bg-surface overflow-x-auto"
    >
      {tabs.map((t) => {
        const name = getDisplayName(t.customerIdentifier);
        const active = t.id === activeId;
        return (
          <div
            key={t.id}
            data-testid="chat-tab"
            role="tab"
            aria-selected={active}
            aria-label={`Chat tab for ${name}`}
            className={`flex items-center gap-2 px-3 py-2 border-r border-border cursor-pointer min-w-[160px] ${
              active
                ? "bg-background border-b-2 border-b-accent"
                : "hover:bg-background/60"
            }`}
            onClick={() => onSelect(t.id)}
          >
            <span
              className="text-xs font-medium text-text-primary truncate"
              data-testid="chat-tab-name"
            >
              {name}
            </span>
            <SlaPill
              lastCustomerActivityAt={t.lastCustomerActivityAt}
              compact
            />
            <button
              type="button"
              aria-label={`Close tab for ${name}`}
              data-testid="chat-tab-close"
              onClick={(e) => {
                e.stopPropagation();
                onClose(t.id);
              }}
              className="text-text-secondary hover:text-text-primary ml-auto"
            >
              <X size={12} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
