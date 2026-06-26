/** @type {import('next').NextConfig} */
// PWA per-platform toggle (PRD §3, §20, §22):
// Admin controls web/Android/iOS PWA independently from the admin panel
// via x_manifest keys pwa_web_enabled, pwa_android_enabled, pwa_ios_enabled.
// At build time we use the NEXT_PUBLIC_PWA_WEB_ENABLED env var (set by CI/CD
// or Vercel env from admin config). At runtime the app layout also checks the
// manifest and conditionally renders the <link rel="manifest"> tag.
const pwaWebEnabled = process.env.NEXT_PUBLIC_PWA_WEB_ENABLED !== "false";

// TASK-21: Migrated from next-pwa v5 (webpack 4) to @serwist/next (webpack 5 / Next.js 15 compatible).
// @serwist/next is the maintained successor to workbox-based next-pwa.
const withSerwist = require("@serwist/next").default({
  swSrc: "app/sw.ts",
  swDest: "public/sw.js",
  disable: process.env.NODE_ENV === "development" || !pwaWebEnabled,
  // SW-API-01 + SW-ADMIN-01: exclude API and admin chunks from precache
  exclude: [
    /chunks\/app\/api\//,
    /chunks\/app\/\(admin\)\//,
    /chunks\/app\/auth\/callback\//,
  ],
});

const securityHeaders = [
  {
    key: "X-DNS-Prefetch-Control",
    value: "on",
  },
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  // Report-To, Strict-Transport-Security, and Permissions-Policy are set
  // per-request in middleware.ts (withCsp) to avoid duplicate conflicting
  // headers. Do not add them here.
  // Content-Security-Policy is set dynamically per-request in middleware.ts
  // with a per-request nonce. Removing it here prevents duplicate CSP headers
  // which would otherwise cause browsers to AND both policies (the static one
  // would weaken the middleware's stricter nonce-based policy).
];

const nextConfig = {
  // BUG-018 FIX: Suppress the X-Powered-By: Next.js response header to avoid
  // leaking implementation details to potential attackers.
  poweredByHeader: false,
  // Transpile the shared workspace package so its runtime ESM/TS utilities
  // (slug + referral helpers in @zobia/shared/utils) compile inside the Next
  // build instead of being treated as pre-built node_modules.
  transpilePackages: ["@zobia/shared"],
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
      {
        // iOS requires the Apple App Site Association file to be served as
        // application/json. It has no file extension, so set it explicitly.
        source: "/.well-known/apple-app-site-association",
        headers: [{ key: "Content-Type", value: "application/json" }],
      },
    ];
  },
  images: {
    remotePatterns: [
      // Use a single-level wildcard (*) instead of double-wildcard (**) to avoid
      // accepting arbitrary deep subdomains that could be attacker-controlled.
      // Operators should set NEXT_PUBLIC_SUPABASE_HOST to their specific project host.
      {
        protocol: "https",
        hostname: process.env.NEXT_PUBLIC_SUPABASE_HOST || "*.supabase.co",
      },
      {
        protocol: "https",
        hostname: process.env.NEXT_PUBLIC_SUPABASE_IN_HOST || "*.supabase.in",
      },
      {
        protocol: "https",
        hostname: process.env.NEXT_PUBLIC_R2_DEV_HOST || "*.r2.dev",
      },
      {
        protocol: "https",
        hostname: process.env.NEXT_PUBLIC_R2_STORAGE_HOST || "*.r2.cloudflarestorage.com",
      },
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
      { protocol: "https", hostname: "t.me" },
      { protocol: "https", hostname: "telegram.org" },
    ],
  },
  serverExternalPackages: ["pg", "ioredis"],
};

module.exports = withSerwist(nextConfig);
