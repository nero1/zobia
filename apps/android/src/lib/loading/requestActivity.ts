/**
 * apps/android/src/lib/loading/requestActivity.ts
 *
 * Tracks "is anything currently loading" globally via the shared axios
 * `apiClient` instance's interceptors, so <GlobalLoadingIndicator/> (mounted
 * once in routes/__root.tsx) can show instant tap feedback without every
 * screen having to opt in. Mirrors apps/web/lib/loading/requestActivity.ts's
 * fetch-wrapping approach — axios interceptors are the equivalent hook point
 * here since the Android app calls the API through `apiClient`, not
 * `window.fetch` directly (see lib/api/client.ts).
 */

type Listener = (count: number) => void;

let activeRequestCount = 0;
const listeners = new Set<Listener>();

function notify(): void {
  for (const listener of listeners) listener(activeRequestCount);
}

/** Subscribe to in-flight request count changes. Returns an unsubscribe function. */
export function subscribeToRequestActivity(listener: Listener): () => void {
  listeners.add(listener);
  listener(activeRequestCount);
  return () => listeners.delete(listener);
}

/** Called by apiClient's interceptors — see lib/api/client.ts. */
export function reportRequestStart(): void {
  activeRequestCount += 1;
  notify();
}

/** Called by apiClient's interceptors — see lib/api/client.ts. */
export function reportRequestEnd(): void {
  activeRequestCount = Math.max(0, activeRequestCount - 1);
  notify();
}
