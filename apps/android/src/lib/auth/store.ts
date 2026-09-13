/**
 * apps/android/src/lib/auth/store.ts
 *
 * In-memory reactive auth state + Capacitor Preferences persistence.
 * Uses React context for reactivity.
 */

import { createContext, useContext, useEffect, useRef, useState, type ReactNode, createElement } from 'react';
import { Preferences } from '@capacitor/preferences';
import { AuthUserSchema, type AuthUser } from '@zobia/shared/schemas/auth';
import { apiClient, setCachedToken, resetUnauthenticatedFlag, onUnauthenticated, JWT_KEY, REFRESH_TOKEN_KEY } from '@/lib/api/client';
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

import { queryClient } from '@/lib/query/client';
import { setQueryCacheOwner } from '@/lib/query/cacheOwner';

const USER_KEY = 'zobia_user';
/**
 * Marker for "this session is currently impersonating another user" — holds
 * the admin's own user id, or is absent when not impersonating. Deliberately
 * NOT in the Keystore-backed secure store (secureTokenStore.ts): it is not a
 * credential, just a UI marker, exactly like web's non-HttpOnly
 * `zobia_impersonating` cookie (see ImpersonationBanner.tsx) — reading it
 * must not require decrypting anything on every app boot.
 */
const IMPERSONATED_BY_KEY = 'zobia_impersonated_by';

interface AuthState {
  token: string | null;
  user: AuthUser | null;
  isLoaded: boolean;
  /** Admin user id, set only while this session is impersonating another user. */
  impersonatedBy: string | null;
}

/** Shape returned by both POST /admin/users/:id/impersonate and POST /auth/impersonate/end (Bearer mode). */
interface ImpersonationTokenResponse {
  accessToken: string;
  refreshToken: string;
  user: unknown;
  impersonatedBy?: string;
}

interface AuthContextValue extends AuthState {
  setAuth: (token: string, user: AuthUser, refreshToken?: string) => Promise<void>;
  clearAuth: () => Promise<void>;
  /** Admin-only: switch this session's own stored tokens to the target user's, natively — no browser. */
  impersonate: (userId: string) => Promise<void>;
  /** Restore the admin's own session that `impersonate()` switched away from. */
  endImpersonation: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    token: null,
    user: null,
    isLoaded: false,
    impersonatedBy: null,
  });

  // Load from storage on boot
  useEffect(() => {
    (async () => {
      try {
        const [token, { value: userJson }, { value: impersonatedBy }] = await Promise.all([
          migrateLegacyPlaintextToken(JWT_KEY),
          Preferences.get({ key: USER_KEY }),
          Preferences.get({ key: IMPERSONATED_BY_KEY }),
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
        // Adopt the restored user as the persisted-cache owner before any
        // query runs, so a boot never reads another account's IndexedDB
        // entries (see lib/query/cacheOwner.ts).
        await setQueryCacheOwner(user?.id ?? null);
        setState({ token: token ?? null, user, isLoaded: true, impersonatedBy: impersonatedBy ?? null });
      } catch {
        await setQueryCacheOwner(null);
        setState({ token: null, user: null, isLoaded: true, impersonatedBy: null });
      }
    })();
  }, []);

  const setAuth = async (token: string, user: AuthUser, refreshToken?: string, impersonatedBy?: string | null) => {
    const nextImpersonatedBy = impersonatedBy ?? null;
    const writes: Array<Promise<void>> = [
      secureSet(JWT_KEY, token),
      Preferences.set({ key: USER_KEY, value: JSON.stringify(user) }),
      nextImpersonatedBy
        ? Preferences.set({ key: IMPERSONATED_BY_KEY, value: nextImpersonatedBy })
        : Preferences.remove({ key: IMPERSONATED_BY_KEY }),
    ];
    if (refreshToken) {
      writes.push(secureSet(REFRESH_TOKEN_KEY, refreshToken));
    }
    await Promise.all(writes);
    setCachedToken(token);
    resetUnauthenticatedFlag();
    // Switch the persisted-cache namespace to this user and drop anything the
    // previous owner left behind, in memory and on disk. Impersonation counts
    // as a different owner for this purpose — an admin acting as someone else
    // must not see their own cached data attributed to the target account.
    //
    // Cleared unconditionally here (unlike the web provider's first-adopt case)
    // because setAuth only ever runs on an explicit sign-in, impersonation
    // switch, or token restore — never mid-render — so there is no in-flight
    // page load whose results we would be throwing away.
    queryClient.clear();
    await setQueryCacheOwner(user.id);
    setState((prev) => ({ ...prev, token, user, impersonatedBy: nextImpersonatedBy }));
  };

  const clearAuth = async () => {
    // Best-effort — never let a push-unregister failure block sign-out.
    void unregisterPushOnLogout();
    await Promise.all([
      secureRemove(JWT_KEY),
      secureRemove(REFRESH_TOKEN_KEY),
      Preferences.remove({ key: USER_KEY }),
      Preferences.remove({ key: IMPERSONATED_BY_KEY }),
    ]);
    setCachedToken(null);
    // Sign-out must leave nothing readable for the next person to use this
    // device: clear the in-memory cache and purge the signed-out account's
    // persisted entries.
    queryClient.clear();
    await setQueryCacheOwner(null);
    setState((prev) => ({ ...prev, token: null, user: null, impersonatedBy: null }));
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

  // Applies an ImpersonationTokenResponse (from either endpoint below) to
  // this session's stored tokens/user — the actual "switch" is just a
  // setAuth call, same mechanism a normal login uses.
  const applyImpersonationResponse = async (res: ImpersonationTokenResponse) => {
    const parsed = AuthUserSchema.safeParse(res.user);
    if (!parsed.success) {
      throw new Error('Impersonation response had an unexpected user shape');
    }
    await setAuth(res.accessToken, parsed.data, res.refreshToken, res.impersonatedBy ?? null);
  };

  /**
   * Admin-only: POST /admin/users/:id/impersonate (Bearer mode — see
   * apps/web/app/api/admin/users/[userId]/impersonate/route.ts) mints a
   * fresh token pair for the target user plus the admin's own id, and this
   * swaps the app's own stored session to it — natively, no browser tab.
   * AdminGuard/AdminShell should navigate away from /admin/* right after
   * this resolves, since the session is no longer an admin session.
   */
  const impersonate = async (userId: string) => {
    const { data } = await apiClient.post<ImpersonationTokenResponse>(`/admin/users/${userId}/impersonate`);
    await applyImpersonationResponse(data);
  };

  /**
   * Ends impersonation and restores the admin's own session. Calls
   * POST /auth/impersonate/end (Bearer mode), which validates the
   * impersonation via the current access token's own `impersonated_by`
   * claim server-side and returns a fresh token pair for the admin.
   */
  const endImpersonation = async () => {
    const { data } = await apiClient.post<ImpersonationTokenResponse>('/auth/impersonate/end');
    await applyImpersonationResponse(data);
  };

  return createElement(
    AuthContext.Provider,
    { value: { ...state, setAuth, clearAuth, impersonate, endImpersonation } },
    children
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
