/**
 * lib/chat/messageCache.ts
 *
 * Tiny persisted chat cache (web + PWA) backed by localStorage. Lets chat
 * surfaces render the last messages instantly on open — before the network
 * round-trip — and keeps a usable view available offline in the PWA. The live
 * poll/realtime path still runs and dedupes by id, so the cache is purely an
 * instant-first-paint optimisation, never the source of truth.
 *
 * Keep it small: only the most recent CAP messages per conversation are stored.
 */

const PREFIX = "chatcache:v2:";
const CAP = 50;

/** Read cached messages for a conversation key, or null if none/unavailable. */
export function readCachedMessages<T>(key: string, userId?: string | null): T[] | null {
  if (typeof window === "undefined" || !userId) return null;
  try {
    const raw = window.localStorage.getItem(`${PREFIX}${userId}:${key}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : null;
  } catch {
    return null;
  }
}

/** Persist the most recent messages for a conversation key (capped). */
export function writeCachedMessages<T>(key: string, messages: T[], userId?: string | null): void {
  if (typeof window === "undefined" || !userId) return;
  try {
    const trimmed = messages.length > CAP ? messages.slice(messages.length - CAP) : messages;
    window.localStorage.setItem(`${PREFIX}${userId}:${key}`, JSON.stringify(trimmed));
  } catch {
    // Quota exceeded / disabled storage — non-fatal (cache is best-effort).
  }
}

/** Remove cached private content on logout/expiry, including legacy unscoped keys. */
export function clearCachedMessages(): void {
  if (typeof window === "undefined") return;
  try {
    for (const key of Object.keys(window.sessionStorage)) {
      if (key.startsWith("zobia:home:feed:")) window.sessionStorage.removeItem(key);
    }
  } catch { /* Session storage unavailable. */ }
  try {
    for (const key of Object.keys(window.localStorage)) {
      if (key.startsWith("chatcache:")) window.localStorage.removeItem(key);
    }
  } catch { /* Storage unavailable. */ }
}
