/**
 * Zobia Social — PWA Service Worker
 *
 * Strategy:
 *  - App shell (JS/CSS/fonts) — cache-first with stale-while-revalidate
 *  - API requests            — network-first with offline fallback
 *  - Navigation              — network-first; fallback to /offline.html
 *  - Push notifications      — handled here; badge update + notification display
 */

const CACHE_NAME = "zobia-v1";
const OFFLINE_URL = "/offline.html";

// Resources to pre-cache on install (app shell)
const PRECACHE_URLS = [
  "/",
  "/offline.html",
  "/manifest.json",
];

// ---------------------------------------------------------------------------
// Install — pre-cache app shell
// ---------------------------------------------------------------------------

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  // Activate immediately without waiting for old SW to finish
  self.skipWaiting();
});

// ---------------------------------------------------------------------------
// Activate — prune stale caches
// ---------------------------------------------------------------------------

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

// ---------------------------------------------------------------------------
// Fetch — routing strategy
// ---------------------------------------------------------------------------

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle same-origin requests
  if (url.origin !== self.location.origin) return;

  // API requests — network-first, no caching
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(
      fetch(request).catch(() =>
        new Response(JSON.stringify({ error: "Offline" }), {
          status: 503,
          headers: { "Content-Type": "application/json" },
        })
      )
    );
    return;
  }

  // Navigation requests — network-first, fallback to offline page
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => caches.match(OFFLINE_URL))
    );
    return;
  }

  // Static assets — cache-first with network fallback
  event.respondWith(
    caches.match(request).then((cached) => {
      const networkFetch = fetch(request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      });
      return cached ?? networkFetch;
    })
  );
});

// ---------------------------------------------------------------------------
// Push notifications
// ---------------------------------------------------------------------------

self.addEventListener("push", (event) => {
  let data = { title: "Zobia", body: "You have a new notification.", data: {} };

  try {
    data = event.data ? event.data.json() : data;
  } catch {
    // malformed push payload — use defaults
  }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/icons/icon-192x192.png",
      badge: "/icons/badge-96x96.png",
      data: data.data ?? {},
      vibrate: [200, 100, 200],
    })
  );
});

// ---------------------------------------------------------------------------
// Notification click — open or focus the app
// ---------------------------------------------------------------------------

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const actionUrl = event.notification.data?.url ?? "/";

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if (client.url === actionUrl && "focus" in client) {
            return client.focus();
          }
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow(actionUrl);
        }
      })
  );
});
