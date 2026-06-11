// Native desktop (OS) notifications for the manager/agent dashboard.
//
// These surface as macOS / Windows system notifications. They are
// deliberately only fired when the dashboard tab is NOT focused — when the
// agent is actively looking at the dashboard, the in-app UI (banner, bell,
// queue) is enough and a system notification would be redundant noise.

// No /public/pc-icon.png exists, so fall back to the favicon path.
const ICON_PATH = "/favicon.ico";

/**
 * True when the dashboard tab is NOT focused — either hidden (another tab /
 * minimized) or the window doesn't currently have focus. When `document` is
 * unavailable (SSR / unit tests) we treat the tab as "away" so callers default
 * to notifying rather than silently swallowing the alert.
 */
export function isTabAway(): boolean {
  if (typeof document === "undefined") return true;
  const hidden = document.visibilityState === "hidden";
  const unfocused =
    typeof document.hasFocus === "function"
      ? document.hasFocus() === false
      : false;
  return hidden || unfocused;
}

/**
 * Prompt for desktop notification permission if it hasn't been decided yet.
 * Returns the resulting permission string ("granted" | "denied" | "default").
 */
export async function requestDesktopPermission(): Promise<NotificationPermission> {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return "denied";
  }
  if (Notification.permission === "default") {
    try {
      return await Notification.requestPermission();
    } catch {
      return Notification.permission;
    }
  }
  return Notification.permission;
}

/**
 * Fire a native desktop notification, but only when the tab is not focused and
 * permission has been granted. Repeated notifications sharing a `tag` replace
 * one another rather than stacking.
 */
export function sendDesktopNotification(
  title: string,
  body: string,
  tag?: string
): void {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission !== "granted") return;

  // Only notify when the tab is NOT focused — if the agent is looking at the
  // dashboard the in-app UI is enough.
  if (!isTabAway()) return;

  try {
    const notification = new Notification(title, {
      body,
      tag,
      icon: ICON_PATH,
    });
    notification.onclick = () => {
      window.focus();
      notification.close();
    };
  } catch (err) {
    console.warn("sendDesktopNotification: Notification failed", err);
  }
}
