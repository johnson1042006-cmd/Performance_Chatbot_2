"use client";

import { useState, useEffect } from "react";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import { Save, Bot } from "lucide-react";

interface Settings {
  aiEnabled: boolean;
  fallbackTimerSeconds: number;
}

export default function BotSettings() {
  const [settings, setSettings] = useState<Settings>({
    aiEnabled: true,
    fallbackTimerSeconds: 60,
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch("/api/admin/settings")
      .then((res) => res.json())
      .then((data) => {
        if (data.settings) setSettings(data.settings);
      })
      .catch(console.error);
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
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
              type="number"
              min={10}
              max={300}
              value={settings.fallbackTimerSeconds}
              onChange={(e) =>
                setSettings((s) => ({
                  ...s,
                  fallbackTimerSeconds: parseInt(e.target.value) || 60,
                }))
              }
              className="w-32 px-3 py-2 text-sm border border-border rounded-button focus:outline-none focus:ring-2 focus:ring-accent/20"
            />
            <p className="text-xs text-text-secondary mt-1">
              Wait this many seconds before AI takes over (10-300)
            </p>
          </div>

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
