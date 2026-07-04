/* Scout service worker — Web Push for the overnight scout + standing watches.
 * Deliberately minimal: no offline caching (Scout is data-live), just push
 * notification handling so the PWA can alert the owner when a match appears. */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: "Scout", body: event.data ? event.data.text() : "" };
  }

  const title = payload.title || "Scout";
  const options = {
    body: payload.body || "",
    icon: payload.icon || "/icon-192.png",
    badge: "/icon-192.png",
    image: payload.image || undefined,
    tag: payload.tag || undefined,
    renotify: !!payload.tag,
    data: { url: payload.url || "/", ...(payload.data || {}) },
    // A gentle nudge, not an alarm.
    requireInteraction: false,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      // Focus an existing Scout tab if one is open; else open a new one.
      for (const client of clients) {
        if ("focus" in client) {
          client.navigate(target).catch(() => {});
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    })
  );
});
