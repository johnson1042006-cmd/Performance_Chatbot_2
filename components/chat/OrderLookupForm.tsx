"use client";

import { useState } from "react";
import { Loader2, X } from "lucide-react";

interface Props {
  sessionId: string;
  onClose: () => void;
  onSubmitted?: () => void;
}

/**
 * Inline order-lookup form rendered in the chat scroll area when the
 * customer taps the "Track an order" chip. Posts to /api/orders/lookup;
 * on success the API has already inserted the AI summary as a message,
 * so we just close ourselves and let the existing Pusher/poll plumbing
 * deliver the bubble. On not-found we show an inline error and stay open
 * so the customer can retry without re-tapping the chip.
 */
export default function OrderLookupForm({
  sessionId,
  onClose,
  onSubmitted,
}: Props) {
  const [email, setEmail] = useState("");
  const [orderId, setOrderId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    const trimmedEmail = email.trim();
    const trimmedOrder = orderId.trim();
    if (!trimmedEmail || !trimmedOrder) {
      setError("Both email and order number are required.");
      return;
    }
    const orderNum = parseInt(trimmedOrder, 10);
    if (!Number.isFinite(orderNum) || orderNum <= 0) {
      setError("Order number must be a positive number.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/orders/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: trimmedEmail,
          orderId: orderNum,
          sessionId,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Couldn't look up that order. Try again.");
        setSubmitting(false);
        return;
      }
      if (data.found === false) {
        setError(
          "We couldn't find an order matching that email and order number. Double-check both and try again."
        );
        setSubmitting(false);
        return;
      }
      onSubmitted?.();
      onClose();
    } catch {
      setError("Network error. Please try again.");
      setSubmitting(false);
    }
  };

  return (
    <div
      className="bg-white border border-border rounded-2xl p-3 mb-3"
      data-testid="order-lookup-form"
    >
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-medium text-text-primary">Track an order</p>
        <button
          type="button"
          onClick={onClose}
          className="text-text-secondary hover:text-text-primary"
          aria-label="Cancel"
        >
          <X size={14} />
        </button>
      </div>
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="Email used at checkout"
        autoComplete="email"
        data-testid="order-lookup-email"
        className="w-full mb-2 px-3 py-2 text-sm border border-border rounded-button focus:outline-none focus:ring-2 focus:ring-accent/20"
      />
      <input
        type="text"
        inputMode="numeric"
        value={orderId}
        onChange={(e) => setOrderId(e.target.value.replace(/[^\d]/g, ""))}
        placeholder="Order number"
        data-testid="order-lookup-id"
        className="w-full mb-2 px-3 py-2 text-sm border border-border rounded-button focus:outline-none focus:ring-2 focus:ring-accent/20"
      />
      {error && (
        <p className="text-xs text-red-600 mb-2" data-testid="order-lookup-error">
          {error}
        </p>
      )}
      <button
        type="button"
        onClick={submit}
        disabled={submitting}
        data-testid="order-lookup-submit"
        className="w-full px-3 py-2 text-sm font-medium rounded-button bg-accent-solid text-white hover:brightness-[0.95] transition-[filter] disabled:opacity-60 inline-flex items-center justify-center gap-1.5"
      >
        {submitting ? (
          <>
            <Loader2 size={14} className="animate-spin" /> Looking up...
          </>
        ) : (
          "Look up order"
        )}
      </button>
    </div>
  );
}
