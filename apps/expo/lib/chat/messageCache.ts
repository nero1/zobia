/**
 * lib/chat/messageCache.ts (Expo)
 *
 * Persisted chat cache backed by the app's encrypted MMKV store. Mirrors the
 * web localStorage cache: lets chat screens render the last messages instantly
 * on open (and offline) before the network responds. The React Query poll +
 * realtime path still runs and dedupes by id, so this is an instant-first-paint
 * optimisation, never the source of truth.
 */

import { getItem, setItem } from '@/lib/offline/store';

const PREFIX = 'chatcache_';
const CAP = 50;

/** Read cached messages for a conversation key, or null if none. */
export function readCachedMessages<T>(key: string): T[] | null {
  try {
    const arr = getItem<T[] | null>(PREFIX + key, null);
    return Array.isArray(arr) ? arr : null;
  } catch {
    return null;
  }
}

/** Persist the most recent messages for a conversation key (capped). */
export function writeCachedMessages<T>(key: string, messages: T[]): void {
  try {
    const trimmed = messages.length > CAP ? messages.slice(0, CAP) : messages;
    setItem(PREFIX + key, trimmed);
  } catch {
    // Non-fatal — cache is best-effort.
  }
}
