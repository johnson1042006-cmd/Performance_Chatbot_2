"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import Button from "@/components/ui/Button";

/**
 * Dashboard error boundary — a crash in any dashboard page is contained
 * here instead of white-screening the whole app. The sidebar layout above
 * this segment keeps rendering.
 */
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Dashboard error:", error);
  }, [error]);

  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <div className="max-w-md w-full bg-surface rounded-card shadow-card-md border border-border p-8 text-center">
        <div className="mx-auto w-12 h-12 rounded-full bg-red-50 flex items-center justify-center mb-4">
          <AlertTriangle className="text-red-500" size={24} />
        </div>
        <h2 className="text-lg font-semibold text-text-primary mb-2">
          This page hit a snag
        </h2>
        <p className="text-sm text-text-secondary mb-6">
          The rest of the dashboard is still running. Try reloading this page
          — if it keeps happening, let your administrator know.
        </p>
        <div className="flex items-center justify-center gap-2">
          <Button onClick={reset}>Reload page</Button>
          <Button
            variant="secondary"
            onClick={() => {
              window.location.href = "/dashboard";
            }}
          >
            Back to dashboard
          </Button>
        </div>
        {error.digest && (
          <p className="mt-4 text-[11px] text-text-secondary/70 font-mono">
            Error ID: {error.digest}
          </p>
        )}
      </div>
    </div>
  );
}
