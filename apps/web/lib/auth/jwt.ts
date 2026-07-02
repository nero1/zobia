/**
 * lib/auth/jwt.ts
 *
 * JWT creation and validation using `jose`.
 *
 * Two token types are issued:
 *   - Access token  (short-lived, 15 min) – carries user identity claims
 *   - Refresh token (long-lived, 30 days) – used only to obtain new access tokens
 *
 * Auth is ALWAYS platform-managed. No @supabase/supabase-js is used here.
 */

import {
  SignJWT,
  jwtVerify,
  decodeProtectedHeader,
  type JWTPayload,
  errors as JoseErrors,
} from "jose";
import { env } from "@/lib/env";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;            // 15 minutes
const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 3600;   // 30 days
const ADMIN_ACCESS_TOKEN_TTL_SECONDS = 30 * 60;     // 30 minutes
const ADMIN_REFRESH_TOKEN_TTL_SECONDS = 1 * 3600;   // 1 hour
const ISSUER = "zobia-social";
const AUDIENCE = "zobia-web";

// ---------------------------------------------------------------------------
// Key helpers
// ---------------------------------------------------------------------------

/** Encode a string secret as a Uint8Array for jose. */
function encodeSecret(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

const accessSecret = () => encodeSecret(env.JWT_SECRET);
const refreshSecret = () => encodeSecret(env.JWT_REFRESH_SECRET);

// ---------------------------------------------------------------------------
// Key ID (kid) support — multi-key rotation registry
// ---------------------------------------------------------------------------

/**
 * Returns the current key ID used when signing tokens.
 * Set JWT_KEY_ID env var when rotating keys so new tokens carry the new kid.
 */
export function getCurrentKeyId(): string {
  return process.env.JWT_KEY_ID ?? 'v1';
}

/**
 * Registry mapping key IDs to their encoded secrets.
 *
 * BUG-046 — JWT key rotation playbook:
 *   1. Generate a new secret: `openssl rand -base64 64`
 *   2. Set the NEW secret as JWT_SECRET (and JWT_REFRESH_SECRET for refresh tokens)
 *   3. Set JWT_KEY_ID to the new version string (e.g. "v2")
 *   4. Set JWT_SECRET_v1 = previous JWT_SECRET value (preserve old key for verification)
 *   5. Set JWT_REFRESH_SECRET_v1 = previous JWT_REFRESH_SECRET value
 *   6. Deploy — new tokens will be signed with kid=v2; existing kid=v1 tokens
 *      remain valid until they expire (max 15 min for access, 30 days for refresh)
 *   7. After all v1 refresh tokens expire (~30 days), unset JWT_SECRET_v1 /
 *      JWT_REFRESH_SECRET_v1 and update JWT_KEY_ID to remove old keys
 *
 * Add JWT_SECRET_v2, JWT_SECRET_v3, etc. during key rotation; tokens signed
 * with the old kid remain verifiable for up to the access token TTL (15 min).
 */
function buildKeyRegistry(): Map<string, Uint8Array> {
  const registry = new Map<string, Uint8Array>();
  // Current key — always present
  registry.set(getCurrentKeyId(), encodeSecret(env.JWT_SECRET));
  // Previous keys during rotation window — scan env vars matching JWT_SECRET_v*
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('JWT_SECRET_') && value && key !== 'JWT_SECRET') {
      const kid = key.replace('JWT_SECRET_', '');
      registry.set(kid, encodeSecret(value));
    }
  }
  return registry;
}

/**
 * Registry mapping key IDs to their encoded refresh secrets.
 * Add JWT_REFRESH_SECRET_v2, JWT_REFRESH_SECRET_v3, etc. during key rotation.
 */
function buildRefreshKeyRegistry(): Map<string, Uint8Array> {
  const registry = new Map<string, Uint8Array>();
  registry.set(getCurrentKeyId(), encodeSecret(env.JWT_REFRESH_SECRET));
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('JWT_REFRESH_SECRET_') && value && key !== 'JWT_REFRESH_SECRET') {
      const kid = key.replace('JWT_REFRESH_SECRET_', '');
      registry.set(kid, encodeSecret(value));
    }
  }
  return registry;
}

// Module-level caches — env vars are immutable after process start.
const keyRegistry: Map<string, Uint8Array> = buildKeyRegistry();
const refreshKeyRegistry: Map<string, Uint8Array> = buildRefreshKeyRegistry();

// BUG-007: Startup validation — warn if rotating away from v1 without preserving the old key.
// Without JWT_SECRET_v1 set, any existing sessions signed with kid=v1 will fail verification
// and every logged-in user will be immediately logged out during the rotation window.
const currentKeyId = process.env.JWT_KEY_ID ?? "v1";
if (currentKeyId !== "v1" && !process.env.JWT_SECRET_v1) {
  console.warn(
    `[jwt] WARNING: JWT_KEY_ID=${currentKeyId} but JWT_SECRET_v1 is not set. ` +
    `Existing sessions with kid=v1 will fail verification and all users will be logged out. ` +
    `Set JWT_SECRET_v1 to the previous JWT_SECRET value before rotating.`
  );
}

function getSecretForKid(kid: string | undefined): Uint8Array {
  const secret = kid ? keyRegistry.get(kid) : null;
  // Fall back to current secret for tokens without a kid claim (backward compat)
  return secret ?? encodeSecret(env.JWT_SECRET);
}

