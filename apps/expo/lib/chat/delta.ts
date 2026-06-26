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
  existing: T[],
  incoming: T[],
): T[] {
  if (!incoming.length) return existing;
  if (!existing.length) {
    return [...incoming].sort((a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }
  // existing is already sorted newest-first (descending); binary-insert each
  // incoming message to avoid a full re-sort on every delta fetch.
  const result = [...existing];
  for (const msg of incoming) {
    if (!msg || !msg.id) continue;
    const msgTime = new Date(msg.createdAt).getTime();
    // Binary search for insertion point (descending order: larger time = earlier index)
    let lo = 0;
    let hi = result.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (new Date(result[mid]!.createdAt).getTime() > msgTime) lo = mid + 1;
      else hi = mid;
    }
    // Check for duplicate id at and around insertion point
    if (lo < result.length && result[lo]!.id === msg.id) continue;
    if (lo > 0 && result[lo - 1]!.id === msg.id) continue;
    result.splice(lo, 0, msg);
  }
  return result;
}
