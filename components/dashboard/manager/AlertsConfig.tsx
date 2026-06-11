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

const COMPARATORS = [">", ">=", "<", "<=", "=="];

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
  // Local draft strings for the numeric inputs so we can validate live and
  // block the save when a value is not a positive integer.
  const [drafts, setDrafts] = useState<
    Record<string, { threshold: string; cooldown: string }>
  >({});

  const seedDrafts = (list: Threshold[]) => {
    const next: Record<string, { threshold: string; cooldown: string }> = {};
    for (const t of list) {
      next[t.id] = {
        threshold: String(Number(t.threshold)),
        cooldown: String(t.cooldownMin),
      };
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
      await fetch("/api/admin/alert-thresholds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "queue_depth",
          comparator: ">=",
          threshold: 5,
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

  const handleDelete = async (id: string) => {
    setConfirmDeleteId(null);
    await fetch(`/api/admin/alert-thresholds?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    await refresh();
  };

  const updateDraft = (
    id: string,
    field: "threshold" | "cooldown",
    value: string
  ) => {
    setDrafts((prev) => ({
      ...prev,
      [id]: {
        threshold: prev[id]?.threshold ?? "",
        cooldown: prev[id]?.cooldown ?? "",
        [field]: value,
      },
    }));
  };

  const selectClass =
    "text-sm border border-border rounded px-2 py-1 bg-surface";
  const numberClass = "w-20 text-sm border border-border rounded px-2 py-1";

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
          <Plus size={14} className="mr-1" /> Add threshold
        </Button>
      </div>

      <div className="divide-y divide-border">
        {loading ? (
          <div className="px-6 py-6 text-center text-text-secondary text-sm">
            Loading…
          </div>
        ) : rows.length === 0 ? (
          <div className="px-6 py-6 text-center text-text-secondary text-sm">
            No thresholds yet. Click “Add threshold” to start.
          </div>
        ) : (
          rows.map((t) => {
            const meta = (t.metadata ?? {}) as Record<string, unknown>;
            const hoursStart = String(meta.hoursStart ?? "09:00");
            const hoursEnd = String(meta.hoursEnd ?? "18:00");
            const km = kindMeta(t.kind);
            const draft = drafts[t.id] ?? {
              threshold: String(Number(t.threshold)),
              cooldown: String(t.cooldownMin),
            };
            const thresholdValid = isPositiveInt(draft.threshold);
            const cooldownValid = isPositiveInt(draft.cooldown);
            const showHours = t.kind === "no_agents_online_during_hours";

            return (
              <div key={t.id} className="px-6 py-4">
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={t.enabled}
                    onChange={(e) =>
                      handlePatch(t.id, { enabled: e.target.checked })
                    }
                    className="mt-1.5"
                    aria-label="Enable alert"
                  />
                  <div className="flex-1">
                    <div className="flex flex-wrap items-center gap-1.5 text-sm text-text-primary leading-7">
                      <span>Alert me when</span>
                      <select
                        value={t.kind}
                        onChange={(e) =>
                          handlePatch(t.id, { kind: e.target.value })
                        }
                        className={selectClass}
                      >
                        {KINDS.map((k) => (
                          <option key={k.value} value={k.value}>
                            {k.label}
                          </option>
                        ))}
                      </select>
                      <span>is</span>
                      <select
                        value={t.comparator}
                        onChange={(e) =>
                          handlePatch(t.id, { comparator: e.target.value })
                        }
                        className={selectClass}
                      >
                        {COMPARATORS.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                      <input
                        type="number"
                        min={1}
                        value={draft.threshold}
                        onChange={(e) =>
                          updateDraft(t.id, "threshold", e.target.value)
                        }
                        onBlur={(e) => {
                          if (isPositiveInt(e.target.value)) {
                            handlePatch(t.id, {
                              threshold: e.target.value as unknown as string,
                            });
                          }
                        }}
                        className={numberClass}
                      />
                      {km.unit && <span>{km.unit}</span>}
                      {showHours && (
                        <>
                          <span>during</span>
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
                          />
                        </>
                      )}
                      <span>, at most once every</span>
                      <input
                        type="number"
                        min={1}
                        value={draft.cooldown}
                        onChange={(e) =>
                          updateDraft(t.id, "cooldown", e.target.value)
                        }
                        onBlur={(e) => {
                          if (isPositiveInt(e.target.value)) {
                            handlePatch(t.id, {
                              cooldownMin: parseInt(e.target.value, 10),
                            });
                          }
                        }}
                        className={numberClass}
                      />
                      <span>minutes.</span>
                      <button
                        onClick={() => setConfirmDeleteId(t.id)}
                        className="ml-auto text-text-secondary hover:text-error"
                        aria-label="Delete alert threshold"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                    <p className="text-xs text-text-secondary mt-1">
                      {km.description}
                    </p>
                    {(!thresholdValid || !cooldownValid) && (
                      <p className="text-xs text-error mt-1">
                        Threshold and cooldown must be positive whole numbers.
                        Changes are not saved until fixed.
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
        title="Delete threshold"
        message="Delete this alert threshold? This cannot be undone."
        confirmLabel="Delete"
        destructive
        onConfirm={() => confirmDeleteId && void handleDelete(confirmDeleteId)}
        onCancel={() => setConfirmDeleteId(null)}
      />
    </Card>
  );
}
