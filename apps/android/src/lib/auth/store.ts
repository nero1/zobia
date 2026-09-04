/**
 * apps/android/src/lib/auth/store.ts
 *
 * In-memory reactive auth state + Capacitor Preferences persistence.
 * Uses React context for reactivity.
 */

import { createContext, useContext, useEffect, useRef, useState, type ReactNode, createElement } from 'react';
import { Preferences } from '@capacitor/preferences';
import { AuthUserSchema, type AuthUser } from '@zobia/shared/schemas/auth';
import { setCachedToken, resetUnauthenticatedFlag, onUnauthenticated, JWT_KEY, REFRESH_TOKEN_KEY } from '@/lib/api/client';
import { secureGet, secureSet, secureRemove } from '@/lib/auth/secureTokenStore';
import { unregisterPushOnLogout } from '@/lib/push';

/**
 * One-time migration for installs that logged in before tokens moved to the
 * Keystore-backed EncryptedSharedPreferences store (see secureTokenStore.ts):
 * if a token still sits in the old plaintext @capacitor/preferences file,
 * copy it into the encrypted store and delete the plaintext copy, rather
 * than silently signing the user out on their next app update.
 */
async function migrateLegacyPlaintextToken(key: string): Promise<string | null> {
  const encrypted = await secureGet(key);
  if (encrypted) return encrypted;
  const { value: legacy } = await Preferences.get({ key });
  if (!legacy) return null;
  await secureSet(key, legacy);
  await Preferences.remove({ key });
  return legacy;
}

const USER_KEY = 'zobia_user';

interface AuthState {
  token: string | null;
  user: AuthUser | null;
  isLoaded: boolean;
}

interface AuthContextValue extends AuthState {
  setAuth: (token: string, user: AuthUser, refreshToken?: string) => Promise<void>;
  clearAuth: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    token: null,
    user: null,
    isLoaded: false,
  });

  // Load from storage on boot
  useEffect(() => {
    (async () => {
      try {
        const [token, { value: userJson }] = await Promise.all([
          migrateLegacyPlaintextToken(JWT_KEY),
          Preferences.get({ key: USER_KEY }),
        ]);
        // Refresh token has no in-memory cache to populate, but still needs
        // migrating off the plaintext store on this same boot.
        void migrateLegacyPlaintextToken(REFRESH_TOKEN_KEY);
        let user: AuthUser | null = null;
        if (userJson) {
          try {
            const parsed = AuthUserSchema.safeParse(JSON.parse(userJson));
            if (parsed.success) user = parsed.data;
          } catch {}
        }
        if (token) {
          setCachedToken(token);
          resetUnauthenticatedFlag();
        }
        setState({ token: token ?? null, user, isLoaded: true });
      } catch {
        setState({ token: null, user: null, isLoaded: true });
      }
    })();
  }, []);

  const setAuth = async (token: string, user: AuthUser, refreshToken?: string) => {
    const writes: Array<Promise<void>> = [
      secureSet(JWT_KEY, token),
      Preferences.set({ key: USER_KEY, value: JSON.stringify(user) }),
    ];
    if (refreshToken) {
      writes.push(secureSet(REFRESH_TOKEN_KEY, refreshToken));
    }
    await Promise.all(writes);
    setCachedToken(token);
    resetUnauthenticatedFlag();
    setState((prev) => ({ ...prev, token, user }));
  };

  const clearAuth = async () => {
    // Best-effort — never let a push-unregister failure block sign-out.
    void unregisterPushOnLogout();
    await Promise.all([
      secureRemove(JWT_KEY),
      secureRemove(REFRESH_TOKEN_KEY),
      Preferences.remove({ key: USER_KEY }),
    ]);
    setCachedToken(null);
    setState((prev) => ({ ...prev, token: null, user: null }));
  };

  // ZSB-03 fix: `onUnauthenticated` (fired by client.ts/apiFetch.ts when a
  // silent token refresh fails) previously had zero subscribers, so a user
  // whose refresh token expired/was revoked never got signed out — the UI
  // kept showing stale `user`/`token` state while every API call silently
  // failed. Subscribe once here and clear auth state; AuthGuard's existing
  // `!token` effect already redirects to /auth/login once this flips `token`
  // to null, so no navigation call is needed in this file.
  const clearAuthRef = useRef(clearAuth);
  clearAuthRef.current = clearAuth;
  useEffect(() => {
    return onUnauthenticated(() => {
      void clearAuthRef.current();
    });
  }, []);

  return createElement(
    AuthContext.Provider,
    { value: { ...state, setAuth, clearAuth } },
    children
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
