"use client";

/**
 * Mounted in the dashboard layout. Pings /api/presence/heartbeat every 30s
 * while the tab is visible. On tab hide / page unload, marks offline via
 * navigator.sendBeacon so the presence indicator drops promptly.
 */
import { useEffect } from "react";

const HEARTBEAT_INTERVAL_MS = 30_000;

export default function PresenceHeartbeat() {
  useEffect(() => {
    let intervalId: NodeJS.Timeout | null = null;

    async function sendHeartbeat() {
      try {
        await fetch("/api/presence/heartbeat", { method: "POST" });
      } catch {
        // non-fatal
      }
    }

    function sendOffline() {
      navigator.sendBeacon("/api/presence/offline");
    }

    function handleVisibilityChange() {
      // On returning to the tab, refresh presence immediately. Do NOT mark offline
      // when merely hidden — the agent is still at their desk, just in another
      // tab/window. The heartbeat keeps running in the background; the server-side
      // threshold marks them offline only if heartbeats truly stop (tab closed or
      // machine asleep). beforeunload still handles real tab close.
      if (document.visibilityState === "visible") {
        sendHeartbeat();
      }
    }

    // Initial heartbeat
    sendHeartbeat();
    intervalId = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("beforeunload", sendOffline);

    return () => {
      if (intervalId) clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("beforeunload", sendOffline);
    };
  }, []);

  return null;
}
