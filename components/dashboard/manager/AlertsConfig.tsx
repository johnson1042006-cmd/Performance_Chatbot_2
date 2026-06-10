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

export default function AlertsConfig() {
  const [rows, setRows] = useState<Threshold[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/alert-thresholds", {
        cache: "no-store",
      });
      const data = res.ok ? await res.json() : { thresholds: [] };
      setRows(data.thresholds ?? []);
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

  return (
    <Card padding={false}>
      <div className="flex items-center justify-between px-6 py-4 border-b border-border">
        <div>
          <h3 className="font-semibold text-text-primary text-sm">Alerts</h3>
          <p className="text-xs text-text-secondary">
            Thresholds evaluated every cron tick. Breaches fire on the
            <code className="px-1">alerts</code> Pusher channel and POST to
            <code className="px-1">SLACK_WEBHOOK_URL</code> if configured.
          </p>
        </div>
        <Button size="sm" variant="secondary" onClick={handleCreate} disabled={creating}>
          <Plus size={14} className="mr-1" /> Add threshold
        </Button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-background">
              <th className="text-left px-4 py-2 font-medium text-text-secondary">Kind</th>
              <th className="text-left px-4 py-2 font-medium text-text-secondary">Comparator</th>
              <th className="text-left px-4 py-2 font-medium text-text-secondary">Threshold</th>
              <th className="text-left px-4 py-2 font-medium text-text-secondary">Cooldown (min)</th>
              <th className="text-left px-4 py-2 font-medium text-text-secondary">Enabled</th>
              <th className="text-left px-4 py-2 font-medium text-text-secondary">Hours (start–end)</th>
              <th className="text-right px-4 py-2 font-medium text-text-secondary"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-text-secondary">
                  Loading…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-text-secondary">
                  No thresholds yet. Click “Add threshold” to start.
                </td>
              </tr>
            ) : (
              rows.map((t) => {
                const meta = (t.metadata ?? {}) as Record<string, unknown>;
                const hoursStart = String(meta.hoursStart ?? "09:00");
                const hoursEnd = String(meta.hoursEnd ?? "18:00");
                return (
                  <tr key={t.id} className="border-b border-border last:border-b-0">
                    <td className="px-4 py-2">
                      <select
                        value={t.kind}
                        onChange={(e) =>
                          handlePatch(t.id, { kind: e.target.value })
                        }
                        className="text-sm border border-border rounded px-2 py-1 bg-surface"
                      >
                        {KINDS.map((k) => (
                          <option key={k.value} value={k.value}>
                            {k.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-2">
                      <select
                        value={t.comparator}
                        onChange={(e) =>
                          handlePatch(t.id, { comparator: e.target.value })
                        }
                        className="text-sm border border-border rounded px-2 py-1 bg-surface"
                      >
                        {COMPARATORS.map((c) => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-2">
                      <input
                        type="number"
                        defaultValue={Number(t.threshold)}
                        onBlur={(e) =>
                          handlePatch(t.id, {
                            threshold: e.target.value as unknown as string,
                          })
                        }
                        className="w-24 text-sm border border-border rounded px-2 py-1"
                      />
                    </td>
                    <td className="px-4 py-2">
                      <input
                        type="number"
                        defaultValue={t.cooldownMin}
                        onBlur={(e) =>
                          handlePatch(t.id, {
                            cooldownMin: parseInt(e.target.value, 10) || 30,
                          })
                        }
                        className="w-20 text-sm border border-border rounded px-2 py-1"
                      />
                    </td>
                    <td className="px-4 py-2">
                      <input
                        type="checkbox"
                        checked={t.enabled}
                        onChange={(e) =>
                          handlePatch(t.id, { enabled: e.target.checked })
                        }
                      />
                    </td>
                    <td className="px-4 py-2">
                      {t.kind === "no_agents_online_during_hours" ? (
                        <div className="flex items-center gap-1 text-xs">
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
                            className="border border-border rounded px-1 py-0.5"
                          />
                          –
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
                            className="border border-border rounded px-1 py-0.5"
                          />
                        </div>
                      ) : (
                        <span className="text-xs text-text-secondary">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <button
                        onClick={() => setConfirmDeleteId(t.id)}
                        className="text-text-secondary hover:text-error"
                        aria-label="Delete alert threshold"
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
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
