"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, X } from "lucide-react";

type AirbagModel =
  | "Tech-Air 3"
  | "Tech-Air 5"
  | "Tech-Air 7"
  | "Tech-Air Race"
  | "Tech-Air Off-Road"
  | "Tech-Air Street-V"
  | "Other";

type ServiceRequested =
  | "Cartridge replacement"
  | "Troubleshooting / error light"
  | "Annual service / inspection"
  | "Crash inspection"
  | "Other";

type PreferredReturnShipping = "Standard ground" | "Expedited at customer expense";

const AIRBAG_MODELS: AirbagModel[] = [
  "Tech-Air 3",
  "Tech-Air 5",
  "Tech-Air 7",
  "Tech-Air Race",
  "Tech-Air Off-Road",
  "Tech-Air Street-V",
  "Other",
];

const SERVICE_REQUESTS: ServiceRequested[] = [
  "Cartridge replacement",
  "Troubleshooting / error light",
  "Annual service / inspection",
  "Crash inspection",
  "Other",
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function formatUsPhone(input: string): string {
  const digits = input.replace(/\D/g, "");
  const trimmed = digits.startsWith("1") ? digits.slice(1, 11) : digits.slice(0, 10);
  const a = trimmed.slice(0, 3);
  const b = trimmed.slice(3, 6);
  const c = trimmed.slice(6, 10);
  if (trimmed.length <= 3) return a;
  if (trimmed.length <= 6) return `(${a}) ${b}`;
  return `(${a}) ${b}-${c}`;
}

function useFocusTrap(
  enabled: boolean,
  containerRef: React.RefObject<HTMLElement>,
  onEscape: () => void
) {
  useEffect(() => {
    if (!enabled) return;
    const el = containerRef.current;
    if (!el) return;

    const focusables = () =>
      Array.from(
        el.querySelectorAll<HTMLElement>(
          'a[href],button:not([disabled]),textarea,input,select,[tabindex]:not([tabindex="-1"])'
        )
      ).filter((n) => !n.hasAttribute("disabled") && !n.getAttribute("aria-hidden"));

    const first = () => focusables()[0] ?? null;
    const last = () => {
      const list = focusables();
      return list[list.length - 1] ?? null;
    };

    const prevActive = document.activeElement as HTMLElement | null;
    // Focus the first field as soon as we mount.
    first()?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onEscape();
        return;
      }
      if (e.key !== "Tab") return;

      const f = first();
      const l = last();
      if (!f || !l) return;

      if (e.shiftKey) {
        if (document.activeElement === f) {
          e.preventDefault();
          l.focus();
        }
      } else {
        if (document.activeElement === l) {
          e.preventDefault();
          f.focus();
        }
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      prevActive?.focus?.();
    };
  }, [enabled, containerRef, onEscape]);
}

interface Props {
  sessionId: string;
  onClose: () => void;
  onSubmitted?: () => void;
}

