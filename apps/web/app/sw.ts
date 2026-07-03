import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, RuntimeCaching, SerwistGlobalConfig } from "serwist";
import {
  CacheFirst,
  ExpirationPlugin,
  NetworkFirst,
  NetworkOnly,
  Serwist,
  StaleWhileRevalidate,
} from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const DAY_SECONDS = 24 * 60 * 60;

// IMPORTANT (BUG-SW-HANDLER): Serwist's `runtimeCaching[].handler` must be a
// Strategy *instance* that exposes a `.handle()` method (e.g. new NetworkOnly()).
// The previous config carried over the next-pwa / workbox-build syntax — string
// handler names ("NetworkOnly", "StaleWhileRevalidate", …) and a bare async
// function. Serwist has no `.handle` on those, so every matched request threw
// `TypeError: c.handle is not a function` inside the generated sw.js, which broke
// JS chunk loading and navigation. All handlers below are now real instances.
const runtimeCaching: RuntimeCaching[] = [
  // Auth routes must NOT be cached: NetworkOnly is a plain pass-through to the
  // network, so the browser's native cookie jar processes Set-Cookie on both the
  // OAuth initiation request and the callback navigation. (A bare fetch function
  // cannot be used here — see the BUG-SW-HANDLER note above.)
  {
    matcher: /^\/(auth|api\/auth)\/.*/i,
    handler: new NetworkOnly(),
  },
  // PWA entry point — network-first with a short timeout and offline fallback.
  {
    matcher: /^\/pwa-start.*/i,
    handler: new NetworkFirst({
      cacheName: "pwa-start",
      networkTimeoutSeconds: 3,
      plugins: [new ExpirationPlugin({ maxEntries: 1, maxAgeSeconds: DAY_SECONDS })],
    }),
  },
  // All API routes: NetworkOnly so responses (including auth-sensitive ones
  // like /api/users/me and /api/creator/wallet) are never served from cache.
  {
    matcher: /\/api\/.*$/i,
    handler: new NetworkOnly(),
  },
  // Google Fonts (long-lived, immutable).
  {
    matcher: /^https:\/\/fonts\.(gstatic|googleapis)\.com\/.*/i,
    handler: new CacheFirst({
      cacheName: "google-fonts",
      plugins: [new ExpirationPlugin({ maxEntries: 4, maxAgeSeconds: 365 * DAY_SECONDS })],
    }),
  },
  // Static font files.
  {
    matcher: /\.(?:eot|otf|ttc|ttf|woff|woff2|font\.css)$/i,
    handler: new StaleWhileRevalidate({ cacheName: "static-font-assets" }),
  },
  // Images.
  {
    matcher: /\.(?:jpg|jpeg|gif|png|svg|ico|webp)$/i,
    handler: new StaleWhileRevalidate({
      cacheName: "static-image-assets",
      plugins: [new ExpirationPlugin({ maxEntries: 64, maxAgeSeconds: DAY_SECONDS })],
    }),
  },
  // JS files.
  {
    matcher: /\.(?:js)$/i,
    handler: new StaleWhileRevalidate({
      cacheName: "static-js-assets",
      plugins: [new ExpirationPlugin({ maxEntries: 32, maxAgeSeconds: DAY_SECONDS })],
    }),
  },
  // CSS files.
  {
    matcher: /\.(?:css|less)$/i,
    handler: new StaleWhileRevalidate({
      cacheName: "static-style-assets",
      plugins: [new ExpirationPlugin({ maxEntries: 32, maxAgeSeconds: DAY_SECONDS })],
    }),
  },
  // Everything else (Serwist's sensible defaults for documents, etc.).
  ...defaultCache,
];

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  // skipWaiting + clientsClaim: activate the new SW immediately and take control
  // of existing clients. This is important for rolling out the BUG-SW-HANDLER fix
  // above: returning visitors are currently controlled by a broken sw.js whose
  // fetch handler throws on every request. Without skipWaiting they would stay
  // stuck on the broken worker until every tab is closed; with it, the corrected
  // worker recovers them on the next load.
  skipWaiting: true,
  clientsClaim: true,
  // Navigation preload disabled: when enabled it can cause the SW to intercept
  // navigation requests to auth routes and mis-handle them, breaking Set-Cookie
  // on OAuth redirects. Disabling it keeps auth cookie handling 100% native.
  navigationPreload: false,
  runtimeCaching,
});

serwist.addEventListeners();

// ---------------------------------------------------------------------------
// Web Push (ZSB-17)
// ---------------------------------------------------------------------------
//
// The Capacitor Android app registers for FCM push and handles foreground/
// background notification taps (apps/android/src/lib/push/index.ts); this
// service worker previously had no equivalent, so installed-PWA users never
// received a background push notification regardless of what the backend
// sent. `push` shows the OS-level notification; `notificationclick` focuses
// (or opens) a window and navigates to the notification's action route.
//
// Payload shape sent by lib/notifications/webPush.ts:
//   { title: string, body: string, data?: { action?: string, ... }, badge?: number }

interface WebPushPayload {
  title?: string;
  body?: string;
  data?: { action?: string; [key: string]: unknown };
  badge?: number;
}

self.addEventListener("push", (event) => {
  if (!event.data) return;

  let payload: WebPushPayload = {};
  try {
    payload = event.data.json() as WebPushPayload;
  } catch {
    return;
  }

  const title = payload.title || "Zobia";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: payload.body || "",
      icon: "/icons/icon-192x192.png",
      badge: "/icons/icon-72x72.png",
      data: payload.data ?? {},
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  // Only ever navigate to a same-origin relative path — the action comes
  // from our own server (lib/notifications/actionRoute.ts's bounded switch
  // statement), but this guard is defense-in-depth against a malformed or
  // unexpected payload ever carrying an absolute/external URL.
  const rawAction = (event.notification.data as { action?: unknown } | undefined)?.action;
  const path = typeof rawAction === "string" && rawAction.startsWith("/") ? rawAction : "/home";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) {
          if ("navigate" in client) {
            (client as WindowClient).navigate(new URL(path, self.location.origin).href).catch(() => {});
          }
          return client.focus();
        }
      }
      return self.clients.openWindow(path);
    })
  );
});
