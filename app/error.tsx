"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import Button from "@/components/ui/Button";

/**
 * Root error boundary — catches any unhandled render/runtime error so the
 * app never white-screens. Offers a retry (re-renders the segment) and a
 * way back to safety.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Unhandled application error:", error);
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="max-w-md w-full bg-surface rounded-card shadow-card-md border border-border p-8 text-center">
        <div className="mx-auto w-12 h-12 rounded-full bg-red-50 flex items-center justify-center mb-4">
          <AlertTriangle className="text-red-500" size={24} />
        </div>
        <h1 className="text-lg font-semibold text-text-primary mb-2">
          Something went wrong
        </h1>
        <p className="text-sm text-text-secondary mb-6">
          An unexpected error occurred. Your data is safe — try again, or head
          back to the home page.
        </p>
        <div className="flex items-center justify-center gap-2">
          <Button onClick={reset}>Try again</Button>
          <Button
            variant="secondary"
            onClick={() => {
              window.location.href = "/";
            }}
          >
            Go home
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
