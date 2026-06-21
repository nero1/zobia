/**
 * lib/security/csrf.ts
 *
 * CSRF state token generation and validation for OAuth flows and
 * other state-changing requests that originate from a browser redirect.
 *
 * Strategy:
 *   - A random token is generated and stored in a short-lived, HttpOnly,
 *     SameSite=Lax cookie before the user is redirected to an external
 *     OAuth provider.
 *   - When the provider redirects back, the `state` query parameter is
 *     compared against the cookie value.
 *   - Tokens are single-use: validated and then cleared.
 *
 * For standard JSON API mutations, rely on SameSite=Lax cookies + CORS
 * headers rather than per-request CSRF tokens.
 */

import { randomBytes, timingSafeEqual } from "crypto";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Name of the cookie that carries the CSRF state token. */
export const CSRF_COOKIE_NAME = "zobia_csrf_state";

/** Lifetime of the CSRF cookie in seconds (10 minutes). */
const CSRF_TTL_SECONDS = 10 * 60;

// ---------------------------------------------------------------------------
// Token generation
// ---------------------------------------------------------------------------

/**
 * Generate a cryptographically random CSRF state token (64 hex chars).
 *
 * Store this value in a `Set-Cookie` header before redirecting to OAuth.
 * Pass it as the `state` query parameter in the OAuth redirect URL.
 *
 * @returns Hex-encoded 32-byte random token
 */
export function generateCsrfToken(): string {
  return randomBytes(32).toString("hex");
}

/**
 * Build a `Set-Cookie` header value for the CSRF state cookie.
 *
 * @param token  - Token from `generateCsrfToken()`
 * @param secure - Whether to set the Secure attribute (true in production)
 * @returns Raw cookie string for use in a `Set-Cookie` header
 */
export function buildCsrfCookie(
  token: string,
  secure = process.env.NODE_ENV === "production"
): string {
  return (
    `${CSRF_COOKIE_NAME}=${token}; ` +
    `HttpOnly; Path=/; SameSite=Lax; Max-Age=${CSRF_TTL_SECONDS}` +
    (secure ? "; Secure" : "")
  );
}

/**
 * Build a `Set-Cookie` header value that clears the CSRF cookie.
 *
 * @returns Raw cookie string that expires the CSRF cookie
 */
export function clearCsrfCookie(): string {
  return `${CSRF_COOKIE_NAME}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`;
}

// ---------------------------------------------------------------------------
// Token validation
// ---------------------------------------------------------------------------

/**
 * Validate the `state` parameter from an OAuth callback against the stored
 * CSRF cookie value.
 *
 * Uses `timingSafeEqual` to prevent timing attacks.
 *
 * @param cookieHeader - Raw `Cookie` header from the incoming request
 * @param stateParam   - `state` query parameter from the OAuth callback
 * @returns `true` if the values match, `false` otherwise
 */
export function validateCsrfState(
  cookieHeader: string | null,
  stateParam: string | null
): boolean {
  if (!cookieHeader || !stateParam) return false;

  const storedToken = extractCsrfFromCookieHeader(cookieHeader);
  if (!storedToken) return false;

  // BUG-L01: The previous length check (`storedToken.length !== stateParam.length`)
  // leaked whether the attacker had the correct token length via a timing difference.
  // timingSafeEqual already returns false for buffers of different lengths; pad both
  // to the expected CSRF token length so the comparison is always constant-time.
  // CSRF tokens are always 64 hex chars (32 bytes). Tokens of wrong length are invalid.
  const EXPECTED_LENGTH = 64;
  try {
    const a = Buffer.alloc(EXPECTED_LENGTH, 0);
    const b = Buffer.alloc(EXPECTED_LENGTH, 0);
    Buffer.from(storedToken, "utf8").copy(a, 0, 0, EXPECTED_LENGTH);
    Buffer.from(stateParam, "utf8").copy(b, 0, 0, EXPECTED_LENGTH);
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Extract the CSRF token value from a raw Cookie header string.
 *
 * @param cookieHeader - Raw value of the `Cookie` HTTP header
 * @returns Token string or null if not present
 */
export function extractCsrfFromCookieHeader(
  cookieHeader: string
): string | null {
  const cookies = cookieHeader.split(";").map((c) => c.trim());
  for (const cookie of cookies) {
    const [name, ...valueParts] = cookie.split("=");
    if (name?.trim() === CSRF_COOKIE_NAME) {
      return valueParts.join("=").trim() || null;
    }
  }
  return null;
}

/**
 * Parse all cookies from a raw `Cookie` header into a key-value map.
 *
 * @param cookieHeader - Raw value of the `Cookie` HTTP header
 * @returns Object mapping cookie names to values
 */
export function parseCookies(cookieHeader: string | null): Record<string, string> {
  if (!cookieHeader) return {};
  return Object.fromEntries(
    cookieHeader.split(";").map((c) => {
      const [name, ...valueParts] = c.trim().split("=");
      return [name.trim(), valueParts.join("=").trim()];
    })
  );
}
