"use client";

import { useState } from "react";
import { ThumbsUp, ThumbsDown, Mail, Loader2, Check } from "lucide-react";

interface Props {
  sessionId: string;
  onStartNew: () => void;
}

type FeedbackState = "pending" | "submitting" | "submitted";
type EmailState = "idle" | "form" | "submitting" | "submitted";

/**
 * Shown in place of the chat input when sessionState === "closed".
 * Two independent flows:
 *   1. Thumbs up/down + optional comment → POST /api/sessions/[id]/feedback
 *   2. Email transcript → POST /api/sessions/[id]/transcript-email
 *
 * Each flow has its own success state so the customer can do both, or
 * neither. The "Start a new chat" button is preserved so they can re-engage.
 */
export default function EndOfSessionCard({ sessionId, onStartNew }: Props) {
  const [rating, setRating] = useState<"up" | "down" | null>(null);
  const [comment, setComment] = useState("");
  const [feedbackState, setFeedbackState] = useState<FeedbackState>("pending");
  const [emailState, setEmailState] = useState<EmailState>("idle");
  const [emailValue, setEmailValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submitFeedback = async (chosenRating: "up" | "down") => {
    setRating(chosenRating);
    setFeedbackState("submitting");
    setError(null);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rating: chosenRating,
          comment: comment.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Couldn't save your feedback.");
        setFeedbackState("pending");
        return;
      }
      setFeedbackState("submitted");
    } catch {
      setError("Network error. Please try again.");
      setFeedbackState("pending");
    }
  };

  const submitTranscriptEmail = async () => {
    const trimmed = emailValue.trim();
    if (!trimmed) {
      setError("Please enter an email address.");
      return;
    }
    setEmailState("submitting");
    setError(null);
    try {
      const res = await fetch(
        `/api/sessions/${sessionId}/transcript-email`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: trimmed, consent: true }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Couldn't send the transcript.");
        setEmailState("form");
        return;
      }
      setEmailState("submitted");
    } catch {
      setError("Network error. Please try again.");
      setEmailState("form");
    }
  };

  return (
    <div
      className="flex flex-col gap-3 py-2"
      data-testid="end-of-session-card"
    >
      <p className="text-xs text-text-secondary text-center">
        This conversation has ended.
      </p>

      {/* CSAT */}
      {feedbackState === "submitted" ? (
        <div
          className="flex items-center justify-center gap-1.5 text-xs text-success"
          data-testid="feedback-thanks"
        >
          <Check size={14} />
          Thanks for your feedback!
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2">
          <p className="text-xs text-text-primary font-medium">
            How was this chat?
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => submitFeedback("up")}
              disabled={feedbackState === "submitting"}
              data-testid="feedback-up"
              className={`p-2 rounded-full border transition-colors ${
                rating === "up"
                  ? "bg-success/10 border-success text-success"
                  : "border-border text-text-secondary hover:border-accent hover:text-accent"
              }`}
              aria-label="Thumbs up"
            >
              <ThumbsUp size={16} />
            </button>
            <button
              type="button"
              onClick={() => submitFeedback("down")}
              disabled={feedbackState === "submitting"}
              data-testid="feedback-down"
              className={`p-2 rounded-full border transition-colors ${
                rating === "down"
                  ? "bg-red-50 border-red-400 text-red-500"
                  : "border-border text-text-secondary hover:border-accent hover:text-accent"
              }`}
              aria-label="Thumbs down"
            >
              <ThumbsDown size={16} />
            </button>
          </div>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Anything else we should know? (optional)"
            data-testid="feedback-comment"
            rows={2}
            className="w-full px-3 py-2 text-xs border border-border rounded-button focus:outline-none focus:ring-2 focus:ring-accent/20 resize-none"
          />
        </div>
      )}

      {/* Transcript email */}
      <div className="border-t border-border pt-2">
        {emailState === "submitted" ? (
          <div
            className="flex items-center justify-center gap-1.5 text-xs text-success"
            data-testid="transcript-sent"
          >
            <Check size={14} />
            Transcript sent — check your inbox.
          </div>
        ) : emailState === "idle" ? (
          <button
            type="button"
            onClick={() => setEmailState("form")}
            data-testid="transcript-button"
            className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium rounded-button border border-border text-text-primary hover:bg-accent/5 transition-colors"
          >
            <Mail size={13} />
            Email me a transcript
          </button>
        ) : (
          <div className="flex flex-col gap-2">
            <input
              type="email"
              value={emailValue}
              onChange={(e) => setEmailValue(e.target.value)}
              placeholder="your@email.com"
              data-testid="transcript-email-input"
              autoComplete="email"
              className="w-full px-3 py-2 text-xs border border-border rounded-button focus:outline-none focus:ring-2 focus:ring-accent/20"
            />
            <button
              type="button"
              onClick={submitTranscriptEmail}
              disabled={emailState === "submitting"}
              data-testid="transcript-submit"
              className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium rounded-button bg-accent text-white hover:bg-accent/90 transition-colors disabled:opacity-60"
            >
              {emailState === "submitting" ? (
                <>
                  <Loader2 size={13} className="animate-spin" /> Sending...
                </>
              ) : (
                "Send transcript"
              )}
            </button>
          </div>
        )}
      </div>

      {error && (
        <p className="text-xs text-red-600 text-center" data-testid="end-card-error">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={onStartNew}
        data-testid="chat-start-new"
        className="px-4 py-2 text-sm font-medium rounded-full bg-accent text-white hover:bg-accent/90 transition-colors mx-auto"
      >
        Start a new chat
      </button>
    </div>
  );
}
