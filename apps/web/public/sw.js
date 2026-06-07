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
const IDB_NAME = "zobia-offline";
const IDB_VERSION = 1;

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

  // API requests — network-first; cache selected endpoints in IndexedDB for offline access
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(
      fetch(request).then(async (response) => {
        if (response.ok) {
          // Cache room messages: /api/rooms/<id>/messages
          const roomMsgMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)\/messages$/);
          if (roomMsgMatch && request.method === "GET") {
            const clone = response.clone();
            clone.json().then((data) => {
              idbPut("room_messages", { roomId: roomMsgMatch[1], data, cachedAt: Date.now() });
            }).catch(() => {});
          }

          // Cache user profile: /api/users/me or /api/profile/*
          if (
            (url.pathname === "/api/users/me" || url.pathname.startsWith("/api/profile/")) &&
            request.method === "GET"
          ) {
            const clone = response.clone();
            clone.json().then((data) => {
              idbPut("user_profile", { key: url.pathname, data, cachedAt: Date.now() });
            }).catch(() => {});
          }

          // Cache quest deck: /api/quests/deck
          if (url.pathname === "/api/quests/deck" && request.method === "GET") {
            const clone = response.clone();
            clone.json().then((data) => {
              idbPut("quest_deck", { key: "deck", data, cachedAt: Date.now() });
            }).catch(() => {});
          }
        }
        return response;
      }).catch(async () => {
        // Offline — try to serve from IndexedDB cache
        const roomMsgMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)\/messages$/);
        if (roomMsgMatch) {
          const cached = await idbGet("room_messages", roomMsgMatch[1]);
          if (cached) {
            return new Response(JSON.stringify(cached.data), {
              status: 200,
              headers: { "Content-Type": "application/json", "X-Served-From": "idb-cache" },
            });
          }
        }

        if (url.pathname === "/api/users/me" || url.pathname.startsWith("/api/profile/")) {
          const cached = await idbGet("user_profile", url.pathname);
          if (cached) {
            return new Response(JSON.stringify(cached.data), {
              status: 200,
              headers: { "Content-Type": "application/json", "X-Served-From": "idb-cache" },
            });
          }
        }

        if (url.pathname === "/api/quests/deck") {
          const cached = await idbGet("quest_deck", "deck");
          if (cached) {
            return new Response(JSON.stringify(cached.data), {
              status: 200,
              headers: { "Content-Type": "application/json", "X-Served-From": "idb-cache" },
            });
          }
        }

        return new Response(JSON.stringify({ error: "Offline" }), {
          status: 503,
          headers: { "Content-Type": "application/json" },
        });
      })
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
// IndexedDB helpers — offline read cache (PRD §22)
// Stores: room_messages, user_profile, quest_deck
// ---------------------------------------------------------------------------

function openIDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains("room_messages")) {
        db.createObjectStore("room_messages", { keyPath: "roomId" });
      }
      if (!db.objectStoreNames.contains("user_profile")) {
        db.createObjectStore("user_profile", { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains("quest_deck")) {
        db.createObjectStore("quest_deck", { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(storeName, record) {
  try {
    const db = await openIDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, "readwrite");
      tx.objectStore(storeName).put(record);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch { /* non-fatal */ }
}

async function idbGet(storeName, key) {
  try {
    const db = await openIDB();
    return new Promise((resolve) => {
      const tx = db.transaction(storeName, "readonly");
      const req = tx.objectStore(storeName).get(key);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => resolve(null);
    });
  } catch { return null; }
}

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
