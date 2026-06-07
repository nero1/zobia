/**
 * e2e/fixtures.ts
 *
 * Shared test helpers for Playwright E2E tests.
 *
 * `signTestJwt` issues valid access tokens using the same JWT_SECRET the
 * server uses, so authenticated API calls work without a real login flow.
 * It requires `JWT_SECRET` in the test environment (e.g. .env.test.local or
 * set by CI).
 */

import { SignJWT } from "jose";

const uuidv4 = () => crypto.randomUUID();

const ISSUER   = "zobia-social";
const AUDIENCE = "zobia-web";

function encodeSecret(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

export interface TestUserClaims {
  sub: string;
  email: string;
  username: string;
  is_admin?: boolean;
  is_suspended?: boolean;
}

/**
 * Sign a short-lived test access token with the same secret the server uses.
 * The token expires in 5 minutes — enough for a single test.
 */
export async function signTestJwt(claims: TestUserClaims): Promise<string> {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error(
      "JWT_SECRET env var is required for authenticated E2E tests. " +
        "Set it in .env.test.local matching the server's JWT_SECRET."
    );
  }

  return new SignJWT({
    sub: claims.sub,
    email: claims.email,
    username: claims.username,
    is_admin: claims.is_admin ?? false,
    is_suspended: claims.is_suspended ?? false,
    sid: uuidv4(),
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setExpirationTime("5m")
    .sign(encodeSecret(secret));
}

/** Well-known test user UUIDs — these users must exist in the test DB. */
export const TEST_USER_IDS = {
  activeUser:    "10000000-0000-0000-0000-000000000001",
  suspendedUser: "10000000-0000-0000-0000-000000000002",
  referrer:      "10000000-0000-0000-0000-000000000003",
  referredTier1: "10000000-0000-0000-0000-000000000004",
  referredTier2: "10000000-0000-0000-0000-000000000005",
  referredTier3: "10000000-0000-0000-0000-000000000006",
} as const;