export default function TechAirRequestForm({ sessionId, onClose, onSubmitted }: Props) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [airbagModel, setAirbagModel] = useState<AirbagModel | "">("");
  const [serialNumber, setSerialNumber] = useState("");
  const [serviceRequested, setServiceRequested] = useState<ServiceRequested | "">("");
  const [description, setDescription] = useState("");
  const [returnShippingAddress, setReturnShippingAddress] = useState("");
  const [preferredReturnShipping, setPreferredReturnShipping] =
    useState<PreferredReturnShipping>("Standard ground");
  const [consent, setConsent] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const containerRef = useRef<HTMLDivElement>(null);
  useFocusTrap(true, containerRef, onClose);

  const remaining = 500 - description.length;
  const canSubmit = useMemo(() => {
    return !submitting;
  }, [submitting]);

  function validate(): boolean {
    const next: Record<string, string> = {};
    const nameTrim = fullName.trim();
    const emailTrim = email.trim();
    const serialTrim = serialNumber.trim();
    const descTrim = description.trim();
    const addrTrim = returnShippingAddress.trim();

    if (!nameTrim) next.fullName = "Full name is required.";
    if (!emailTrim) next.email = "Email is required.";
    else if (!EMAIL_RE.test(emailTrim)) next.email = "Please enter a valid email.";
    if (!airbagModel) next.airbagModel = "Please select an airbag model.";
    if (!serialTrim) next.serialNumber = "Serial number is required.";
    if (!serviceRequested) next.serviceRequested = "Please select a service.";
    if (!descTrim) next.description = "Description is required.";
    else if (descTrim.length > 500) next.description = "Max 500 characters.";
    if (!addrTrim) next.returnShippingAddress = "Return shipping address is required.";
    if (!consent) next.consent = "Consent is required.";

    setFieldErrors(next);
    return Object.keys(next).length === 0;
  }

  const submit = async () => {
    setError(null);
    if (!validate()) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/service-request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: fullName.trim(),
          email: email.trim(),
          phone: phone.trim() || undefined,
          airbagModel,
          serialNumber: serialNumber.trim(),
          serviceRequested,
          description: description.trim(),
          returnShippingAddress: returnShippingAddress.trim(),
          preferredReturnShipping,
          consent,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Couldn't submit your Tech-Air request. Please try again.");
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
      ref={containerRef}
      role="dialog"
      aria-modal="true"
      aria-label="Tech-Air service request"
      className="bg-white border border-border rounded-2xl p-3 mb-3"
      data-testid="tech-air-request-form"
    >
      <div className="flex items-center justify-between mb-1">
        <p className="text-xs font-medium text-text-primary">
          Tech-Air service request
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

      <p className="text-[11px] text-text-secondary mb-3">
        Fill this out and we&apos;ll email you within 1 business day to confirm
        next steps.
      </p>

      {/* Full name */}
      <div className="mb-2">
        <label htmlFor="techair-full-name" className="block text-[11px] font-medium text-text-primary mb-1">
          Full name
        </label>
        <input
          id="techair-full-name"
          type="text"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          autoComplete="name"
          aria-describedby={fieldErrors.fullName ? "techair-full-name-error" : undefined}
          className="w-full px-3 py-2 text-sm border border-border rounded-button focus:outline-none focus:ring-2 focus:ring-accent/20"
        />
        {fieldErrors.fullName && (
          <p id="techair-full-name-error" className="text-xs text-red-600 mt-1">
            {fieldErrors.fullName}
          </p>
        )}
      </div>

      {/* Email */}
      <div className="mb-2">
        <label htmlFor="techair-email" className="block text-[11px] font-medium text-text-primary mb-1">
          Email
        </label>
        <input
          id="techair-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          aria-describedby={fieldErrors.email ? "techair-email-error" : undefined}
          className="w-full px-3 py-2 text-sm border border-border rounded-button focus:outline-none focus:ring-2 focus:ring-accent/20"
        />
        {fieldErrors.email && (
          <p id="techair-email-error" className="text-xs text-red-600 mt-1">
            {fieldErrors.email}
          </p>
        )}
      </div>

      {/* Phone (optional) */}
      <div className="mb-2">
        <label htmlFor="techair-phone" className="block text-[11px] font-medium text-text-primary mb-1">
          Phone (optional)
        </label>
        <input
          id="techair-phone"
          type="tel"
          value={phone}
          onChange={(e) => setPhone(formatUsPhone(e.target.value))}
          autoComplete="tel"
          inputMode="tel"
          className="w-full px-3 py-2 text-sm border border-border rounded-button focus:outline-none focus:ring-2 focus:ring-accent/20"
        />
      </div>

      {/* Airbag model */}
      <div className="mb-2">
        <label htmlFor="techair-model" className="block text-[11px] font-medium text-text-primary mb-1">
          Airbag model
        </label>
        <select
          id="techair-model"
          value={airbagModel}
          onChange={(e) => setAirbagModel(e.target.value as AirbagModel)}
          aria-describedby={fieldErrors.airbagModel ? "techair-model-error" : undefined}
          className="w-full px-3 py-2 text-sm border border-border rounded-button focus:outline-none focus:ring-2 focus:ring-accent/20 bg-white"
        >
          <option value="" disabled>
            Select…
          </option>
          {AIRBAG_MODELS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        {fieldErrors.airbagModel && (
          <p id="techair-model-error" className="text-xs text-red-600 mt-1">
            {fieldErrors.airbagModel}
          </p>
        )}
      </div>

      {/* Serial number */}
      <div className="mb-2">
        <label htmlFor="techair-serial" className="block text-[11px] font-medium text-text-primary mb-1">
          Serial number
        </label>
        <input
          id="techair-serial"
          type="text"
          value={serialNumber}
          onChange={(e) => setSerialNumber(e.target.value)}
          aria-describedby={fieldErrors.serialNumber ? "techair-serial-error" : undefined}
          className="w-full px-3 py-2 text-sm border border-border rounded-button focus:outline-none focus:ring-2 focus:ring-accent/20"
        />
        {fieldErrors.serialNumber && (
          <p id="techair-serial-error" className="text-xs text-red-600 mt-1">
            {fieldErrors.serialNumber}
          </p>
        )}
      </div>

      {/* Service requested */}
      <div className="mb-2">
        <label htmlFor="techair-service" className="block text-[11px] font-medium text-text-primary mb-1">
          Service requested
        </label>
        <select
          id="techair-service"
          value={serviceRequested}
          onChange={(e) => setServiceRequested(e.target.value as ServiceRequested)}
          aria-describedby={fieldErrors.serviceRequested ? "techair-service-error" : undefined}
          className="w-full px-3 py-2 text-sm border border-border rounded-button focus:outline-none focus:ring-2 focus:ring-accent/20 bg-white"
        >
          <option value="" disabled>
            Select…
          </option>
          {SERVICE_REQUESTS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        {fieldErrors.serviceRequested && (
          <p id="techair-service-error" className="text-xs text-red-600 mt-1">
            {fieldErrors.serviceRequested}
          </p>
        )}
      </div>

      {/* Description */}
      <div className="mb-2">
        <label htmlFor="techair-description" className="block text-[11px] font-medium text-text-primary mb-1">
          Description of issue / error code
        </label>
        <textarea
          id="techair-description"
          value={description}
          onChange={(e) => setDescription(e.target.value.slice(0, 500))}
          rows={3}
          aria-describedby={[
            "techair-description-helper",
            fieldErrors.description ? "techair-description-error" : null,
          ]
            .filter(Boolean)
            .join(" ")}
          className="w-full px-3 py-2 text-xs border border-border rounded-button focus:outline-none focus:ring-2 focus:ring-accent/20 resize-none"
        />
        <div className="flex items-center justify-between mt-1">
          <p id="techair-description-helper" className="text-[10px] text-text-secondary">
            Max 500 characters.
          </p>
          <p className="text-[10px] text-text-secondary" aria-live="polite">
            {remaining} left
          </p>
        </div>
        {fieldErrors.description && (
          <p id="techair-description-error" className="text-xs text-red-600 mt-1">
            {fieldErrors.description}
          </p>
        )}
      </div>

      {/* Return shipping address */}
      <div className="mb-2">
        <label htmlFor="techair-return-address" className="block text-[11px] font-medium text-text-primary mb-1">
          Return shipping address
        </label>
        <textarea
          id="techair-return-address"
          value={returnShippingAddress}
          onChange={(e) => setReturnShippingAddress(e.target.value)}
          rows={3}
          aria-describedby={[
            "techair-return-address-helper",
            fieldErrors.returnShippingAddress ? "techair-return-address-error" : null,
          ]
            .filter(Boolean)
            .join(" ")}
          className="w-full px-3 py-2 text-xs border border-border rounded-button focus:outline-none focus:ring-2 focus:ring-accent/20 resize-none"
        />
        <p id="techair-return-address-helper" className="text-[10px] text-text-secondary mt-1">
          Include name, street, city, state, zip
        </p>
        {fieldErrors.returnShippingAddress && (
          <p id="techair-return-address-error" className="text-xs text-red-600 mt-1">
            {fieldErrors.returnShippingAddress}
          </p>
        )}
      </div>

      {/* Preferred return shipping */}
      <fieldset className="mb-2">
        <legend className="block text-[11px] font-medium text-text-primary mb-1">
          Preferred return shipping
        </legend>
        <div className="flex flex-col gap-1">
          {(["Standard ground", "Expedited at customer expense"] as const).map((opt) => (
            <label key={opt} className="inline-flex items-center gap-2 text-xs text-text-primary">
              <input
                type="radio"
                name="techair-preferred-return-shipping"
                value={opt}
                checked={preferredReturnShipping === opt}
                onChange={() => setPreferredReturnShipping(opt)}
              />
              {opt}
            </label>
          ))}
        </div>
      </fieldset>

      {/* Consent */}
      <div className="mb-2">
        <label className="inline-flex items-start gap-2 text-xs text-text-primary">
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            aria-describedby={fieldErrors.consent ? "techair-consent-error" : undefined}
          />
          <span>
            I understand I&apos;ll ship the airbag to Performance Cycle, Attn:
            Tech-Air Service, 7375 S Fulton St, Centennial CO 80112, and that
            turnaround is typically 24-48 hours for in-stock canister
            replacements or up to 4 weeks if factory service is required.
          </span>
        </label>
        {fieldErrors.consent && (
          <p id="techair-consent-error" className="text-xs text-red-600 mt-1">
            {fieldErrors.consent}
          </p>
        )}
      </div>

      {error && (
        <p className="text-xs text-red-600 mb-2" data-testid="tech-air-request-error">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={submit}
        disabled={!canSubmit}
        data-testid="tech-air-request-submit"
        className="w-full px-3 py-2 text-sm font-medium rounded-button bg-accent-solid text-white hover:brightness-[0.95] transition-[filter] disabled:opacity-60 inline-flex items-center justify-center gap-1.5"
      >
        {submitting ? (
          <>
            <Loader2 size={14} className="animate-spin" /> Submitting...
          </>
        ) : (
          "Submit request"
        )}
      </button>
    </div>
  );
}

