/**
 * middleware.ts
 *
 * Next.js Edge Middleware for authentication and route protection.
 *
 * Route protection rules:
 *   - /(app)/*          → requires valid JWT access token
 *   - /(admin)/admin/*  → requires valid JWT + is_admin=true (from JWT claim;
 *                         the admin API routes re-verify against the DB)
 *   - /auth/*           → public (redirect to /app/home if already authenticated)
 *   - /api/auth/*       → public (login/refresh/logout endpoints)
 *   - /api/*            → protected (requires valid JWT)
 *   - Everything else   → public
 *
 * Note: is_admin is verified from the DB on every admin API request.
 * The middleware only checks the JWT claim as a fast pre-filter to avoid
 * DB calls on every edge request.
 */

import { type NextRequest, NextResponse } from "next/server";
import { jwtVerify, errors as JoseErrors } from "jose";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const ACCESS_TOKEN_COOKIE = "zobia_at";
const LOGIN_URL = "/auth/login";
const ADMIN_LOGIN_URL = "/(admin)/admin/login";
const HOME_URL = "/(app)/home";

/** Routes that are always public (no auth required). */
const PUBLIC_PREFIXES = [
  "/auth",
  "/api/auth",
  "/api/manifest",
  "/_next",
  "/favicon.ico",
  "/icons",
  "/manifest",
  "/sw.js",
  "/workbox-",
];

/** Routes that require admin JWT claim. */
const ADMIN_PREFIXES = ["/(admin)/admin"];

/** Routes that require a regular authenticated user. */
const APP_PREFIXES = ["/(app)", "/api"];

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

function isAppRoute(pathname: string): boolean {
  return APP_PREFIXES.some((prefix) => pathname.startsWith(prefix));
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
    // No Origin header — allow server-to-server requests that include service token
    const hasServiceAuth =
      request.headers.has("x-cron-secret") ||
      (request.headers.get("authorization") ?? "").startsWith("Bearer ");
    return hasServiceAuth;
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
 */
export async function middleware(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;
  const token = request.cookies.get(ACCESS_TOKEN_COOKIE)?.value;

  // CSRF check for all API mutation endpoints
  if (pathname.startsWith("/api/") && !isPublicRoute(pathname) && !isCsrfSafe(request)) {
    return NextResponse.json(
      { error: "Forbidden", code: "CSRF_ORIGIN_MISMATCH" },
      { status: 403 }
    );
  }

  // Allow admin login page without auth
  if (pathname === ADMIN_LOGIN_URL || pathname === "/admin/login") {
    if (token) {
      const payload = await verifyToken(token);
      if (payload?.is_admin) {
        return NextResponse.redirect(new URL("/(admin)/admin", request.url));
      }
    }
    return NextResponse.next();
  }

  // Public routes – pass through
  if (isPublicRoute(pathname)) {
    // Redirect authenticated users away from login page
    if (pathname.startsWith("/auth/login") && token) {
      const payload = await verifyToken(token);
      if (payload?.sub) {
        return NextResponse.redirect(new URL(HOME_URL, request.url));
      }
    }
    return NextResponse.next();
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

    // Pass admin identity in headers for downstream use
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-user-id", payload.sub ?? "");
    requestHeaders.set("x-is-admin", "true");
    requestHeaders.set("x-session-id", payload.sid ?? "");

    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  // App / API routes – require authenticated user
  if (isAppRoute(pathname)) {
    if (!token) {
      // API routes return JSON 401
      if (pathname.startsWith("/api/")) {
        return NextResponse.json(
          { error: "Unauthorised", code: "MISSING_TOKEN" },
          { status: 401 }
        );
      }
      const loginUrl = new URL(LOGIN_URL, request.url);
      loginUrl.searchParams.set("redirect", pathname);
      return NextResponse.redirect(loginUrl);
    }

    const payload = await verifyToken(token);

    if (!payload?.sub) {
      if (pathname.startsWith("/api/")) {
        return NextResponse.json(
          { error: "Unauthorised", code: "INVALID_TOKEN" },
          { status: 401 }
        );
      }
      const loginUrl = new URL(LOGIN_URL, request.url);
      loginUrl.searchParams.set("redirect", pathname);
      const response = NextResponse.redirect(loginUrl);
      response.cookies.set(ACCESS_TOKEN_COOKIE, "", { maxAge: 0 });
      return response;
    }

    // Forward user identity to route handlers via headers
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-user-id", payload.sub);
    requestHeaders.set("x-is-admin", String(payload.is_admin ?? false));
    requestHeaders.set("x-session-id", payload.sid ?? "");

    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  return NextResponse.next();
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
