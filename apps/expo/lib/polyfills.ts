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
import { installGlobalErrorHandlers } from '@/lib/debug/logStore';

// Install the global error/console capture hooks before anything else runs so
// that even a crash during early bootstrap is recorded for the on-screen
// <DebugOverlay /> (release builds disable RN's red box — see lib/debug/logStore).
installGlobalErrorHandlers();

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

// `crypto.randomUUID()` is also absent on Hermes, yet it is called on
// user-facing interaction paths — e.g. generating idempotency keys / optimistic
// message IDs when posting in a room (app/rooms/[roomId].tsx), sending a guild
// message (app/guilds/[guildId]/chat.tsx) and enqueuing offline messages
// (lib/offline/sqlite.ts). Without this, those actions throw
// "crypto.randomUUID is not a function" the moment the user tries to send.
// expo-crypto ships a spec-compatible, synchronous randomUUID().
if (typeof g.crypto.randomUUID !== 'function') {
  g.crypto.randomUUID = () => ExpoCrypto.randomUUID();
}

// ---------------------------------------------------------------------------
// base64 (btoa / atob)
// ---------------------------------------------------------------------------
// Hermes does not guarantee `btoa`/`atob`, yet they are called on startup-
// adjacent paths:
//   - lib/auth/context.tsx → atob() to decode the JWT payload when restoring a
//     persisted session (runs while the splash is up; a throw here leaves the
//     app stuck on white before login ever renders).
//   - lib/offline/sqlite.ts → btoa()/atob() for the encrypted offline queue.
// We install a spec-compatible pure-JS implementation only if the runtime does
// not already provide one (so a future Hermes that ships them wins).
const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

if (typeof g.btoa !== 'function') {
  g.btoa = (input: string): string => {
    let output = '';
    let i = 0;
    while (i < input.length) {
      const c1 = input.charCodeAt(i++);
      const c2 = input.charCodeAt(i++);
      const c3 = input.charCodeAt(i++);
      const e1 = c1 >> 2;
      const e2 = ((c1 & 3) << 4) | (c2 >> 4);
      let e3 = ((c2 & 15) << 2) | (c3 >> 6);
      let e4 = c3 & 63;
      if (isNaN(c2)) {
        e3 = 64;
        e4 = 64;
      } else if (isNaN(c3)) {
        e4 = 64;
      }
      output +=
        BASE64_CHARS.charAt(e1) +
        BASE64_CHARS.charAt(e2) +
        (e3 === 64 ? '=' : BASE64_CHARS.charAt(e3)) +
        (e4 === 64 ? '=' : BASE64_CHARS.charAt(e4));
    }
    return output;
  };
}

if (typeof g.atob !== 'function') {
  g.atob = (input: string): string => {
    const str = String(input).replace(/[=]+$/, '');
    let output = '';
    let bc = 0;
    let bs = 0;
    for (let i = 0; i < str.length; i++) {
      const idx = BASE64_CHARS.indexOf(str.charAt(i));
      if (idx === -1) continue;
      bs = bc % 4 ? bs * 64 + idx : idx;
      if (bc++ % 4) {
        output += String.fromCharCode(255 & (bs >> ((-2 * bc) & 6)));
      }
    }
    return output;
  };
}

export {};
