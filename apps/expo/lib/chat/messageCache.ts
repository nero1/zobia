import { getItem, setItem } from '@/lib/offline/store';

const PREFIX = 'chatcache_';
const CAP = 50;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface CachedPayload<T> {
  messages: T[];
  cachedAt: number;
}

export function readCachedMessages<T>(key: string): T[] | null {
  try {
    const payload = getItem<CachedPayload<T> | null>(PREFIX + key, null);
    if (!payload || !Array.isArray(payload.messages)) return null;
    if (Date.now() - (payload.cachedAt ?? 0) > CACHE_TTL_MS) return null;
    return payload.messages;
  } catch {
    return null;
  }
}

export function writeCachedMessages<T>(key: string, messages: T[]): void {
  try {
    const payload: CachedPayload<T> = {
      messages: messages.length > CAP ? messages.slice(0, CAP) : messages,
      cachedAt: Date.now(),
    };
    setItem(PREFIX + key, payload);
  } catch {
    // Non-fatal — cache is best-effort.
  }
}
