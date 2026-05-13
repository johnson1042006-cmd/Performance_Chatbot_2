"use client";

import {
  Package,
  RotateCcw,
  HardHat,
  Shield,
  Disc,
  Headphones,
  type LucideIcon,
} from "lucide-react";

export type QuickReplyChipId =
  | "track_order"
  | "return_exchange"
  | "helmet_sizing"
  | "tech_air"
  | "find_tires"
  | "talk_to_human";

interface ChipDef {
  id: QuickReplyChipId;
  label: string;
  // Lucide-react icon component. Kept inline here so the chip row owns its
  // visual definition; ChatWidget just dispatches on `id`.
  icon: LucideIcon;
}

const CHIPS: ChipDef[] = [
  { id: "track_order", label: "Track an order", icon: Package },
  { id: "return_exchange", label: "Start a return / exchange", icon: RotateCcw },
  { id: "helmet_sizing", label: "Helmet sizing help", icon: HardHat },
  { id: "tech_air", label: "Tech-Air service", icon: Shield },
  { id: "find_tires", label: "Find tires for my bike", icon: Disc },
  { id: "talk_to_human", label: "Talk to a human", icon: Headphones },
];

interface Props {
  onSelect: (id: QuickReplyChipId) => void;
  disabled?: boolean;
}

export default function QuickReplyChips({ onSelect, disabled }: Props) {
  return (
    <div
      className="flex flex-wrap gap-1.5 px-1 py-2"
      data-testid="quick-reply-chips"
    >
      {CHIPS.map((chip) => {
        const Icon = chip.icon;
        return (
          <button
            key={chip.id}
            type="button"
            disabled={disabled}
            data-testid={`chip-${chip.id}`}
            onClick={() => onSelect(chip.id)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-full bg-white border border-border text-text-primary hover:bg-accent/5 hover:border-accent/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Icon size={13} />
            {chip.label}
          </button>
        );
      })}
    </div>
  );
}
