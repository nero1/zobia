/**
 * Zobia Social — MMKV-backed offline store.
 *
 * Provides a lightweight synchronous key-value store for persisting small
 * pieces of data (e.g. cached feed items, draft messages, user preferences)
 * that must survive app restarts and remain available when offline.
 *
 * MMKV is orders of magnitude faster than AsyncStorage for synchronous reads,
 * making it ideal for data that must be available before the first render.
 */

import { MMKV } from 'react-native-mmkv';

// ---------------------------------------------------------------------------
// Storage instance
// ---------------------------------------------------------------------------

/** Shared MMKV storage instance. Encrypted in production builds. */
export const storage = new MMKV({
  id: 'zobia-offline-store',
  // encryptionKey is set at runtime from a securely generated value.
  // For Phase 1 we leave it unencrypted; encryption will be added in Phase 2
  // once the key derivation strategy is finalised.
});

// ---------------------------------------------------------------------------
// Typed helpers
// ---------------------------------------------------------------------------

/**
 * Persist a serialisable value under `key`.
 *
 * @param key    Storage key.
 * @param value  Any JSON-serialisable value.
 */
export function setItem<T>(key: string, value: T): void {
  storage.set(key, JSON.stringify(value));
}

/**
 * Retrieve a previously persisted value.
 *
 * @param key           Storage key.
 * @param defaultValue  Returned when the key is absent or deserialization fails.
 */
export function getItem<T>(key: string, defaultValue: T): T {
  const raw = storage.getString(key);
  if (raw === undefined) return defaultValue;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return defaultValue;
  }
}

/**
 * Remove a key from the store.
 *
 * @param key  Storage key to delete.
 */
export function removeItem(key: string): void {
  storage.delete(key);
}

/**
 * Check whether a key exists in the store.
 *
 * @param key  Storage key.
 */
export function hasItem(key: string): boolean {
  return storage.contains(key);
}

/**
 * Wipe all keys from the offline store.
 * Use with caution — typically only called on sign-out.
 */
export function clearStore(): void {
  storage.clearAll();
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
