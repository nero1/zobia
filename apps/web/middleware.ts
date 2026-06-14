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
import { jwtVerify, errors as JoseErrors } from "jose";

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
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob: https:",
    "connect-src 'self' https: wss:",
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
  "/api/health",
  "/api/manifest",
  // CSP violation reports from browsers (no auth, unauthenticated browsers send these)
  "/api/security/csp-report",
  // CRON endpoints authenticate via CRON_SECRET (Bearer token), not JWT cookies.
  // The middleware must let them through so the route handler can verify the secret.
  "/api/cron",
  // Public profile/room read views for SEO crawlers
  "/u/",
  "/r/",
  "/_next",
  "/favicon.ico",
  "/icons",
  "/manifest",
  "/sw.js",
  "/workbox-",
  "/terms",
  "/privacy",
  "/onboarding",
  // PWA entry — handles its own auth-check + redirect client-side
  "/pwa-start",
];

/** Routes that require admin JWT claim. */
const ADMIN_PREFIXES = ["/admin"];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function encodeSecret(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

interface TokenPayload {
  sub?: string;
  is_admin?: boolean;
  sid?: string;
}

async function verifyToken(token: string): Promise<TokenPayload | null> {
  const secret = process.env["JWT_SECRET"];
  if (!secret) return null;

  try {
    const { payload } = await jwtVerify(token, encodeSecret(secret), {
      issuer: "zobia-social",
      audience: "zobia-web",
    });
    return payload as TokenPayload;
  } catch (err) {
    if (err instanceof JoseErrors.JWTExpired) return null;
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
    const hasCronSecret = !!process.env.CRON_SECRET &&
      request.headers.get("x-cron-secret") === process.env.CRON_SECRET;
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
  const token = request.cookies.get(ACCESS_TOKEN_COOKIE)?.value;

  // Generate a per-request nonce for Content-Security-Policy.
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = buildCsp(nonce);

  // Helper: wrap any NextResponse.next() with the CSP header and nonce.
  function withCsp(requestHeaders: Headers): NextResponse {
    requestHeaders.set("x-nonce", nonce);
    const res = NextResponse.next({ request: { headers: requestHeaders } });
    res.headers.set("Content-Security-Policy", csp);
    // BUG-29: additional hardening headers
    res.headers.set("Cross-Origin-Opener-Policy", "same-origin");
    res.headers.set("Cross-Origin-Resource-Policy", "same-origin");
    res.headers.set("Cross-Origin-Embedder-Policy", "credentialless");
    res.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
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
      if (payload?.sub) {
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
        return res;
      }
      const loginUrl = new URL(LOGIN_URL, request.url);
      loginUrl.searchParams.set("redirect", pathname);
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
        return res;
      }
      const loginUrl = new URL(LOGIN_URL, request.url);
      loginUrl.searchParams.set("redirect", pathname);
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
