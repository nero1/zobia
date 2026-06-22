import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { Serwist } from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: false,
  clientsClaim: true,
  // Navigation preload disabled: when enabled it can cause the SW to intercept
  // navigation requests to auth routes and mis-handle them, breaking Set-Cookie
  // on OAuth redirects. Disabling it keeps auth cookie handling 100% native.
  navigationPreload: false,
  runtimeCaching: [
    // Auth routes must NOT go through a Workbox/Serwist caching strategy.
    // Using a raw fetch() passthrough ensures the browser's native cookie jar
    // processes Set-Cookie headers correctly on both the initiation fetch and
    // the OAuth callback navigation — the "session_expired" bug was caused by
    // the old NetworkOnly strategy failing (c.handle is not a function) and
    // silently dropping Set-Cookie on the CSRF state cookie response.
    {
      matcher: /^\/(auth|api\/auth)\/.*/i,
      handler: async ({ request, event }) => {
        // Navigation preload is disabled, but guard anyway.
        const fetchEvent = event as FetchEvent & { preloadResponse?: Promise<Response | undefined> };
        if (fetchEvent.preloadResponse) {
          const preloaded = await fetchEvent.preloadResponse;
          if (preloaded) return preloaded;
        }
        return fetch(request);
      },
    },
    // PWA entry point — network-first with offline fallback
    {
      matcher: /^\/pwa-start.*/i,
      handler: "NetworkFirst",
      options: {
        cacheName: "pwa-start",
        networkTimeoutSeconds: 3,
        expiration: { maxEntries: 1, maxAgeSeconds: 24 * 60 * 60 },
      },
    },
    // Auth-sensitive API endpoints must always be NetworkOnly
    {
      matcher: /\/api\/users\/me(\/|$|\?)/i,
      handler: "NetworkOnly",
    },
    {
      matcher: /\/api\/creator\/wallet(\/|$|\?)/i,
      handler: "NetworkOnly",
    },
    // All API routes: NetworkOnly to prevent caching API responses
    {
      matcher: /\/api\/.*$/i,
      handler: "NetworkOnly",
    },
    // Google Fonts
    {
      matcher: /^https:\/\/fonts\.(gstatic|googleapis)\.com\/.*/i,
      handler: "CacheFirst",
      options: {
        cacheName: "google-fonts",
        expiration: { maxEntries: 4, maxAgeSeconds: 365 * 24 * 60 * 60 },
      },
    },
    // Static font files
    {
      matcher: /\.(?:eot|otf|ttc|ttf|woff|woff2|font\.css)$/i,
      handler: "StaleWhileRevalidate",
      options: { cacheName: "static-font-assets" },
    },
    // Images
    {
      matcher: /\.(?:jpg|jpeg|gif|png|svg|ico|webp)$/i,
      handler: "StaleWhileRevalidate",
      options: {
        cacheName: "static-image-assets",
        expiration: { maxEntries: 64, maxAgeSeconds: 24 * 60 * 60 },
      },
    },
    // JS files
    {
      matcher: /\.(?:js)$/i,
      handler: "StaleWhileRevalidate",
      options: {
        cacheName: "static-js-assets",
        expiration: { maxEntries: 32, maxAgeSeconds: 24 * 60 * 60 },
      },
    },
    // CSS files
    {
      matcher: /\.(?:css|less)$/i,
      handler: "StaleWhileRevalidate",
      options: { cacheName: "static-style-assets", expiration: { maxEntries: 32, maxAgeSeconds: 24 * 60 * 60 } },
    },
    // Everything else
    ...defaultCache,
  ],
});

serwist.addEventListeners();
