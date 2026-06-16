/**
 * Zobia Social — MMKV-backed offline store.
 *
 * Provides a lightweight synchronous key-value store for persisting small
 * pieces of data (e.g. cached feed items, draft messages, user preferences)
 * that must survive app restarts and remain available when offline.
 *
 * MMKV is orders of magnitude faster than AsyncStorage for synchronous reads,
 * making it ideal for data that must be available before the first render.
 *
 * Encryption: a 256-bit AES key is generated on first launch, stored in the
 * device's secure enclave via expo-secure-store, and loaded on every subsequent
 * launch so the MMKV store is always encrypted at rest (BUG-SEC-03).
 */

import { MMKV } from 'react-native-mmkv';
import * as SecureStore from 'expo-secure-store';

// ---------------------------------------------------------------------------
// Encryption key bootstrap
// ---------------------------------------------------------------------------

const ENCRYPTION_KEY_NAME = 'zobia_mmkv_key';

/**
 * Load (or generate and persist) the MMKV encryption key.
 * Returns a hex-encoded 256-bit key string.
 */
async function loadOrCreateEncryptionKey(): Promise<string> {
  const existing = await SecureStore.getItemAsync(ENCRYPTION_KEY_NAME);
  if (existing) return existing;

  // Generate a cryptographically random 256-bit key
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  await SecureStore.setItemAsync(ENCRYPTION_KEY_NAME, hex, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  return hex;
}

// ---------------------------------------------------------------------------
// Storage instance
// ---------------------------------------------------------------------------

/**
 * Lazily initialised, encrypted MMKV instance.
 * Call initStore() once on app start before accessing `storage`.
 */
let _storage: MMKV | null = null;

/** Shared MMKV storage instance — call initStore() before first use. */
export function getStorage(): MMKV {
  if (!_storage) {
    throw new Error('[store] initStore() has not been called yet. Call it in your App root.');
  }
  return _storage;
}

/**
 * Initialise the encrypted MMKV store.
 * Must be awaited once at app startup (e.g. in App.tsx before rendering).
 */
export async function initStore(): Promise<void> {
  if (_storage) return;
  const encryptionKey = await loadOrCreateEncryptionKey();
  _storage = new MMKV({
    id: 'zobia-offline-store',
    encryptionKey,
  });
}

// Convenience proxy that throws if initStore was not called
export const storage = new Proxy({} as MMKV, {
  get(_target, prop) {
    return getStorage()[prop as keyof MMKV];
  },
});

// ---------------------------------------------------------------------------
// Typed helpers
// ---------------------------------------------------------------------------

/**
 * Persist a serialisable value under `key`.
 */
export function setItem<T>(key: string, value: T): void {
  getStorage().set(key, JSON.stringify(value));
}

/**
 * Retrieve a previously persisted value.
 */
export function getItem<T>(key: string, defaultValue: T): T {
  const raw = getStorage().getString(key);
  if (raw === undefined) return defaultValue;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return defaultValue;
  }
}

/**
 * Remove a key from the store.
 */
export function removeItem(key: string): void {
  getStorage().delete(key);
}

/**
 * Check whether a key exists in the store.
 */
export function hasItem(key: string): boolean {
  return getStorage().contains(key);
}

/**
 * Wipe all keys from the offline store.
 * Use with caution — typically only called on sign-out.
 */
export function clearStore(): void {
  getStorage().clearAll();
}

// ---------------------------------------------------------------------------
// Well-known keys
// ---------------------------------------------------------------------------

/** Centralised key registry to avoid typos across the codebase. */
export const STORE_KEYS = {
  ONBOARDING_COMPLETE: 'onboarding_complete',
  CACHED_FEED: 'cached_feed',
  DRAFT_MESSAGE_PREFIX: 'draft_msg_',
  USER_PREFERENCES: 'user_prefs',
  LAST_SYNC_TIMESTAMP: 'last_sync_ts',
} as const;

export type StoreKey = (typeof STORE_KEYS)[keyof typeof STORE_KEYS];
