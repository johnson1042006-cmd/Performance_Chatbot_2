"use client";

import { X } from "lucide-react";
import TranscriptList from "./TranscriptList";

interface TranscriptModalProps {
  sessionId: string;
  title?: string;
  onClose: () => void;
}

/**
 * Shared transcript viewer reused from Phase 4's customer history panel.
 * Wraps [TranscriptList] in a fixed overlay. Used by the manager search
 * and review-queue pages.
 */
export default function TranscriptModal({
  sessionId,
  title = "Transcript",
  onClose,
}: TranscriptModalProps) {
  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      onClick={onClose}
      data-testid="transcript-modal"
    >
      <div
        className="bg-surface rounded-card shadow-card-md max-w-3xl w-full max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h3 className="text-sm font-semibold">{title}</h3>
          <button
            onClick={onClose}
            className="text-text-secondary hover:text-text-primary"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          <TranscriptList sessionId={sessionId} />
        </div>
      </div>
    </div>
  );
}
