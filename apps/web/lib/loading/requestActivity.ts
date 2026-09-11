/**
 * lib/loading/requestActivity.ts
 *
 * Tracks "is anything currently loading" globally by wrapping `window.fetch`
 * exactly once, so <GlobalLoadingIndicator/> (mounted once in app/layout.tsx)
 * can show instant tap/click feedback without every page having to opt in.
 *
 * Why this approach: users reported that on a slow connection, tapping
 * something gave no feedback for a few seconds — they couldn't tell if the
 * tap registered, the app had stalled, or their session had expired. Nearly
 * every data operation in this app (route transitions via Next.js's RSC
 * fetch, and essentially all API calls) goes through `fetch()`, so
 * instrumenting fetch centrally covers the overwhelming majority of "user
 * did something, now waiting on the network" cases with zero per-page
 * changes, rather than requiring every page to thread a loading prop through.
 *
 * Deliberately NOT built as a Next.js router-events listener: the App
 * Router has no public top-level navigation-start/end event, and this
 * fetch-count approach also naturally covers plain API calls (button
 * click -> fetch -> spinner), not just page navigations.
 */

type Listener = (count: number) => void;

let activeRequestCount = 0;
const listeners = new Set<Listener>();
let installed = false;

function notify(): void {
  for (const listener of listeners) listener(activeRequestCount);
}

/** Subscribe to in-flight request count changes. Returns an unsubscribe function. */
export function subscribeToRequestActivity(listener: Listener): () => void {
  listeners.add(listener);
  listener(activeRequestCount);
  return () => listeners.delete(listener);
}

/**
 * Patch `window.fetch` to track in-flight request count. Idempotent — safe
 * to call from every mount of <GlobalLoadingIndicator/> (e.g. across client
 * navigations); only wraps fetch once per page load.
 */
export function installFetchActivityTracking(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;

  const originalFetch = window.fetch.bind(window);

  window.fetch = (async (...args: Parameters<typeof fetch>) => {
    activeRequestCount += 1;
    notify();
    try {
      return await originalFetch(...args);
    } finally {
      activeRequestCount = Math.max(0, activeRequestCount - 1);
      notify();
    }
  }) as typeof fetch;
}