function getRefreshSecretForKid(kid: string | undefined): Uint8Array {
  const secret = kid ? refreshKeyRegistry.get(kid) : null;
  // Fall back to current refresh secret for tokens without a kid claim
  return secret ?? encodeSecret(env.JWT_REFRESH_SECRET);
}

// ---------------------------------------------------------------------------
// Payload types
// ---------------------------------------------------------------------------

/** Claims embedded in every access token. */
export interface AccessTokenPayload extends JWTPayload {
  sub: string;       // user UUID
  email?: string;    // omitted when user email is null
  username: string;
  is_admin: boolean;
  /** True when the user holds the moderator role. Only used for the cheap
   *  edge middleware pre-filter on /admin/forum/* (scoped moderator
   *  access) — authorization decisions always re-verify against the
   *  DATABASE, this claim is never trusted alone. */
  is_moderator?: boolean;
  /** Session ID (matches Redis key for invalidation). */
  sid: string;
  /** Token type — 'pre_auth' tokens are only valid for the 2FA verify endpoint. */
  type?: 'pre_auth' | 'access';
  /** False when the user has not yet completed onboarding. Absent on old tokens. */
  onboarding_completed?: boolean;
}

/** Claims embedded in every refresh token. */
export interface RefreshTokenPayload extends JWTPayload {
  sub: string;       // user UUID
  /** Session ID – must match the access token's `sid`. */
  sid: string;
}

// ---------------------------------------------------------------------------
// Token creation
// ---------------------------------------------------------------------------

/**
 * Issue a signed JWT access token for the given user.
 *
 * @param payload - User identity claims (sub, email, username, is_admin, sid)
 * @returns Signed JWT string
 */
export async function signAccessToken(
  payload: Omit<AccessTokenPayload, "iss" | "aud" | "iat" | "exp">,
  ttlSeconds = ACCESS_TOKEN_TTL_SECONDS
): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256", kid: getCurrentKeyId() })
    .setIssuedAt()
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(accessSecret());
}

/**
 * Issue a signed JWT refresh token for the given user / session.
 *
 * @param sub - User UUID
 * @param sid - Session ID
 * @param ttlSeconds - Override the token lifetime (defaults to 30 days)
 * @returns Signed JWT string
 */
export async function signRefreshToken(sub: string, sid: string, ttlSeconds = REFRESH_TOKEN_TTL_SECONDS): Promise<string> {
  return new SignJWT({ sub, sid })
    .setProtectedHeader({ alg: "HS256", kid: getCurrentKeyId() })
    .setIssuedAt()
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(refreshSecret());
}

// ---------------------------------------------------------------------------
// Token verification
// ---------------------------------------------------------------------------

/** Structured error returned when token verification fails. */
export class JwtVerificationError extends Error {
  constructor(
    message: string,
    public readonly code: "EXPIRED" | "INVALID" | "MISSING"
  ) {
    super(message);
    this.name = "JwtVerificationError";
  }
}

/**
 * Verify and decode a JWT access token.
 *
 * @param token - Raw JWT string
 * @returns Decoded payload
 * @throws {JwtVerificationError} if the token is missing, expired, or invalid
 */
export async function verifyAccessToken(token: string): Promise<AccessTokenPayload> {
  if (!token) throw new JwtVerificationError("No token provided", "MISSING");

  try {
    // Decode the JWT header to extract the kid claim, then select the
    // corresponding secret from the key registry for rotation support.
    const header = decodeProtectedHeader(token);
    const secret = getSecretForKid(header.kid as string | undefined);
    const { payload } = await jwtVerify(token, secret, {
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    return payload as AccessTokenPayload;
  } catch (err) {
    if (err instanceof JoseErrors.JWTExpired) {
      throw new JwtVerificationError("Access token expired", "EXPIRED");
    }
    throw new JwtVerificationError(
      `Invalid access token: ${(err as Error).message}`,
      "INVALID"
    );
  }
}

/**
 * Verify and decode a JWT refresh token.
 *
 * @param token - Raw JWT string
 * @returns Decoded payload
 * @throws {JwtVerificationError} if the token is missing, expired, or invalid
 */
export async function verifyRefreshToken(token: string): Promise<RefreshTokenPayload> {
  if (!token) throw new JwtVerificationError("No token provided", "MISSING");

  try {
    // Extract kid from header to select the correct refresh secret for key rotation,
    // mirroring the approach used in verifyAccessToken.
    const header = decodeProtectedHeader(token);
    const secret = getRefreshSecretForKid(header.kid as string | undefined);
    const { payload } = await jwtVerify(token, secret, {
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    return payload as RefreshTokenPayload;
  } catch (err) {
    if (err instanceof JoseErrors.JWTExpired) {
      throw new JwtVerificationError("Refresh token expired", "EXPIRED");
    }
    throw new JwtVerificationError(
      `Invalid refresh token: ${(err as Error).message}`,
      "INVALID"
    );
  }
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/**
 * Extract the raw bearer token string from an Authorization header.
 *
 * @param authHeader - Value of the Authorization header
 * @returns Raw token or null
 */
export function extractBearerToken(authHeader: string | null): string | null {
  if (!authHeader?.startsWith("Bearer ")) return null;
  return authHeader.slice(7).trim() || null;
}

export { ACCESS_TOKEN_TTL_SECONDS, REFRESH_TOKEN_TTL_SECONDS, ADMIN_ACCESS_TOKEN_TTL_SECONDS, ADMIN_REFRESH_TOKEN_TTL_SECONDS };
