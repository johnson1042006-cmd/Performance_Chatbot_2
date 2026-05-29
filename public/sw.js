/*
 * Push-only service worker for escalation alerts.
 *
 * Intentionally minimal: it handles only `push` (show a desktop notification)
 * and `notificationclick` (focus/open the dashboard). It does NOT register a
 * `fetch` handler and does NOT cache anything, so it cannot serve stale assets
 * or interfere with normal app loading.
 */

self.addEventListener("install", () => {
  // Activate immediately so the first enable doesn't require a reload.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (_e) {
    data = {};
  }

  const title = data.title || "Escalation";
  const options = {
    body: data.body || "Open the dashboard to claim",
    tag: data.tag || "escalation",
    data: { url: data.url || "/dashboard/chats" },
    requireInteraction: false,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl =
    (event.notification.data && event.notification.data.url) ||
    "/dashboard/chats";

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          // Focus an existing dashboard tab if one is open.
          if (client.url.includes("/dashboard") && "focus" in client) {
            return client.focus();
          }
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow(targetUrl);
        }
        return undefined;
      })
  );
});
