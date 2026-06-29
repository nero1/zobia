/**
 * apps/android/src/lib/auth/store.ts
 *
 * In-memory reactive auth state + Capacitor Preferences persistence.
 * Uses React context for reactivity.
 */

import { createContext, useContext, useEffect, useState, type ReactNode, createElement } from 'react';
import { Preferences } from '@capacitor/preferences';
import { AuthUserSchema, type AuthUser } from '@zobia/shared/schemas/auth';
import { setCachedToken, resetUnauthenticatedFlag, JWT_KEY, REFRESH_TOKEN_KEY } from '@/lib/api/client';

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
        const [{ value: token }, { value: userJson }] = await Promise.all([
          Preferences.get({ key: JWT_KEY }),
          Preferences.get({ key: USER_KEY }),
        ]);
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
    const prefs: Array<Promise<void>> = [
      Preferences.set({ key: JWT_KEY, value: token }),
      Preferences.set({ key: USER_KEY, value: JSON.stringify(user) }),
    ];
    if (refreshToken) {
      prefs.push(Preferences.set({ key: REFRESH_TOKEN_KEY, value: refreshToken }));
    }
    await Promise.all(prefs);
    setCachedToken(token);
    resetUnauthenticatedFlag();
    setState((prev) => ({ ...prev, token, user }));
  };

  const clearAuth = async () => {
    await Promise.all([
      Preferences.remove({ key: JWT_KEY }),
      Preferences.remove({ key: REFRESH_TOKEN_KEY }),
      Preferences.remove({ key: USER_KEY }),
    ]);
    setCachedToken(null);
    setState((prev) => ({ ...prev, token: null, user: null }));
  };

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
