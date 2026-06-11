// Native desktop (OS) notifications for the manager/agent dashboard.
//
// These surface as macOS / Windows system notifications. They are
// deliberately only fired when the dashboard tab is NOT focused — when the
// agent is actively looking at the dashboard, the in-app UI (banner, bell,
// queue) is enough and a system notification would be redundant noise.

// No /public/pc-icon.png exists, so fall back to the favicon path.
const ICON_PATH = "/favicon.ico";

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

  // Only notify when the tab is NOT focused.
  const hidden =
    typeof document !== "undefined" &&
    document.visibilityState === "hidden";
  const unfocused =
    typeof document !== "undefined" &&
    typeof document.hasFocus === "function" &&
    document.hasFocus() === false;
  if (!hidden && !unfocused) return;

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
