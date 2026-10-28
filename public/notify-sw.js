// TAXI IM: shows order and ring notifications for drivers using the website.
// It caches nothing; tapping a notification opens or focuses the driver screen.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      const open = windows.find((w) => new URL(w.url).pathname.startsWith("/drive"));
      if (open) return open.focus();
      return self.clients.openWindow("/drive?s=home");
    }),
  );
});
