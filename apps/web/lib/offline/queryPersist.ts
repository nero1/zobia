"use client";

/**
 * lib/offline/queryPersist.ts
 *
 * Minimal localStorage persistence for the TanStack Query cache, so the app is
 * genuinely offline-first: on launch (including an offline PWA launch) the last
 * successfully-fetched data is rehydrated and rendered immediately, then React
 * Query revalidates it as soon as the network returns.
 *
 * Implemented with the core `dehydrate`/`hydrate` helpers — no extra
 * persist-client dependency. It deliberately:
 *   - persists only SUCCESSFUL queries (never errors or in-flight state);
 *   - skips auth-sensitive caches (anything keyed under "me"/"wallet"/"session")
 *     so stale identity/balance data is never shown from disk;
 *   - stamps the snapshot and ignores it once older than MAX_AGE_MS;
 *   - fails silently (private-mode / quota / disabled storage must never break
 *     the app).
 */

import type { QueryClient } from "@tanstack/react-query";
import { dehydrate, hydrate } from "@tanstack/react-query";

const STORAGE_KEY = "zobia_rq_cache_v1";
const MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24h — beyond this, treat as too stale
const WRITE_DEBOUNCE_MS = 1_000;

/** Query-key fragments whose cached data must never be restored from disk. */
const SENSITIVE_FRAGMENTS = ["me", "wallet", "session", "balance", "coins"];

function isSensitiveKey(key: readonly unknown[]): boolean {
  return key.some(
    (part) =>
      typeof part === "string" &&
      SENSITIVE_FRAGMENTS.some((frag) => part.toLowerCase().includes(frag)),
  );
}

/** Restore a previously-persisted cache snapshot into the client (best-effort). */
export function hydrateQueryClient(client: QueryClient): void {
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as { ts: number; state: unknown };
    if (!parsed?.ts || Date.now() - parsed.ts > MAX_AGE_MS) {
      window.localStorage.removeItem(STORAGE_KEY);
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
          query.state.status === "success" && !isSensitiveKey(query.queryKey),
      });
      window.localStorage.setItem(
        STORAGE_KEY,
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
