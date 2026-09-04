/**
 * apps/android/src/lib/auth/secureTokenStore.ts
 *
 * TS bridge to the native SecureTokenStorePlugin (see
 * android/app/src/main/java/com/zobiasocial/app/SecureTokenStorePlugin.java),
 * which stores the JWT access token and refresh token in an
 * EncryptedSharedPreferences file backed by an Android Keystore AES-256 key.
 *
 * Only the two token keys go through this store. Everything else Capacitor
 * Preferences already held (zobia_user, zobia_lang, ...) stays there — it's
 * not a credential, and keeping it out of the encrypted store avoids paying
 * the (small) encryption/decryption cost for data that doesn't need it.
 *
 * Web fallback: this plugin has no web implementation (Keystore is
 * Android-only), so `npm run dev` in a browser would throw "not implemented
 * on web" on every call. Falling back to plain localStorage there is fine —
 * it's local development only, never the path a shipped Android build takes
 * (Capacitor.isNativePlatform() is true in the APK).
 */

import { registerPlugin, Capacitor } from '@capacitor/core';

interface SecureTokenStorePluginApi {
  set(options: { key: string; value: string }): Promise<void>;
  get(options: { key: string }): Promise<{ value: string | null }>;
  remove(options: { key: string }): Promise<void>;
}

const NativeSecureTokenStore = registerPlugin<SecureTokenStorePluginApi>('SecureTokenStore');

const DEV_FALLBACK_PREFIX = 'zobia_secure_dev_fallback_';

export async function secureGet(key: string): Promise<string | null> {
  if (!Capacitor.isNativePlatform()) {
    return localStorage.getItem(DEV_FALLBACK_PREFIX + key);
  }
  try {
    const { value } = await NativeSecureTokenStore.get({ key });
    return value ?? null;
  } catch {
    return null;
  }
}

export async function secureSet(key: string, value: string): Promise<void> {
  if (!Capacitor.isNativePlatform()) {
    localStorage.setItem(DEV_FALLBACK_PREFIX + key, value);
    return;
  }
  await NativeSecureTokenStore.set({ key, value });
}

export async function secureRemove(key: string): Promise<void> {
  if (!Capacitor.isNativePlatform()) {
    localStorage.removeItem(DEV_FALLBACK_PREFIX + key);
    return;
  }
  await NativeSecureTokenStore.remove({ key });
}
