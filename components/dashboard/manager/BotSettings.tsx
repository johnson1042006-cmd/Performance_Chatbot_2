"use client";

import { useState, useEffect, useRef } from "react";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import { Save, Bot, Trash2, Ticket } from "lucide-react";

interface SlaWindowsHours {
  urgent: number;
  high: number;
  normal: number;
  low: number;
}

interface Settings {
  aiEnabled: boolean;
  fallbackTimerSeconds: number;
  historyRetentionMonths: number;
  autoOpenOnFirstVisit: boolean;
  hotkeysEnabled: boolean;
  autoTicketOnEscalation: boolean;
  autoTicketEmailEnabled: boolean;
  slaWindowsHours: SlaWindowsHours;
}

const DEFAULT_SLA_WINDOWS: SlaWindowsHours = {
  urgent: 2,
  high: 4,
  normal: 24,
  low: 72,
};

const RETENTION_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: "Disabled (keep forever)" },
  { value: 1, label: "1 month" },
  { value: 3, label: "3 months" },
  { value: 6, label: "6 months" },
  { value: 12, label: "12 months" },
];

function clampTimer(n: number): number {
  return Math.min(300, Math.max(10, n));
}

export default function BotSettings() {
  const [settings, setSettings] = useState<Settings>({
    aiEnabled: true,
    fallbackTimerSeconds: 60,
    historyRetentionMonths: 0,
    autoOpenOnFirstVisit: true,
    hotkeysEnabled: true,
    autoTicketOnEscalation: true,
    autoTicketEmailEnabled: true,
    slaWindowsHours: { ...DEFAULT_SLA_WINDOWS },
  });
  // Separate string state so users can type freely without mid-type clamping
  const [fallbackInput, setFallbackInput] = useState("60");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  // Track whether the user has typed (dirty) so a server refetch doesn't overwrite
  const dirtyRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/admin/settings")
      .then((res) => res.json())
      .then((data) => {
        if (!data.settings) return;
        // Only overwrite local state when the field is not focused and not dirty
        const focused = document.activeElement === inputRef.current;
        if (!focused && !dirtyRef.current) {
          setSettings({
            ...data.settings,
            slaWindowsHours: {
              ...DEFAULT_SLA_WINDOWS,
              ...(data.settings.slaWindowsHours || {}),
            },
          });
          setFallbackInput(String(data.settings.fallbackTimerSeconds ?? 60));
        }
      })
      .catch(console.error);
  }, []);

  /** Commit the text field: validate, clamp, and sync into `settings`. */
  function commitFallbackInput() {
    const parsed = parseInt(fallbackInput, 10);
    const clamped = Number.isNaN(parsed)
      ? settings.fallbackTimerSeconds
      : clampTimer(parsed);
    setSettings((s) => ({ ...s, fallbackTimerSeconds: clamped }));
    setFallbackInput(String(clamped));
    dirtyRef.current = false;
  }

  const handleSave = async () => {
    // Always commit the text field before saving
    commitFallbackInput();
    // Read committed value directly (state update is async, so re-derive)
    const parsed = parseInt(fallbackInput, 10);
    const timerValue = Number.isNaN(parsed)
      ? settings.fallbackTimerSeconds
      : clampTimer(parsed);
    const payload: Settings = {
      ...settings,
      fallbackTimerSeconds: timerValue,
    };

    setSaving(true);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("Save failed");
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      console.error("Settings save error:", err);
      alert("Failed to save settings. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-center gap-2 mb-4">
          <Bot size={20} className="text-ai-badge" />
          <h3 className="font-semibold text-text-primary">AI Fallback Settings</h3>
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between py-3 border-b border-border">
            <div>
              <p className="text-sm font-medium text-text-primary">
                AI Fallback Enabled
              </p>
              <p className="text-xs text-text-secondary">
                Automatically respond with AI when no agent claims within the
                timer
              </p>
            </div>
            <button
              onClick={() =>
                setSettings((s) => ({ ...s, aiEnabled: !s.aiEnabled }))
              }
              className={`relative w-11 h-6 rounded-full transition-colors ${
                settings.aiEnabled ? "bg-success" : "bg-gray-300"
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform shadow-sm ${
                  settings.aiEnabled ? "translate-x-5" : ""
                }`}
              />
            </button>
          </div>

          <div className="flex items-center justify-between py-3 border-b border-border">
            <div>
              <p className="text-sm font-medium text-text-primary">
                Auto-Open On First Visit
              </p>
              <p className="text-xs text-text-secondary">
                Open the chat bubble automatically the first time a visitor
                lands on the site (per browser session)
              </p>
            </div>
            <button
              onClick={() =>
                setSettings((s) => ({
                  ...s,
                  autoOpenOnFirstVisit: !s.autoOpenOnFirstVisit,
                }))
              }
              className={`relative w-11 h-6 rounded-full transition-colors ${
                settings.autoOpenOnFirstVisit ? "bg-success" : "bg-gray-300"
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform shadow-sm ${
                  settings.autoOpenOnFirstVisit ? "translate-x-5" : ""
                }`}
              />
            </button>
          </div>

          <div className="flex items-center justify-between py-3 border-b border-border">
            <div>
              <p className="text-sm font-medium text-text-primary">
                Agent Hotkeys
              </p>
              <p className="text-xs text-text-secondary">
                Enable J/K nav, C claim, R release, X close, / focus reply,
                and Cmd/Ctrl+Enter send for agents on the live chats page
              </p>
            </div>
            <button
              onClick={() =>
                setSettings((s) => ({
                  ...s,
                  hotkeysEnabled: !s.hotkeysEnabled,
                }))
              }
              data-testid="hotkeys-toggle"
              className={`relative w-11 h-6 rounded-full transition-colors ${
                settings.hotkeysEnabled ? "bg-success" : "bg-gray-300"
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform shadow-sm ${
                  settings.hotkeysEnabled ? "translate-x-5" : ""
                }`}
              />
            </button>
          </div>

          <div className="py-3 border-b border-border">
            <label className="block text-sm font-medium text-text-primary mb-2">
              Fallback Timer (seconds)
            </label>
            <input
              ref={inputRef}
              type="text"
              inputMode="numeric"
              value={fallbackInput}
              onChange={(e) => {
                setFallbackInput(e.target.value);
                dirtyRef.current = true;
              }}
              onBlur={commitFallbackInput}
              className="w-32 px-3 py-2 text-sm border border-border rounded-button focus:outline-none focus:ring-2 focus:ring-accent/20"
            />
            <p className="text-xs text-text-secondary mt-1">
              Wait this many seconds before AI takes over (10–300)
            </p>
          </div>
        </div>

        <div className="py-3">
          <div className="flex items-center gap-2 mb-2">
            <Trash2 size={16} className="text-text-secondary" />
            <label className="block text-sm font-medium text-text-primary">
              Chat History Retention
            </label>
          </div>
          <select
            value={settings.historyRetentionMonths}
            onChange={(e) =>
              setSettings((s) => ({
                ...s,
                historyRetentionMonths: parseInt(e.target.value, 10) || 0,
              }))
            }
            className="w-64 px-3 py-2 text-sm border border-border rounded-button focus:outline-none focus:ring-2 focus:ring-accent/20 bg-white"
          >
            {RETENTION_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <p className="text-xs text-text-secondary mt-1">
            Automatically delete closed chat sessions older than this on the
            1st of each month. Disabled keeps history forever.
          </p>
        </div>

        <div className="flex items-center justify-end gap-2 mt-4 pt-4 border-t border-border">
          {saved && (
            <span className="text-xs text-success font-medium">
              Settings saved!
            </span>
          )}
          <Button onClick={handleSave} disabled={saving}>
            <Save size={14} className="mr-1.5" />
            {saving ? "Saving..." : "Save Settings"}
          </Button>
        </div>
      </Card>

      <Card>
        <div className="flex items-center gap-2 mb-4">
          <Ticket size={20} className="text-accent" />
          <h3 className="font-semibold text-text-primary">Ticketing</h3>
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between py-3 border-b border-border">
            <div>
              <p className="text-sm font-medium text-text-primary">
                Auto-create tickets on escalation
              </p>
              <p className="text-xs text-text-secondary">
                When a chat closes with negative sentiment, an explicit
                escalation event, or unresolved tagger output, automatically
                open a tracked ticket.
              </p>
            </div>
            <button
              data-testid="auto-ticket-toggle"
              onClick={() =>
                setSettings((s) => ({
                  ...s,
                  autoTicketOnEscalation: !s.autoTicketOnEscalation,
                }))
              }
              className={`relative w-11 h-6 rounded-full transition-colors ${
                settings.autoTicketOnEscalation ? "bg-success" : "bg-gray-300"
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform shadow-sm ${
                  settings.autoTicketOnEscalation ? "translate-x-5" : ""
                }`}
              />
            </button>
          </div>

          <div className="flex items-center justify-between py-3 border-b border-border">
            <div>
              <p className="text-sm font-medium text-text-primary">
                Email customer when ticket is created
              </p>
              <p className="text-xs text-text-secondary">
                Send a &quot;we got your request&quot; email when a ticket is auto- or
                manually-created (skipped if no consented email is on file).
              </p>
            </div>
            <button
              onClick={() =>
                setSettings((s) => ({
                  ...s,
                  autoTicketEmailEnabled: !s.autoTicketEmailEnabled,
                }))
              }
              className={`relative w-11 h-6 rounded-full transition-colors ${
                settings.autoTicketEmailEnabled ? "bg-success" : "bg-gray-300"
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform shadow-sm ${
                  settings.autoTicketEmailEnabled ? "translate-x-5" : ""
                }`}
              />
            </button>
          </div>

          <div className="py-3">
            <label className="block text-sm font-medium text-text-primary mb-2">
              SLA windows (hours)
            </label>
            <p className="text-xs text-text-secondary mb-3">
              Tickets become &quot;breached&quot; when due_at is in the past. due_at is
              computed as ticket created time + this priority&apos;s window.
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {(
                [
                  ["urgent", "Urgent"],
                  ["high", "High"],
                  ["normal", "Normal"],
                  ["low", "Low"],
                ] as Array<[keyof SlaWindowsHours, string]>
              ).map(([key, label]) => (
                <div key={key}>
                  <label className="block text-xs text-text-secondary mb-1">
                    {label}
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={720}
                    value={settings.slaWindowsHours[key] ?? DEFAULT_SLA_WINDOWS[key]}
                    onChange={(e) => {
                      const parsed = parseInt(e.target.value, 10);
                      const clamped = Number.isNaN(parsed)
                        ? DEFAULT_SLA_WINDOWS[key]
                        : Math.min(720, Math.max(1, parsed));
                      setSettings((s) => ({
                        ...s,
                        slaWindowsHours: {
                          ...s.slaWindowsHours,
                          [key]: clamped,
                        },
                      }));
                    }}
                    className="w-full px-3 py-2 text-sm border border-border rounded-button focus:outline-none focus:ring-2 focus:ring-accent/20"
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
