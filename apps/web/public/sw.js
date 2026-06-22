// Minimal service worker — fallback used when @serwist/next build is disabled
// (NEXT_PUBLIC_PWA_WEB_ENABLED=false or Serwist SW generation failed).
//
// This file intentionally does NOT intercept any fetch events so that:
//   1. Auth routes (/api/auth/*, /auth/*) reach the server unmodified, allowing
//      Set-Cookie headers (CSRF state, session tokens) to be stored by the
//      browser's native cookie jar.
//   2. There is no risk of the "c.handle is not a function" Workbox bug that
//      was present in the previous Workbox 6.5.4 artifact committed here.
//
// When the Serwist build IS enabled, next build overwrites this file with the
// full generated service worker from app/sw.ts.

self.addEventListener("install", function () {
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    self.clients.claim().then(function () {
      return self.clients.matchAll({ type: "window" });
    }).then(function (clients) {
      clients.forEach(function (client) {
        client.postMessage({ type: "SW_UPDATED" });
      });
    })
  );
});

// No fetch handler — all requests go directly to the network.
// This preserves correct browser cookie behaviour for OAuth flows.
