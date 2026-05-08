"use client";

import { type LucideIcon } from "lucide-react";

export interface ActionChip {
  id: string;
  label: string;
  icon?: LucideIcon;
  disabled?: boolean;
}

interface Props {
  chips: ActionChip[];
  onSelect: (id: string) => void;
  testId?: string;
}

export default function ActionChips({ chips, onSelect, testId }: Props) {
  return (
    <div className="flex flex-wrap gap-1.5 px-1 py-2" data-testid={testId}>
      {chips.map((chip) => {
        const Icon = chip.icon;
        return (
          <button
            key={chip.id}
            type="button"
            disabled={chip.disabled}
            data-testid={`action-chip-${chip.id}`}
            onClick={() => onSelect(chip.id)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-full bg-white border border-border text-text-primary hover:bg-accent/5 hover:border-accent/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {Icon ? <Icon size={13} /> : null}
            {chip.label}
          </button>
        );
      })}
    </div>
  );
}

