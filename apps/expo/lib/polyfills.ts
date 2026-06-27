/**
 * Runtime polyfills — imported once, as the very first thing the app evaluates
 * (see the top of app/_layout.tsx).
 *
 * WHY THIS EXISTS (root cause of the post-splash white screen)
 * -----------------------------------------------------------------------------
 * Expo SDK 51 runs on Hermes, which does NOT expose a global Web Crypto object.
 * Several startup-critical modules assume one exists:
 *   - lib/offline/store.ts   → crypto.getRandomValues() to derive the MMKV
 *                              encryption key (this init gates the first render
 *                              via `storeReady`).
 *   - lib/offline/sqlite.ts  → crypto.getRandomValues() for the offline queue.
 *
 * Without a polyfill, `crypto` is `undefined` at runtime, so these init paths
 * throw ("Property 'crypto' doesn't exist"). The encrypted store is never
 * created and the bootstrap chain breaks — leaving the app stuck on a blank
 * white screen after the splash disappears.
 *
 * `expo-crypto` (already a dependency) provides a spec-compatible
 * `getRandomValues`, so we install it on the global `crypto` object here. We do
 * NOT clobber an existing implementation — if a future runtime ships Web Crypto
 * natively, we defer to it.
 */

import * as ExpoCrypto from 'expo-crypto';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const g = globalThis as any;

if (typeof g.crypto !== 'object' || g.crypto === null) {
  g.crypto = {};
}

if (typeof g.crypto.getRandomValues !== 'function') {
  g.crypto.getRandomValues = (array: unknown) => {
    if (array == null) return array;
    // expo-crypto exposes a synchronous, spec-compatible getRandomValues that
    // fills and returns the supplied typed array in place.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return ExpoCrypto.getRandomValues(array as any);
  };
}

export {};
