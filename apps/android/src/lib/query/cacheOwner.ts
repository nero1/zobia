/**
 * apps/android/src/lib/query/cacheOwner.ts
 *
 * Per-user scoping for the IndexedDB query cache.
 *
 * ---------------------------------------------------------------------------
 * Why this exists
 * ---------------------------------------------------------------------------
 * The offline persister in ./client.ts writes every successful query to
 * IndexedDB so the app opens instantly and works offline. IndexedDB is scoped
 * to the APP, not to the signed-in account — so without this module, signing
 * out and signing in as somebody else on the same device would restore the
 * previous account's cached feed, profile, guild and message data into the new
 * session.
 *
 * Every persisted entry is therefore namespaced with the owning user's id, and
 * switching owner purges every entry belonging to anyone else. This mirrors
 * the web/PWA implementation in apps/web/lib/offline/queryPersist.ts and the
 * `zobia:<feature>:<userId>` convention already used for per-user Capacitor
 * Preferences keys (see components/ads/RewardedAdButton.tsx).
 *
 * It also mirrors the REDIS-COST-01 motivation: cached reads are requests the
 * client never makes, and requests never made cost no lambda, no database and
 * no Redis command.
 */

import { keys as idbKeys, del as idbDel } from 'idb-keyval';

/** Prefix shared by every persisted, user-scoped query entry. */
export const CACHE_PREFIX = 'zobia:rqcache:';
/** Bucket used before sign-in / after sign-out. */
const ANONYMOUS_OWNER = 'anon';

/**
 * The user whose cache is currently being read and written. Module-level
 * rather than React state because the persister's storage adapter is
 * constructed once, outside the component tree, and must see the current value
 * at call time.
 */
let currentOwner: string | null = null;

/** Namespace a persister key for the current owner. */
export function scopedCacheKey(key: string): string {
  return `${CACHE_PREFIX}${currentOwner ?? ANONYMOUS_OWNER}:${key}`;
}

/** Prefix that all of `owner`'s entries share. */
function ownerPrefix(owner: string | null): string {
  return `${CACHE_PREFIX}${owner ?? ANONYMOUS_OWNER}:`;
}

/**
 * Delete every persisted entry that does not belong to `keepOwner`.
 *
 * Also removes entries written before this scoping existed (anything under the
 * old un-prefixed scheme), since those may contain another account's data.
 * Best-effort: a failure here must never block sign-in.
 */
async function purgeOtherOwners(keepOwner: string | null): Promise<void> {
  try {
    const keep = ownerPrefix(keepOwner);
    const all = await idbKeys();
    await Promise.all(
      all
        .filter((k): k is string => typeof k === 'string')
        .filter((k) => !k.startsWith(keep))
        .map((k) => idbDel(k).catch(() => {})),
    );
  } catch {
    /* IndexedDB unavailable — nothing to purge */
  }
}

/**
 * Declare which user the persisted cache belongs to.
 *
 * Call on sign-in with the user's id and on sign-out with `null`. A change of
 * owner purges the other account's persisted entries; the caller is
 * responsible for clearing the in-memory QueryClient (see lib/auth/store.ts,
 * which does both together).
 *
 * Safe to call repeatedly with the same value — it no-ops.
 *
 * @param ownerId - Signed-in user id, or null when signed out
 */
export async function setQueryCacheOwner(ownerId: string | null): Promise<void> {
  if (currentOwner === ownerId) return;
  currentOwner = ownerId;
  await purgeOtherOwners(ownerId);
}
