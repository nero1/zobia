/**
 * lib/chat/delta.ts (Expo)
 *
 * Helpers for delta message fetching: compute the newest timestamp the client
 * already has (to send as `?after=`) and merge a delta response into the
 * existing list, deduping by id and keeping newest-first order (the chat
 * FlatLists are inverted). Shared by the room, DM, and group screens.
 */

/** Newest `createdAt` (ISO) in a list, or undefined if none/empty. */
export function newestCreatedAt(list: { createdAt?: string }[]): string | undefined {
  let maxIso: string | undefined;
  let maxT = -Infinity;
  for (const m of list) {
    const c = m.createdAt;
    if (!c) continue;
    const t = Date.parse(c);
    if (!Number.isNaN(t) && t > maxT) {
      maxT = t;
      maxIso = c;
    }
  }
  return maxIso;
}

/** Merge incoming messages into prev (dedupe by id), sorted newest-first. */
export function mergeNewestFirst<T extends { id: string; createdAt: string }>(
  prev: T[],
  incoming: T[],
): T[] {
  const seen = new Set(prev.map((m) => m.id));
  const merged = prev.slice();
  for (const m of incoming) {
    if (m && m.id && !seen.has(m.id)) {
      merged.push(m);
      seen.add(m.id);
    }
  }
  merged.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  return merged;
}
