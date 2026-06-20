/**
 * middleware.ts
 *
 * Next.js Edge Middleware for authentication and route protection.
 *
 * Route protection rules:
 *   - /admin/*          → requires valid JWT + is_admin=true (from JWT claim;
 *                         the admin API routes re-verify against the DB)
 *   - /auth/*           → public (redirect to /home if already authenticated)
 *   - /api/auth/*       → public (login/refresh/logout endpoints)
 *   - /terms, /privacy, /onboarding → public
 *   - Everything else   → requires valid JWT access token (default-deny)
 *
 * Note: is_admin is verified from the DB on every admin API request.
 * The middleware only checks the JWT claim as a fast pre-filter to avoid
 * DB calls on every edge request.
 */

import { type NextRequest, NextResponse } from "next/server";
import { verifyAccessToken } from "@/lib/auth/jwt";

// ---------------------------------------------------------------------------
// CSP nonce helpers
// ---------------------------------------------------------------------------

/**
 * Build a per-request Content-Security-Policy string.
 *
 * Uses 'nonce-<nonce>' and 'strict-dynamic' in script-src (no 'unsafe-inline').
 * Browsers that support CSP Level 3 (Chrome 67+, Firefox 68+, Safari 15.4+)
 * enforce the nonce for inline scripts and propagate trust to dynamically
 * loaded scripts via 'strict-dynamic' (required by Next.js chunk loading).
 * 'unsafe-inline' is intentionally omitted — it would silently override the
 * nonce protection in supporting browsers (BUG-30).
 */
function buildCsp(nonce: string): string {
  // Allowlist for connect-src: include all realtime providers the app supports
  // (Supabase, Ably, Pusher) plus Sentry browser-side error ingestion.
  // Prefer the specific Supabase project URL when set to avoid a wildcard.
  const supabaseOrigin = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");
  const supabaseWss = supabaseOrigin
    ? supabaseOrigin.replace(/^https?:/, "wss:")
    : "";
  const connectSrc = [
    "'self'",
    // Supabase Realtime (HTTP + WebSocket)
    supabaseOrigin || "https://*.supabase.co",
    supabaseWss || "wss://*.supabase.co",
    // Ably Realtime (HTTP + WebSocket)
    "https://realtime.ably.io",
    "wss://realtime.ably.io",
    "wss://*.ably.io",
    "wss://*.ably-realtime.com",
    // Pusher Channels (WebSocket only — HTTP auth goes through 'self')
    "wss://*.pusher.com",
    // Sentry browser SDK — error reporting ingest
    "https://*.ingest.sentry.io",
    "https://*.ingest.us.sentry.io",
  ].filter(Boolean).join(" ");

  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    `style-src 'self' 'nonce-${nonce}' https://fonts.googleapis.com`,
    "worker-src 'self'",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob: https:",
    `connect-src ${connectSrc}`,
    "frame-src 'self' https://www.google.com https://challenges.cloudflare.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
    "upgrade-insecure-requests",
    // STRUC-10: CSP violation reporting
    "report-to csp-endpoint",
    "report-uri /api/security/csp-report",
  ].join("; ");
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const ACCESS_TOKEN_COOKIE = "zobia_at";
const REFRESH_TOKEN_COOKIE = "zobia_rt";
const LOGIN_URL = "/auth/login";
const ADMIN_LOGIN_URL = "/admin/login";
const HOME_URL = "/home";

/** Routes that are always public (no auth required). */
const PUBLIC_PREFIXES = [
  "/auth",
  "/api/auth",
  "/api/auth/silent-refresh",
  "/api/health",
  // /api/manifest is intentionally NOT listed here — it exposes app configuration
  // (feature flags, payment params) and must require authentication.
  // Unauthenticated callers should use /api/public/config for the minimal safe subset.
  // UI configuration — safe to expose without auth (no user data returned)
  "/api/config",
  // Public slug/username → internal id resolver for deep links (read-only,
  // returns only public/live entities). Used by the Expo universal-link screens.
  "/api/public",
  // CSP violation reports from browsers (no auth, unauthenticated browsers send these)
  "/api/security/csp-report",
  // CRON endpoints authenticate via CRON_SECRET (Bearer token), not JWT cookies.
  // The middleware must let them through so the route handler can verify the secret.
  "/api/cron",
  // Public profile/room/course/game read views for SEO crawlers
  "/u/",
  "/r/",
  "/c/",
  "/g/",
  "/_next",
  "/favicon.ico",
  // App-link association files for Android (assetlinks.json) and iOS
  // (apple-app-site-association) — must be fetchable by the OS without auth.
  "/.well-known",
  "/icons",
  "/manifest",
  "/sw.js",
  "/workbox-",
  "/terms",
  "/privacy",
  "/onboarding",
  // Static images served from /public — must be reachable by crawlers/OG scrapers
  "/og-image.png",
  "/og-image",
  // PWA screenshots used in the web app manifest (install prompt, store listings)
  "/screenshots",
  // PWA entry — handles its own auth-check + redirect client-side
  "/pwa-start",
  // Payment provider webhook endpoints — authenticated via HMAC signatures,
  // not browser Origin header. These must bypass CSRF checks.
  "/api/economy/webhooks/paystack",
  "/api/economy/webhooks/dodopayments",
];

