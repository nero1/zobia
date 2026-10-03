"use client";

/**
 * lib/auth/refreshSession.ts
 *
 * The one place the browser asks the server to renew the access token.
 *
 * Why this exists: the refresh token is rotated on every refresh, and all
 * tabs share one cookie jar. When many tabs hit the 15-minute access-token
 * expiry together, each tab used to fire its own POST /api/auth/refresh. The
 * server lets one through and rejects the overlapping ones, and the losing
 * tabs treated that rejection as "the session is dead": they called
 * markSessionExpired(), which POSTs /api/auth/logout and wipes the cookies
 * every tab shares, signing the user out even though the session was fine.
 *
 * This helper fixes that in three ways:
 *   1. Refreshes are serialised across tabs with the Web Locks API (falling
 *      back to per-tab single-flight where it is unavailable).
 *   2. Inside the lock it first probes GET /api/auth/me: if another tab
 *      already refreshed, the cookie is fresh and no refresh is needed.
 *   3. Only a definitive rejection (401/400) counts as a dead session.
 *      Transient failures (409 in-progress, 429, 5xx, network) are retried
 *      and never reported as expiry.
 */

import { rawFetch } from "@/lib/auth/sessionExpiredBus";
import { setSessionExpiresAt } from "@/lib/auth/sessionExpiryBus";

const LOCK_NAME = "zobia:auth-refresh";
const MAX_ATTEMPTS = 4;

let inFlight: Promise<boolean> | null = null;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** True when the current access-token cookie is accepted by the server. */
async function accessTokenIsValid(): Promise<boolean> {
  try {
    const res = await rawFetch("/api/auth/me", { credentials: "include", cache: "no-store" });
    if (!res.ok) return false;
    const body = (await res.json().catch(() => null)) as { expiresAt?: number | null } | null;
    if (typeof body?.expiresAt === "number") setSessionExpiresAt(body.expiresAt);
    return true;
  } catch {
    return false;
  }
}

async function doRefresh(): Promise<boolean> {
  // Another tab may have refreshed while this one waited for the lock.
  if (await accessTokenIsValid()) return true;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await rawFetch("/api/auth/refresh", { method: "POST", credentials: "include" });
      if (res.ok) {
        const body = (await res.json().catch(() => null)) as { expiresIn?: number } | null;
        if (typeof body?.expiresIn === "number") {
          setSessionExpiresAt(Date.now() + body.expiresIn * 1000);
        }
        return true;
      }
      // Definitive: the refresh token / session is genuinely gone.
      if (res.status === 401 || res.status === 400) return false;
    } catch {
      // Network error: treat as transient and retry below.
    }
    if (attempt < MAX_ATTEMPTS) await sleep(300 * attempt + Math.random() * 200);
  }

  // Retries exhausted on transient errors. A sibling tab may have succeeded.
  return accessTokenIsValid();
}

/**
 * Renew the access token. Resolves true if the session is usable afterwards,
 * false only when the server definitively says the session is gone.
 */
export function refreshSession(): Promise<boolean> {
  if (inFlight) return inFlight;

  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  const run = locks
    ? locks.request(LOCK_NAME, () => doRefresh())
    : doRefresh();

  inFlight = Promise.resolve(run)
    .catch(() => false)
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}
