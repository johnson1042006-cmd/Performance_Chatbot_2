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
      if (document.visibilityState === "visible") {
        sendHeartbeat();
        if (!intervalId) {
          intervalId = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);
        }
      } else {
        if (intervalId) {
          clearInterval(intervalId);
          intervalId = null;
        }
        sendOffline();
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
