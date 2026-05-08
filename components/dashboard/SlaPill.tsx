"use client";

import { useEffect, useState } from "react";
import { Clock } from "lucide-react";
import {
  slaAriaLabel,
  slaColorClass,
  slaText,
  slaTier,
} from "@/lib/utils/sla";

interface SlaPillProps {
  /** ISO string of last customer message / activity. Null is treated as "no activity yet". */
  lastCustomerActivityAt?: string | null;
  /** When set, the pill won't update past this seconds value (useful for closed sessions). */
  freezeAt?: number;
  compact?: boolean;
}

export default function SlaPill({
  lastCustomerActivityAt,
  freezeAt,
  compact = false,
}: SlaPillProps) {
  const [seconds, setSeconds] = useState(() => computeSeconds(lastCustomerActivityAt));

  useEffect(() => {
    setSeconds(computeSeconds(lastCustomerActivityAt));
    if (typeof freezeAt === "number") return;
    const id = setInterval(() => {
      setSeconds(computeSeconds(lastCustomerActivityAt));
    }, 1000);
    return () => clearInterval(id);
  }, [lastCustomerActivityAt, freezeAt]);

  const display = typeof freezeAt === "number" ? freezeAt : seconds;
  const tier = slaTier(display);

  return (
    <span
      role="status"
      aria-label={slaAriaLabel(display)}
      data-testid="sla-pill"
      data-sla-tier={tier}
      className={`inline-flex items-center gap-1 rounded-full border ${slaColorClass(
        tier
      )} ${compact ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-xs"}`}
    >
      <Clock size={compact ? 9 : 11} className="shrink-0" />
      {slaText(display)}
    </span>
  );
}

function computeSeconds(iso: string | null | undefined): number {
  if (!iso) return 0;
  try {
    const t = new Date(iso).getTime();
    if (Number.isNaN(t)) return 0;
    return Math.max(0, Math.floor((Date.now() - t) / 1000));
  } catch {
    return 0;
  }
}
