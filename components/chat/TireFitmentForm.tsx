"use client";

import { useMemo, useState } from "react";
import { Loader2, X } from "lucide-react";
import type { RidingType } from "@/lib/search/tireCatalog";

const YEAR_MIN = 1980;
const YEAR_MAX = new Date().getFullYear();

type Priority =
  | "Longest mileage"
  | "Best wet grip"
  | "Maximum dry grip"
  | "Best value";

const RIDING_TYPES: RidingType[] = [
  "Street",
  "Sport",
  "Adventure",
  "Cruiser",
  "Off-road",
  "Dual sport",
  "Track",
];

const PRIORITIES: Priority[] = [
  "Longest mileage",
  "Best wet grip",
  "Maximum dry grip",
  "Best value",
];

interface Payload {
  year: number;
  make: string;
  model: string;
  currentTireSize?: string;
  ridingType: RidingType;
  priority: Priority;
}

interface Props {
  onClose: () => void;
  onSubmit: (payload: Payload) => void;
}

export type TireFitmentPayload = Payload;

export default function TireFitmentForm({ onClose, onSubmit }: Props) {
  const [year, setYear] = useState("");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [currentTireSize, setCurrentTireSize] = useState("");
  const [ridingType, setRidingType] = useState<RidingType | "">("");
  const [priority, setPriority] = useState<Priority>("Best value");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const yearNum = useMemo(() => parseInt(year.trim(), 10), [year]);

  const submit = async () => {
    setError(null);
    const makeTrim = make.trim();
    const modelTrim = model.trim();
    if (!Number.isFinite(yearNum) || yearNum < YEAR_MIN || yearNum > YEAR_MAX) {
      setError(`Bike year must be between ${YEAR_MIN} and ${YEAR_MAX}.`);
      return;
    }
    if (!makeTrim || !modelTrim) {
      setError("Bike make and model are required.");
      return;
    }
    if (!ridingType) {
      setError("Please select a riding type.");
      return;
    }

    setSubmitting(true);
    try {
      onSubmit({
        year: yearNum,
        make: makeTrim,
        model: modelTrim,
        currentTireSize: currentTireSize.trim() || undefined,
        ridingType,
        priority,
      });
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="bg-white border border-border rounded-2xl p-3 mb-3"
      data-testid="tire-fitment-form"
    >
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-medium text-text-primary">Tire fitment help</p>
        <button
          type="button"
          onClick={onClose}
          className="text-text-secondary hover:text-text-primary"
          aria-label="Cancel"
        >
          <X size={14} />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 mb-2">
        <input
          type="text"
          inputMode="numeric"
          value={year}
          onChange={(e) => setYear(e.target.value.replace(/[^\d]/g, "").slice(0, 4))}
          placeholder="Bike year (e.g. 2020)"
          data-testid="tire-year"
          className="w-full px-3 py-2 text-sm border border-border rounded-button focus:outline-none focus:ring-2 focus:ring-accent/20"
        />
        <input
          type="text"
          value={make}
          onChange={(e) => setMake(e.target.value)}
          placeholder="Bike make (e.g. Yamaha)"
          data-testid="tire-make"
          className="w-full px-3 py-2 text-sm border border-border rounded-button focus:outline-none focus:ring-2 focus:ring-accent/20"
        />
      </div>
      <input
        type="text"
        value={model}
        onChange={(e) => setModel(e.target.value)}
        placeholder="Bike model (e.g. MT-07)"
        data-testid="tire-model"
        className="w-full mb-2 px-3 py-2 text-sm border border-border rounded-button focus:outline-none focus:ring-2 focus:ring-accent/20"
      />
      <div className="mb-2">
        <input
          type="text"
          value={currentTireSize}
          onChange={(e) => setCurrentTireSize(e.target.value)}
          placeholder="Current tire size (optional)"
          data-testid="tire-size"
          className="w-full px-3 py-2 text-sm border border-border rounded-button focus:outline-none focus:ring-2 focus:ring-accent/20"
        />
        <p className="text-[10px] text-text-secondary mt-1">
          e.g. 120/70-17 front, 180/55-17 rear
        </p>
      </div>

      <label
        htmlFor="tire-riding-type"
        className="block text-[11px] font-medium text-text-primary mb-1"
      >
        Riding type
      </label>
      <select
        id="tire-riding-type"
        value={ridingType}
        onChange={(e) => setRidingType(e.target.value as RidingType)}
        data-testid="tire-riding-type"
        className="w-full mb-2 px-3 py-2 text-sm border border-border rounded-button focus:outline-none focus:ring-2 focus:ring-accent/20 bg-white"
      >
        <option value="" disabled>
          Riding type…
        </option>
        {RIDING_TYPES.map((rt) => (
          <option key={rt} value={rt}>
            {rt}
          </option>
        ))}
      </select>

      <fieldset className="mb-2">
        <legend className="text-[11px] font-medium text-text-primary mb-1">
          What&apos;s most important?
        </legend>
        <div className="flex flex-col gap-1">
          {PRIORITIES.map((p) => (
            <label key={p} className="inline-flex items-center gap-2 text-xs text-text-primary">
              <input
                type="radio"
                name="tire-priority"
                value={p}
                checked={priority === p}
                onChange={() => setPriority(p)}
              />
              {p}
            </label>
          ))}
        </div>
      </fieldset>

      {error && (
        <p className="text-xs text-red-600 mb-2" data-testid="tire-fitment-error">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={submit}
        disabled={submitting}
        data-testid="tire-fitment-submit"
        className="w-full px-3 py-2 text-sm font-medium rounded-button bg-accent-solid text-white hover:brightness-[0.95] transition-[filter] disabled:opacity-60 inline-flex items-center justify-center gap-1.5"
      >
        {submitting ? (
          <>
            <Loader2 size={14} className="animate-spin" /> Sending...
          </>
        ) : (
          "Get fitment help"
        )}
      </button>
    </div>
  );
}

