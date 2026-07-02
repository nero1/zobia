/**
 * lib/google/serviceAccountAuth.ts
 *
 * Generic Google service-account OAuth2 helper — signs a JWT and exchanges
 * it for a scoped access token. Shared by every Google API integration that
 * authenticates via a service account JSON key:
 *   - lib/payments/googlePlayVerify.ts (Play Developer API — IAP verification)
 *   - lib/notifications/fcm.ts (Firebase Cloud Messaging — Android push)
 *
 * Each caller passes its own scope; tokens are cached per (client_email, scope)
 * so rotating one service account's key doesn't invalidate another's cache.
 */

import { internalError } from "@/lib/api/errors";

export interface GoogleServiceAccountJson {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

async function createServiceAccountJwt(sa: GoogleServiceAccountJson, scope: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: sa.client_email,
    scope,
    aud: sa.token_uri ?? "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };

  const encode = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString("base64url");
  const signingInput = `${encode(header)}.${encode(payload)}`;

  const privateKeyPem = sa.private_key.replace(/\\n/g, "\n");
  const keyData = privateKeyPem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");
  const binaryKey = Buffer.from(keyData, "base64");

  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    binaryKey,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", cryptoKey, Buffer.from(signingInput));
  const signatureB64 = Buffer.from(signature).toString("base64url");
  return `${signingInput}.${signatureB64}`;
}

// Cached per "client_email:scope" so different scopes for the same service
// account (or different service accounts) don't collide or overwrite one
// another's cached token.
const _tokenCache: Record<string, { token: string; expiresAt: number }> = {};

/**
 * Exchange a service account JWT for a scoped OAuth2 access token.
 * Results are cached at module scope per (client_email, scope).
 */
export async function getGoogleServiceAccountAccessToken(
  sa: GoogleServiceAccountJson,
  scope: string
): Promise<string> {
  const cacheKey = `${sa.client_email}:${scope}`;
  const now = Math.floor(Date.now() / 1000);
  const cached = _tokenCache[cacheKey];
  if (cached && cached.expiresAt > now + 60) {
    return cached.token;
  }

  const jwt = await createServiceAccountJwt(sa, scope);
  const tokenUri = sa.token_uri ?? "https://oauth2.googleapis.com/token";

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  let resp: Response;
  try {
    resp = await fetch(tokenUri, {
      signal: controller.signal,
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: jwt,
      }),
    });
  } finally {
    clearTimeout(timer);
  }

  if (!resp.ok) {
    const text = await resp.text();
    throw internalError(`Failed to get Google access token: ${text}`);
  }

  const data = (await resp.json()) as { access_token: string; expires_in?: number };
  const expiresIn = data.expires_in ?? 3600;
  _tokenCache[cacheKey] = { token: data.access_token, expiresAt: now + expiresIn - 60 };
  return data.access_token;
}
