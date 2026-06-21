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
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  // Auth routes must bypass the service worker entirely so the browser
  // handles Set-Cookie headers on OAuth redirects natively.
  runtimeCaching: [
    {
      matcher: /^\/(auth|api\/auth)\/.*/i,
      handler: "NetworkOnly",
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
    // SW-STALE-01: auth-sensitive API endpoints must always be NetworkOnly
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
