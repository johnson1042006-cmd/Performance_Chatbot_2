"use client";

import { useState, useEffect, useRef } from "react";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import { Save, Bot, Trash2 } from "lucide-react";

interface Settings {
  aiEnabled: boolean;
  fallbackTimerSeconds: number;
  historyRetentionMonths: number;
}

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
          setSettings(data.settings);
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
    </div>
  );
}
