"use client";

import { useState } from "react";
import { Loader2, X } from "lucide-react";

interface Props {
  sessionId: string;
  /**
   * Called after the contact + notify-support flow succeeds. The widget
   * itself doesn't need to render a confirmation — the notify-support
   * route inserts an AI message that arrives via Pusher.
   */
  onCaptured?: () => void;
  onClose: () => void;
}

/**
 * Inline email-capture form rendered when the customer taps "Talk to a
 * human" and no agents are online. Two-step submit:
 *  1. POST /api/sessions/[id]/contact (with consent) to persist the email.
 *  2. POST /api/sessions/[id]/notify-support to email SUPPORT_INBOX and
 *     drop a customer-facing AI confirmation.
 */
export default function EmailCaptureForm({ sessionId, onCaptured, onClose }: Props) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setError("Please enter an email address.");
      return;
    }
    setSubmitting(true);
    try {
      const contactRes = await fetch(`/api/sessions/${sessionId}/contact`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: trimmedEmail,
          name: name.trim() || undefined,
          consent: true,
        }),
      });
      if (!contactRes.ok) {
        const data = await contactRes.json().catch(() => ({}));
        setError(data.error ?? "Couldn't save your contact info.");
        setSubmitting(false);
        return;
      }

      const notifyRes = await fetch(
        `/api/sessions/${sessionId}/notify-support`,
        { method: "POST" }
      );
      if (!notifyRes.ok) {
        const data = await notifyRes.json().catch(() => ({}));
        setError(
          data.error ??
            "Saved your contact info but couldn't reach the team — they'll see it when they're back."
        );
        // We still close because the contact info was saved successfully.
      }

      onCaptured?.();
      onClose();
    } catch {
      setError("Network error. Please try again.");
      setSubmitting(false);
    }
  };

  return (
    <div
      className="bg-white border border-border rounded-2xl p-3 mb-3"
      data-testid="email-capture-form"
    >
      <div className="flex items-center justify-between mb-1">
        <p className="text-xs font-medium text-text-primary">
          We&apos;ll email you when a teammate is back
        </p>
        <button
          type="button"
          onClick={onClose}
          className="text-text-secondary hover:text-text-primary"
          aria-label="Cancel"
        >
          <X size={14} />
        </button>
      </div>
      <p className="text-[11px] text-text-secondary mb-2">
        Our team is offline right now — leave your email and we&apos;ll reach
        out as soon as we&apos;re back.
      </p>
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="Email"
        autoComplete="email"
        data-testid="email-capture-email"
        className="w-full mb-2 px-3 py-2 text-sm border border-border rounded-button focus:outline-none focus:ring-2 focus:ring-accent/20"
      />
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Name (optional)"
        autoComplete="name"
        data-testid="email-capture-name"
        className="w-full mb-2 px-3 py-2 text-sm border border-border rounded-button focus:outline-none focus:ring-2 focus:ring-accent/20"
      />
      {error && (
        <p className="text-xs text-red-600 mb-2" data-testid="email-capture-error">
          {error}
        </p>
      )}
      <button
        type="button"
        onClick={submit}
        disabled={submitting}
        data-testid="email-capture-submit"
        className="w-full px-3 py-2 text-sm font-medium rounded-button bg-accent text-white hover:bg-accent/90 transition-colors disabled:opacity-60 inline-flex items-center justify-center gap-1.5"
      >
        {submitting ? (
          <>
            <Loader2 size={14} className="animate-spin" /> Sending...
          </>
        ) : (
          "Send"
        )}
      </button>
    </div>
  );
}
