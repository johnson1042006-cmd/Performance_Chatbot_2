"use client";

import { useCallback, useEffect, useState } from "react";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { Plus, Trash2 } from "lucide-react";
import { KINDS } from "./alertKinds";

interface Threshold {
  id: string;
  kind: string;
  threshold: string;
  comparator: string;
  enabled: boolean;
  cooldownMin: number;
  metadata: Record<string, unknown> | null;
  lastFiredAt: string | null;
}

const COOLDOWN_OPTIONS = [
  { value: 15, label: "every 15 minutes" },
  { value: 30, label: "every 30 minutes" },
  { value: 60, label: "every hour" },
  { value: 240, label: "every 4 hours" },
  { value: 1440, label: "once a day" },
];

const DEFAULT_THRESHOLD: Record<string, number> = {
  queue_depth: 5,
  ai_failure_rate_pct: 10,
  no_agents_online_during_hours: 1,
};

function isPositiveInt(value: string): boolean {
  return /^\d+$/.test(value.trim()) && parseInt(value, 10) >= 1;
}

function kindMeta(kind: string) {
  return KINDS.find((k) => k.value === kind) ?? KINDS[0];
}

export default function AlertsConfig() {
  const [rows, setRows] = useState<Threshold[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  // Local draft strings for the numeric threshold input so we can validate
  // live and block the save when a value is not a positive integer.
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const seedDrafts = (list: Threshold[]) => {
    const next: Record<string, string> = {};
    for (const t of list) {
      next[t.id] = String(Number(t.threshold));
    }
    setDrafts(next);
  };

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/alert-thresholds", {
        cache: "no-store",
      });
      const data = res.ok ? await res.json() : { thresholds: [] };
      const list: Threshold[] = data.thresholds ?? [];
      setRows(list);
      seedDrafts(list);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleCreate = async () => {
    if (creating) return;
    setCreating(true);
    try {
      const km = kindMeta("queue_depth");
      await fetch("/api/admin/alert-thresholds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: km.value,
          comparator: km.fixedComparator,
          threshold: DEFAULT_THRESHOLD[km.value] ?? 5,
          cooldownMin: 30,
          enabled: true,
        }),
      });
      await refresh();
    } finally {
      setCreating(false);
    }
  };

  const handlePatch = async (id: string, patch: Partial<Threshold>) => {
    await fetch("/api/admin/alert-thresholds", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...patch }),
    });
    await refresh();
  };

  const handleKindChange = async (t: Threshold, newKind: string) => {
    const km = kindMeta(newKind);
    const patch: Partial<Threshold> = {
      kind: newKind,
      comparator: km.fixedComparator,
    };
    if (km.lockedThreshold != null) {
      patch.threshold = String(km.lockedThreshold);
    }
    if (newKind === "no_agents_online_during_hours") {
      const meta = (t.metadata ?? {}) as Record<string, unknown>;
      patch.metadata = {
        ...meta,
        hoursStart: meta.hoursStart ?? "09:00",
        hoursEnd: meta.hoursEnd ?? "18:00",
      };
    }
    await handlePatch(t.id, patch);
  };

  const handleDelete = async (id: string) => {
    setConfirmDeleteId(null);
    await fetch(`/api/admin/alert-thresholds?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    await refresh();
  };

  const updateDraft = (id: string, value: string) => {
    setDrafts((prev) => ({ ...prev, [id]: value }));
  };

  const selectClass =
    "text-sm border border-border rounded px-2 py-1 bg-surface";
  const numberClass = "w-16 text-sm border border-border rounded px-2 py-1";

  return (
    <Card padding={false}>
      <div className="flex items-center justify-between px-6 py-4 border-b border-border">
        <div>
          <h3 className="font-semibold text-text-primary text-sm">Alerts</h3>
          <p className="text-xs text-text-secondary">
            Alerts appear as dashboard notifications. If a Slack webhook is
            configured in project settings, they also post to Slack.
          </p>
        </div>
        <Button
          size="sm"
          variant="secondary"
          onClick={handleCreate}
          disabled={creating}
        >
          <Plus size={14} className="mr-1" /> Add alert
        </Button>
      </div>

      <div className="divide-y divide-border">
        {loading ? (
          <div className="px-6 py-6 text-center text-text-secondary text-sm">
            Loading…
          </div>
        ) : rows.length === 0 ? (
          <div className="px-6 py-6 text-center text-text-secondary text-sm">
            No alerts yet. Click “Add alert” to start.
          </div>
        ) : (
          rows.map((t) => {
            const meta = (t.metadata ?? {}) as Record<string, unknown>;
            const hoursStart = String(meta.hoursStart ?? "09:00");
            const hoursEnd = String(meta.hoursEnd ?? "18:00");
            const km = kindMeta(t.kind);
            const draft = drafts[t.id] ?? String(Number(t.threshold));
            const hideNumber = km.hideNumber === true;
            const thresholdValid = hideNumber || isPositiveInt(draft);
            const showHours = t.kind === "no_agents_online_during_hours";

            const cooldownIsStandard = COOLDOWN_OPTIONS.some(
              (o) => o.value === t.cooldownMin
            );

            return (
              <div key={t.id} className="px-6 py-4">
                <div className="flex items-start gap-3">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={t.enabled}
                    aria-label="Enable alert"
                    onClick={() =>
                      handlePatch(t.id, { enabled: !t.enabled })
                    }
                    className={`relative mt-1 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                      t.enabled ? "bg-accent-solid" : "bg-border"
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                        t.enabled ? "translate-x-[18px]" : "translate-x-0.5"
                      }`}
                    />
                  </button>
                  <div className="flex-1">
                    <div className="flex flex-wrap items-center gap-1.5 text-sm text-text-primary leading-7">
                      <select
                        value={t.kind}
                        onChange={(e) => handleKindChange(t, e.target.value)}
                        className={selectClass}
                        aria-label="Alert type"
                      >
                        {KINDS.map((k) => (
                          <option key={k.value} value={k.value}>
                            {k.label}
                          </option>
                        ))}
                      </select>
                      <span>{km.sentence.before}</span>
                      {!hideNumber && (
                        <input
                          type="number"
                          min={1}
                          value={draft}
                          onChange={(e) => updateDraft(t.id, e.target.value)}
                          onBlur={(e) => {
                            if (isPositiveInt(e.target.value)) {
                              handlePatch(t.id, {
                                threshold: e.target.value as unknown as string,
                              });
                            }
                          }}
                          className={numberClass}
                          aria-label="Threshold"
                        />
                      )}
                      {km.sentence.after && <span>{km.sentence.after}</span>}
                      {showHours && (
                        <>
                          <input
                            type="time"
                            defaultValue={hoursStart}
                            onBlur={(e) =>
                              handlePatch(t.id, {
                                metadata: {
                                  ...meta,
                                  hoursStart: e.target.value,
                                },
                              })
                            }
                            className="border border-border rounded px-1 py-0.5 text-sm"
                            aria-label="Business hours start"
                          />
                          <span>–</span>
                          <input
                            type="time"
                            defaultValue={hoursEnd}
                            onBlur={(e) =>
                              handlePatch(t.id, {
                                metadata: {
                                  ...meta,
                                  hoursEnd: e.target.value,
                                },
                              })
                            }
                            className="border border-border rounded px-1 py-0.5 text-sm"
                            aria-label="Business hours end"
                          />
                        </>
                      )}
                      <button
                        onClick={() => setConfirmDeleteId(t.id)}
                        className="ml-auto text-text-secondary hover:text-error"
                        aria-label="Delete alert"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 text-sm text-text-secondary mt-1">
                      <span>{km.frequencyLabel}</span>
                      <select
                        value={t.cooldownMin}
                        onChange={(e) =>
                          handlePatch(t.id, {
                            cooldownMin: parseInt(e.target.value, 10),
                          })
                        }
                        className={selectClass}
                        aria-label="Reminder frequency"
                      >
                        {!cooldownIsStandard && (
                          <option value={t.cooldownMin}>
                            every {t.cooldownMin} minutes
                          </option>
                        )}
                        {COOLDOWN_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <p className="text-xs text-text-secondary mt-1">
                      {km.description}
                    </p>
                    {!thresholdValid && (
                      <p className="text-xs text-error mt-1">
                        Threshold must be a positive whole number. Changes are
                        not saved until fixed.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      <ConfirmDialog
        open={!!confirmDeleteId}
        title="Delete alert"
        message="Delete this alert? This cannot be undone."
        confirmLabel="Delete"
        destructive
        onConfirm={() => confirmDeleteId && void handleDelete(confirmDeleteId)}
        onCancel={() => setConfirmDeleteId(null)}
      />
    </Card>
  );
}
