"use client";

import { MapPin } from "lucide-react";

interface LocationBadgeProps {
  city?: string | null;
  region?: string | null;
  country?: string | null;
  compact?: boolean;
}

/**
 * Phase 4: agent-only location badge driven by Vercel's IP geolocation.
 * Renders "City, Region" when city is present, "Region, Country" if only
 * region is present, "Country" if only country, or "Unknown location"
 * gracefully when nothing is available. Never passed into any AI prompt —
 * the AI must not act on customer location.
 */
export default function LocationBadge({
  city,
  region,
  country,
  compact = false,
}: LocationBadgeProps) {
  const parts: string[] = [];
  if (city) parts.push(city);
  if (region) parts.push(region);
  if (parts.length === 0 && country) parts.push(country);

  const label = parts.length > 0 ? parts.join(", ") : "Unknown location";
  const isUnknown = parts.length === 0;

  return (
    <span
      data-testid="location-badge"
      className={`inline-flex items-center gap-1 rounded-full border ${
        isUnknown
          ? "border-border bg-background text-text-secondary"
          : "border-border bg-surface text-text-primary"
      } ${compact ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-xs"}`}
    >
      <MapPin size={compact ? 10 : 11} className="shrink-0" />
      <span className="truncate">{label}</span>
    </span>
  );
}
