import { getItem, setItem, removeItem, STORE_KEYS } from '@/lib/offline/store';

const PREFIX = 'chatcache_';
const CAP = 50;
const CACHE_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours
// M-7 FIX: cap the total number of cached conversations to bound MMKV growth.
const MAX_CONVERSATIONS = 50;

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
    // M-7 FIX: maintain a conversation index for global eviction so storage
    // doesn't grow unbounded when a user has many conversations.
    const index = getItem<string[]>(STORE_KEYS.CHAT_CACHE_INDEX, []);
    if (!index.includes(key)) {
      index.push(key);
      // Evict the oldest conversation when we exceed the cap.
      while (index.length > MAX_CONVERSATIONS) {
        const oldest = index.shift();
        if (oldest) removeItem(PREFIX + oldest);
      }
      setItem(STORE_KEYS.CHAT_CACHE_INDEX, index);
    }
    const payload: CachedPayload<T> = {
      messages: messages.length > CAP ? messages.slice(0, CAP) : messages,
      cachedAt: Date.now(),
    };
    setItem(PREFIX + key, payload);
  } catch (err) {
    // Non-fatal — cache is best-effort, but log so storage corruption is visible.
    console.error('[messageCache] write failed:', err);
  }
}