/** Routes that require admin JWT claim. */
const ADMIN_PREFIXES = ["/admin"];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface TokenPayload {
  sub?: string;
  is_admin?: boolean;
  sid?: string;
  type?: string;
}

async function verifyToken(token: string): Promise<TokenPayload | null> {
  try {
    // Uses kid-based key registry for multi-key rotation support (S-01)
    const payload = await verifyAccessToken(token);
    return payload as TokenPayload;
  } catch {
    return null;
  }
}

function isPublicRoute(pathname: string): boolean {
  if (pathname === "/" || pathname === "") return true;
  return PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function isAdminRoute(pathname: string): boolean {
  return ADMIN_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function isAppRoute(_pathname: string): boolean {
  // Default-deny: everything not public and not admin requires authentication.
  // This correctly covers all (app) route group pages (/home, /rooms, /events, etc.)
  // as well as all /api routes.
  return true;
}

// ---------------------------------------------------------------------------
// CSRF helpers
// ---------------------------------------------------------------------------

const CSRF_SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Validates the Origin header for state-mutating API requests.
 * Rejects cross-origin mutations unless they come from the configured app URL
 * or the same host as the request.
 */
function isCsrfSafe(request: NextRequest): boolean {
  const method = request.method.toUpperCase();
  if (CSRF_SAFE_METHODS.has(method)) return true;

  const origin = request.headers.get("origin");
  if (!origin) {
    // No Origin header — only allow specific CRON paths with the CRON secret header
    const isCronPath = request.nextUrl.pathname.startsWith("/api/cron/");
    const authHeader = request.headers.get("authorization") ?? "";
    const hasCronSecret = !!process.env.CRON_SECRET &&
      authHeader === `Bearer ${process.env.CRON_SECRET}`;
    return isCronPath && hasCronSecret;
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const requestOrigin = new URL(request.url).origin;

  // Allow requests from our own origin or configured app URL
  return origin === requestOrigin || (appUrl !== "" && origin === appUrl);
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

/**
 * Next.js Edge Middleware.
 * Runs before every request to enforce authentication rules.
 * Also generates a per-request CSP nonce and forwards it via the
 * x-nonce request header so server components can apply it to inline scripts.
 */
export async function middleware(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;
  // Access token comes from the cookie (web/PWA) or an Authorization: Bearer
  // header (native app + the in-WebView game embed, which have no cookie jar).
  const bearerHeader = request.headers.get("authorization") ?? "";
  const bearerToken = bearerHeader.startsWith("Bearer ")
    ? bearerHeader.slice(7).trim() || undefined
    : undefined;
  const token = request.cookies.get(ACCESS_TOKEN_COOKIE)?.value ?? bearerToken;

  // Generate a per-request nonce for Content-Security-Policy.
  const nonce = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("base64");
  const csp = buildCsp(nonce);

  // Generate a per-request trace ID for observability (OBS-TRACE-01).
  const requestId = crypto.randomUUID();

  // Helper: wrap any NextResponse.next() with the CSP header and nonce.
  function withCsp(requestHeaders: Headers): NextResponse {
    requestHeaders.set("x-nonce", nonce);
    requestHeaders.set("x-request-id", requestId);
    const res = NextResponse.next({ request: { headers: requestHeaders } });
    res.headers.set("Content-Security-Policy", csp);
    res.headers.set("X-Request-ID", requestId);
    // FIX-M02: Report-To header activates the Reporting API for modern browsers.
    // Without this, the CSP `report-to csp-endpoint` directive is silently ignored.
    res.headers.set(
      "Report-To",
      JSON.stringify({
        group: "csp-endpoint",
        max_age: 10886400,
        endpoints: [{ url: "/api/security/csp-report" }],
      })
    );
    // additional hardening headers
    res.headers.set("Cross-Origin-Opener-Policy", "same-origin");
    res.headers.set("Cross-Origin-Resource-Policy", "same-origin");
    res.headers.set("Cross-Origin-Embedder-Policy", "credentialless");
    res.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
    res.headers.set("X-Content-Type-Options", "nosniff");
    res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
    // SEC-HSTS-01: HSTS in production only (non-prod may be HTTP).
    if (process.env.NODE_ENV === "production") {
      res.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
    }
    return res;
  }

  // CSRF check for all API mutation endpoints (including auth POSTs but not GET callbacks)
  const isAuthMutation =
    pathname.startsWith("/api/auth/") &&
    !CSRF_SAFE_METHODS.has(request.method.toUpperCase());

  if (((pathname.startsWith("/api/") && !isPublicRoute(pathname)) || isAuthMutation) && !isCsrfSafe(request)) {
    const res = NextResponse.json(
      { error: "Forbidden", code: "CSRF_ORIGIN_MISMATCH" },
      { status: 403 }
    );
    res.headers.set("Content-Security-Policy", csp);
    res.headers.set("X-Content-Type-Options", "nosniff");
    res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
    return res;
  }

  // Allow admin login page without auth
  if (pathname === ADMIN_LOGIN_URL) {
    if (token) {
      const payload = await verifyToken(token);
      if (payload?.is_admin) {
        return NextResponse.redirect(new URL("/admin", request.url));
      }
    }
    return withCsp(new Headers(request.headers));
  }

  // Public routes – pass through
  if (isPublicRoute(pathname)) {
    // Redirect authenticated users away from login page and root landing page
    if ((pathname.startsWith("/auth/login") || pathname === "/" || pathname === "") && token) {
      const payload = await verifyToken(token);
      if (payload?.sub && payload?.type !== 'pre_auth') {
        return NextResponse.redirect(new URL(HOME_URL, request.url));
      }
    }
    return withCsp(new Headers(request.headers));
  }

  // Admin routes – check JWT + is_admin claim
  if (isAdminRoute(pathname)) {
    if (!token) {
      const loginUrl = new URL(ADMIN_LOGIN_URL, request.url);
      loginUrl.searchParams.set("redirect", pathname);
      return NextResponse.redirect(loginUrl);
    }

    const payload = await verifyToken(token);

    if (!payload?.sub) {
      const loginUrl = new URL(ADMIN_LOGIN_URL, request.url);
      loginUrl.searchParams.set("redirect", pathname);
      const response = NextResponse.redirect(loginUrl);
      // Clear expired/invalid cookie
      response.cookies.set(ACCESS_TOKEN_COOKIE, "", { maxAge: 0 });
      return response;
    }

    if (!payload.is_admin) {
      // Valid token but not admin – redirect to app
      return NextResponse.redirect(new URL(HOME_URL, request.url));
    }

    const requestHeaders = new Headers(request.headers);
    // Strip inbound identity headers that could be client-spoofed
    requestHeaders.delete("x-user-id");
    requestHeaders.delete("x-is-admin");
    requestHeaders.delete("x-session-id");
    return withCsp(requestHeaders);
  }

  // App / API routes – require authenticated user
  if (isAppRoute(pathname)) {
    if (!token) {
      if (pathname.startsWith("/api/")) {
        const res = NextResponse.json(
          { error: "Unauthorised", code: "MISSING_TOKEN" },
          { status: 401 }
        );
        res.headers.set("Content-Security-Policy", csp);
        res.headers.set("X-Content-Type-Options", "nosniff");
        res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
        return res;
      }
      // Page route: attempt silent refresh if a refresh token cookie is present
      const refreshToken = request.cookies.get(REFRESH_TOKEN_COOKIE)?.value;
      if (refreshToken) {
        const silentRefreshUrl = new URL("/api/auth/silent-refresh", request.url);
        silentRefreshUrl.searchParams.set("to", pathname);
        return NextResponse.redirect(silentRefreshUrl);
      }
      const loginUrl = new URL(LOGIN_URL, request.url);
      loginUrl.searchParams.set("redirect", pathname);
      loginUrl.searchParams.set("reason", "session_expired");
      return NextResponse.redirect(loginUrl);
    }

    const payload = await verifyToken(token);

    if (!payload?.sub) {
      if (pathname.startsWith("/api/")) {
        const res = NextResponse.json(
          { error: "Unauthorised", code: "INVALID_TOKEN" },
          { status: 401 }
        );
        res.headers.set("Content-Security-Policy", csp);
        res.headers.set("X-Content-Type-Options", "nosniff");
        res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
        return res;
      }
      // Page route: attempt silent refresh if a refresh token cookie is present
      const refreshToken = request.cookies.get(REFRESH_TOKEN_COOKIE)?.value;
      if (refreshToken) {
        const silentRefreshUrl = new URL("/api/auth/silent-refresh", request.url);
        silentRefreshUrl.searchParams.set("to", pathname);
        const response = NextResponse.redirect(silentRefreshUrl);
        response.cookies.set(ACCESS_TOKEN_COOKIE, "", { maxAge: 0 });
        return response;
      }
      const loginUrl = new URL(LOGIN_URL, request.url);
      loginUrl.searchParams.set("redirect", pathname);
      loginUrl.searchParams.set("reason", "session_expired");
      const response = NextResponse.redirect(loginUrl);
      response.cookies.set(ACCESS_TOKEN_COOKIE, "", { maxAge: 0 });
      return response;
    }

    // Strip inbound spoofed identity headers — handlers re-verify JWT themselves
    const requestHeaders = new Headers(request.headers);
    requestHeaders.delete("x-user-id");
    requestHeaders.delete("x-is-admin");
    requestHeaders.delete("x-session-id");
    return withCsp(requestHeaders);
  }

  return withCsp(new Headers(request.headers));
}

// ---------------------------------------------------------------------------
// Matcher – run middleware on all routes except static assets
// ---------------------------------------------------------------------------

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimisation)
     * - favicon.ico
     */
    "/((?!_next/static|_next/image|favicon\\.ico).*)",
  ],
};
