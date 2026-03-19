import Card from "@/components/ui/Card";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

interface MetricCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  trend?: { direction: "up" | "down" | "flat"; label: string };
  accent?: boolean;
}

export default function MetricCard({
  title,
  value,
  subtitle,
  trend,
  accent,
}: MetricCardProps) {
  const TrendIcon =
    trend?.direction === "up"
      ? TrendingUp
      : trend?.direction === "down"
      ? TrendingDown
      : Minus;

  const trendColor =
    trend?.direction === "up"
      ? "text-success"
      : trend?.direction === "down"
      ? "text-accent"
      : "text-text-secondary";

  return (
    <Card className={accent ? "border-l-4 border-l-accent" : ""}>
      <p className="text-sm text-text-secondary mb-1">{title}</p>
      <p className="text-2xl font-semibold text-text-primary">{value}</p>
      {(subtitle || trend) && (
        <div className="flex items-center gap-2 mt-1">
          {trend && (
            <span className={`flex items-center gap-0.5 text-xs ${trendColor}`}>
              <TrendIcon size={12} />
              {trend.label}
            </span>
          )}
          {subtitle && (
            <span className="text-xs text-text-secondary">{subtitle}</span>
          )}
        </div>
      )}
    </Card>
  );
}
