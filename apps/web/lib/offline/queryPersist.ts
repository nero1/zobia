"use client";

/**
 * lib/offline/queryPersist.ts
 *
 * localStorage persistence for the TanStack Query cache, so the app is
 * genuinely offline-first: on launch (including an offline PWA launch, and an
 * offline cold start of the Capacitor Android app) the last successfully
 * fetched data is rehydrated and rendered immediately, then React Query
 * revalidates as soon as the network returns.
 *
 * ---------------------------------------------------------------------------
 * REDIS-COST-01 — why this matters to the Redis bill
 * ---------------------------------------------------------------------------
 * Every request the client does NOT make is a request that costs no lambda, no
 * database query and no Redis command. Rehydrating from disk turns a cold app
 * launch from "N API calls before first paint" into "paint immediately, then
 * revalidate what is actually stale". It is the cheapest lever available and it
 * improves perceived performance at the same time.
 *
 * ---------------------------------------------------------------------------
 * Per-user scoping (security)
 * ---------------------------------------------------------------------------
 * The cache is keyed per user id, following the same `zobia:<feature>:<userId>`
 * convention as lib/hooks/useNewMemberQuestDismissal.ts. This matters on shared
 * devices — a phone passed between family members, a shared desktop, an
 * internet cafe. Previously a single global key was used with a denylist of
 * "sensitive" query-key fragments; that is the wrong shape of defence, because
 * it fails open: any query whose key does not happen to contain one of the
 * listed words (a DM thread, a private profile, a guild's internal roster)
 * would be written to disk and then rehydrated for whoever signed in next.
 *
 * Scoping by user id fails closed instead: user B simply never reads user A's
 * snapshot, regardless of what is in it. `setQueryCacheOwner` additionally
 * purges every other user's snapshot on sign-in and on sign-out, so a device
 * does not accumulate readable caches for accounts that have left it.
 *
 * Implemented with the core `dehydrate`/`hydrate` helpers — no extra
 * persist-client dependency. It deliberately:
 *   - persists only SUCCESSFUL queries (never errors or in-flight state);
 *   - never persists credential-shaped or balance-shaped caches even for the
 *     owning user, since those must always be re-fetched rather than shown
 *     from disk;
 *   - stamps the snapshot and ignores it once older than MAX_AGE_MS;
 *   - fails silently (private-mode / quota / disabled storage must never break
 *     the app).
 */

import type { QueryClient } from "@tanstack/react-query";
import { dehydrate, hydrate } from "@tanstack/react-query";

/** Prefix shared by every per-user cache snapshot. */
const STORAGE_PREFIX = "zobia:rqcache:";
/** Anonymous (signed-out) callers get their own bucket, never a user's. */
const ANONYMOUS_OWNER = "anon";
const MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24h — beyond this, treat as too stale
const WRITE_DEBOUNCE_MS = 1_000;

/**
 * Query-key fragments never written to disk, even inside the owning user's own
 * snapshot. These are values that must reflect live server state the moment
 * they are shown — a stale wallet balance or session list is misleading in a
 * way a stale feed is not.
 */
const NEVER_PERSIST_FRAGMENTS = ["wallet", "session", "balance", "coins", "stars", "payout"];

/**
 * The user whose cache this tab is currently reading and writing.
 * `null` means signed out; snapshots then go to the anonymous bucket.
 */
let currentOwner: string | null = null;

function isNeverPersisted(key: readonly unknown[]): boolean {
  return key.some(
    (part) =>
      typeof part === "string" &&
      NEVER_PERSIST_FRAGMENTS.some((frag) => part.toLowerCase().includes(frag)),
  );
}

/** Storage key for a given owner. */
function storageKey(owner: string | null): string {
  return `${STORAGE_PREFIX}${owner ?? ANONYMOUS_OWNER}`;
}

/**
 * Remove every persisted snapshot that does not belong to `keepOwner`.
 *
 * Called on every owner change, so signing in evicts the previous account's
 * data from the device and signing out evicts the account that just left.
 */
function purgeOtherOwners(keepOwner: string | null): void {
  try {
    const keep = storageKey(keepOwner);
    // Collect first: removing while iterating localStorage's index-based API
    // shifts subsequent indices and would skip entries.
    const doomed: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key && key.startsWith(STORAGE_PREFIX) && key !== keep) doomed.push(key);
    }
    for (const key of doomed) window.localStorage.removeItem(key);

    // Legacy global snapshot from before per-user scoping — always remove it,
    // since it may contain a previous user's data.
    window.localStorage.removeItem("zobia_rq_cache_v1");
  } catch {
    /* storage unavailable — nothing to purge */
  }
}

/**
 * Declare which user the persisted cache belongs to.
 *
 * Call this as soon as the signed-in user is known, and again with `null` on
 * sign-out. Changing owner clears the in-memory query cache (so nothing from
 * the previous account is rendered), purges other owners' snapshots from disk,
 * and rehydrates the new owner's snapshot if one exists.
 *
 * Safe to call repeatedly with the same value — it no-ops.
 *
 * @param client  - The QueryClient whose cache is being persisted
 * @param ownerId - Signed-in user id, or null when signed out
 */
export function setQueryCacheOwner(client: QueryClient, ownerId: string | null): void {
  if (typeof window === "undefined") return;
  if (currentOwner === ownerId) return;

  const previousOwner = currentOwner;
  currentOwner = ownerId;

  // Drop in-memory data only when LEAVING a known owner — an account switch or
  // a sign-out. On the first adoption of a page load (`previousOwner === null`)
  // there is nothing user-specific in memory yet: the anonymous bucket holds
  // only data fetched while signed out, which belongs to nobody. Clearing there
  // would throw away queries this page load has already completed and force a
  // second round of requests, which is the opposite of the point.
  if (previousOwner !== null) {
    client.clear();
  }

  purgeOtherOwners(ownerId);
  hydrateQueryClient(client);
}

/** Restore a previously-persisted cache snapshot into the client (best-effort). */
export function hydrateQueryClient(client: QueryClient): void {
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(storageKey(currentOwner));
    if (!raw) return;
    const parsed = JSON.parse(raw) as { ts: number; state: unknown };
    if (!parsed?.ts || Date.now() - parsed.ts > MAX_AGE_MS) {
      window.localStorage.removeItem(storageKey(currentOwner));
      return;
    }
    hydrate(client, parsed.state);
  } catch {
    /* corrupt / unavailable storage — ignore */
  }
}

/**
 * Persist the cache on every change (debounced). Returns an unsubscribe fn.
 */
export function persistQueryClient(client: QueryClient): () => void {
  if (typeof window === "undefined") return () => {};

  let timer: ReturnType<typeof setTimeout> | undefined;

  const write = () => {
    try {
      const state = dehydrate(client, {
        shouldDehydrateQuery: (query) =>
          query.state.status === "success" && !isNeverPersisted(query.queryKey),
      });
      window.localStorage.setItem(
        storageKey(currentOwner),
        JSON.stringify({ ts: Date.now(), state }),
      );
    } catch {
      /* quota / serialization error — drop this snapshot */
    }
  };

  const unsubscribe = client.getQueryCache().subscribe(() => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(write, WRITE_DEBOUNCE_MS);
  });

  return () => {
    if (timer) clearTimeout(timer);
    unsubscribe();
  };
}
