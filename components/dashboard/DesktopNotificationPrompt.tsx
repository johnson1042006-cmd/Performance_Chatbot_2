"use client";

import { useEffect, useState } from "react";
import { Bell, X } from "lucide-react";
import { requestDesktopPermission } from "@/lib/notifications/desktop";

const DISMISS_KEY = "pc-desktop-notif-prompt-dismissed";

/**
 * Small dismissible bar shown at the top of the dashboard prompting the
 * manager/agent to enable native desktop notifications. Only appears when
 * permission is still "default" and the user hasn't dismissed it before.
 * Dismissal is persisted in localStorage (dashboard-only — never rendered in
 * the embeddable widget, so localStorage is acceptable here).
 */
export default function DesktopNotificationPrompt() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission !== "default") return;
    try {
      if (localStorage.getItem(DISMISS_KEY) === "1") return;
    } catch {
      // ignore storage errors
    }
    setVisible(true);
  }, []);

  if (!visible) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // ignore storage errors
    }
    setVisible(false);
  };

  const handleEnable = async () => {
    await requestDesktopPermission();
    // Permission is now granted or denied — either way, hide permanently.
    dismiss();
  };

  return (
    <div
      className="flex items-center justify-between gap-3 bg-accent/10 border-b border-accent/30 px-6 py-2.5"
      data-testid="desktop-notif-prompt"
    >
      <div className="flex items-center gap-2 min-w-0 text-sm text-text-primary">
        <Bell size={14} className="text-accent-solid shrink-0" />
        <span className="truncate">
          Enable desktop notifications so you never miss an escalation
        </span>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={handleEnable}
          className="text-xs font-semibold px-3 py-1 rounded-button bg-accent-solid text-white hover:opacity-90 transition-opacity"
        >
          Enable
        </button>
        <button
          onClick={dismiss}
          aria-label="Dismiss"
          className="text-text-secondary hover:text-text-primary"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
