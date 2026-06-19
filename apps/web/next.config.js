/** @type {import('next').NextConfig} */
// PWA per-platform toggle (PRD §3, §20, §22):
// Admin controls web/Android/iOS PWA independently from the admin panel
// via x_manifest keys pwa_web_enabled, pwa_android_enabled, pwa_ios_enabled.
// At build time we use the NEXT_PUBLIC_PWA_WEB_ENABLED env var (set by CI/CD
// or Vercel env from admin config). At runtime the app layout also checks the
// manifest and conditionally renders the <link rel="manifest"> tag.
const pwaWebEnabled = process.env.NEXT_PUBLIC_PWA_WEB_ENABLED !== "false";

const withPWA = require("next-pwa")({
  dest: "public",
  register: true,
  skipWaiting: true,
  disable: process.env.NODE_ENV === "development" || !pwaWebEnabled,
  // SW-API-01 + SW-ADMIN-01: exclude API route chunks and admin page chunks from the
  // precache manifest. These are server-only and must never be precached by the SW.
  buildExcludes: [
    /chunks\/app\/api\//,
    /chunks\/app\/\(admin\)\//,
    /chunks\/app\/auth\/callback\//,
  ],
  runtimeCaching: [
    // Auth routes must bypass the service worker entirely so the browser
    // handles Set-Cookie headers on OAuth redirects natively. If the SW
    // intercepts the /auth/callback redirect, cookies from that response
    // may not be stored, breaking session establishment.
    {
      urlPattern: /^\/(auth|api\/auth)\/.*/i,
      handler: "NetworkOnly",
    },
    // PWA entry point — prefer the network (so a launch with connectivity always
    // gets the freshest redirect target), but fall back to the cached copy when
    // offline. Without a cached fallback an offline launch of the installed PWA
    // would dead-end on the SW's offline page instead of opening the app. The
    // page itself is a trivial client-side redirect that re-checks auth against
    // the server, so a cached copy is never stale in any meaningful way.
    {
      urlPattern: /^\/pwa-start.*/i,
      handler: "NetworkFirst",
      options: {
        cacheName: "pwa-start",
        networkTimeoutSeconds: 3,
        expiration: { maxEntries: 1, maxAgeSeconds: 24 * 60 * 60 },
      },
    },
    {
      urlPattern: /^https:\/\/fonts\.(gstatic|googleapis)\.com\/.*/i,
      handler: "CacheFirst",
      options: {
        cacheName: "google-fonts",
        expiration: { maxEntries: 4, maxAgeSeconds: 365 * 24 * 60 * 60 },
      },
    },
    {
      urlPattern: /\.(?:eot|otf|ttc|ttf|woff|woff2|font\.css)$/i,
      handler: "StaleWhileRevalidate",
      options: { cacheName: "static-font-assets" },
    },
    {
      urlPattern: /\.(?:jpg|jpeg|gif|png|svg|ico|webp)$/i,
      handler: "StaleWhileRevalidate",
      options: {
        cacheName: "static-image-assets",
        expiration: { maxEntries: 64, maxAgeSeconds: 24 * 60 * 60 },
      },
    },
    {
      urlPattern: /\.(?:js)$/i,
      handler: "StaleWhileRevalidate",
      options: {
        cacheName: "static-js-assets",
        expiration: { maxEntries: 32, maxAgeSeconds: 24 * 60 * 60 },
      },
    },
    {
      urlPattern: /\.(?:css|less)$/i,
      handler: "StaleWhileRevalidate",
      options: {
        cacheName: "static-style-assets",
        expiration: { maxEntries: 32, maxAgeSeconds: 24 * 60 * 60 },
      },
    },
    // SW-STALE-01: auth-sensitive endpoints must always be NetworkOnly — no stale data
    {
      urlPattern: /\/api\/users\/me(\/|$|\?)/i,
      handler: "NetworkOnly",
    },
    {
      urlPattern: /\/api\/creator\/wallet(\/|$|\?)/i,
      handler: "NetworkOnly",
    },
    {
      urlPattern: /\/api\/.*$/i,
      handler: "NetworkOnly",
    },
    {
      urlPattern: /.*/i,
      handler: "NetworkFirst",
      options: {
        cacheName: "others",
        expiration: { maxEntries: 32, maxAgeSeconds: 24 * 60 * 60 },
        networkTimeoutSeconds: 10,
      },
    },
  ],
});

const securityHeaders = [
  {
    key: "X-DNS-Prefetch-Control",
    value: "on",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  {
    key: "X-Frame-Options",
    value: "SAMEORIGIN",
  },
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
  },
  // Report-To: configure browser CSP violation reporting endpoint (STRUC-10)
  {
    key: "Report-To",
    value: JSON.stringify({
      group: "csp-endpoint",
      max_age: 10886400,
      endpoints: [{ url: "/api/security/csp-report" }],
    }),
  },
  // Content-Security-Policy is set dynamically per-request in middleware.ts
  // with a per-request nonce. Removing it here prevents duplicate CSP headers
  // which would otherwise cause browsers to AND both policies (the static one
  // would weaken the middleware's stricter nonce-based policy).
];

const nextConfig = {
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**.supabase.co" },
      { protocol: "https", hostname: "**.supabase.in" },
      { protocol: "https", hostname: "**.r2.dev" },
      { protocol: "https", hostname: "**.r2.cloudflarestorage.com" },
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
      { protocol: "https", hostname: "t.me" },
      { protocol: "https", hostname: "telegram.org" },
    ],
  },
  serverExternalPackages: ["pg", "ioredis"],
};

module.exports = withPWA(nextConfig);
