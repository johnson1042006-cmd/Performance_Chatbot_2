"use client";

import { useEffect, useRef, useState } from "react";
import Button from "@/components/ui/Button";
import { X } from "lucide-react";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  /** Body copy under the title. */
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Renders the confirm button in the destructive style. */
  destructive?: boolean;
  /**
   * When set, renders a text input (prompt-style dialog). The entered value
   * is passed to onConfirm; confirm is disabled while it is empty.
   */
  inputLabel?: string;
  inputPlaceholder?: string;
  busy?: boolean;
  onConfirm: (inputValue?: string) => void;
  onCancel: () => void;
}

/**
 * Shared confirmation/prompt modal — replaces window.confirm / window.prompt
 * so destructive actions look consistent with the rest of the dashboard.
 * Closes on Escape and backdrop click.
 */
export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  inputLabel,
  inputPlaceholder,
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const [inputValue, setInputValue] = useState("");
  const confirmRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setInputValue("");
    // Focus the input (prompt mode) or the confirm button.
    const t = setTimeout(() => {
      if (inputLabel) inputRef.current?.focus();
      else confirmRef.current?.focus();
    }, 0);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, inputLabel, onCancel]);

  if (!open) return null;

  const confirmDisabled = busy || (!!inputLabel && !inputValue.trim());

  const handleConfirm = () => {
    if (confirmDisabled) return;
    onConfirm(inputLabel ? inputValue.trim() : undefined);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="absolute inset-0 bg-black/30" onClick={onCancel} />
      <div className="relative bg-surface rounded-card shadow-card-lg w-full max-w-sm p-6">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-base font-semibold text-text-primary">{title}</h2>
          <button
            onClick={onCancel}
            aria-label="Close dialog"
            className="text-text-secondary hover:text-text-primary transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {message && (
          <p className="text-sm text-text-secondary mb-4">{message}</p>
        )}

        {inputLabel && (
          <div className="mb-4">
            <label className="block text-sm font-medium text-text-primary mb-1">
              {inputLabel}
            </label>
            <input
              ref={inputRef}
              type="text"
              value={inputValue}
              placeholder={inputPlaceholder}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleConfirm();
                }
              }}
              className="w-full px-3 py-2 text-sm border border-border rounded-button focus:outline-none focus:ring-2 focus:ring-accent/20"
            />
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="secondary" size="sm" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button
            ref={confirmRef}
            type="button"
            size="sm"
            variant={destructive ? "danger" : "primary"}
            disabled={confirmDisabled}
            onClick={handleConfirm}
          >
            {busy ? "Working..." : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
