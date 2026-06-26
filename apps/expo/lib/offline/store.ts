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

let _encKeyPromise: Promise<string> | null = null;

/**
 * Load (or generate and persist) the MMKV encryption key.
 * Returns a hex-encoded 256-bit key string.
 *
 * BUG-RACE-01 FIX: uses a module-level promise guard so concurrent callers
 * (e.g. multiple useEffect fires before the first resolves) share one operation
 * instead of each generating and overwriting the SecureStore entry.
 */
async function loadOrCreateEncryptionKey(): Promise<string> {
  if (_encKeyPromise) return _encKeyPromise;

  _encKeyPromise = (async () => {
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
  })();

  // Clear on failure so the next call can retry
  _encKeyPromise = _encKeyPromise.catch((err) => {
    _encKeyPromise = null;
    throw err;
  });

  return _encKeyPromise;
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
    const store = _storage;
    if (!store) {
      throw new Error(
        `[store] Accessed storage.${String(prop)} before initStore() resolved. ` +
        'Await initStore() in your App root before rendering any screen that reads MMKV.'
      );
    }
    return store[prop as keyof MMKV];
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
  // Referral code captured from an inbound ?r= deep/universal link, replayed at
  // onboarding for attribution (see lib/deeplinks/referral.ts).
  PENDING_REFERRAL: 'pending_referral',
  // Temporary DOB draft written during onboarding step 1; read and cleared in
  // welcome-drop so PII never travels through URL params (M-6 fix).
  ONBOARDING_DRAFT: 'onboarding_draft',
  // TOTP rate-limiting across app restarts (M-2 fix).
  TOTP_ATTEMPTS: 'totp_failed_attempts',
  TOTP_LOCKED_UNTIL: 'totp_locked_until',
  // Gift-send PIN rate-limiting across app restarts (M-4 fix).
  GIFT_PIN_ATTEMPTS: 'gift_pin_failed_attempts',
  GIFT_PIN_LOCKED_UNTIL: 'gift_pin_locked_until',
  // Creator payout PIN rate-limiting across app restarts (M-5 fix).
  PAYOUT_PIN_ATTEMPTS: 'payout_pin_failed_attempts',
  PAYOUT_PIN_LOCKED_UNTIL: 'payout_pin_locked_until',
  // Chat message cache conversation index for global eviction (M-7 fix).
  CHAT_CACHE_INDEX: 'chat_cache_index',
  // Language preference — kept as a stable STORE_KEYS entry so sign-out can
  // clear it via clearStore() without leaving stale locale data (L-2 fix).
  LANGUAGE_PREF: 'language_pref',
  // Active subscription purchase tokens keyed by product ID for Play Billing
  // v5+ upgrade/downgrade flow (H-2 fix).
  ACTIVE_SUB_TOKENS: 'active_sub_tokens',
  // Counts successive PIN lockout windows for exponential backoff (M-9 fix).
  PIN_LOCKOUT_COUNT: 'pin_lockout_count',
  // Store purchase PIN rate-limiting across app restarts (BUG-012 fix).
  STORE_PIN_FAILED_ATTEMPTS: 'store_pin_failed_attempts',
  STORE_PIN_LOCKED_UNTIL: 'store_pin_locked_until',
  // Last date the daily-login bonus was claimed; compared to local date string.
  DAILY_LOGIN_LAST_DATE: 'daily_login_last_date',
  // Settings screen PIN rate-limiting across app restarts.
  SETTINGS_PIN_ATTEMPTS: 'settings_pin_failed_attempts',
  SETTINGS_PIN_LOCKED_UNTIL: 'settings_pin_locked_until',
  SETTINGS_PIN_LOCKOUT_COUNT: 'settings_pin_lockout_count',
  // Successive lockout counts for exponential backoff on TOTP and gift PIN.
  TOTP_LOCKOUT_COUNT: 'totp_lockout_count',
  GIFT_PIN_LOCKOUT_COUNT: 'gift_pin_lockout_count',
} as const;

export type StoreKey = (typeof STORE_KEYS)[keyof typeof STORE_KEYS];
