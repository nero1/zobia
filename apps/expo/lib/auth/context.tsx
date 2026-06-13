/**
 * Zobia Social — Auth context.
 *
 * Stores the JWT in `expo-secure-store` and exposes:
 *  - `user`      — decoded user payload (or null when logged out)
 *  - `token`     — raw JWT string (or null)
 *  - `isLoading` — true while restoring the token on app start
 *  - `signIn`    — persist a token and decode the user
 *  - `signOut`   — wipe the token and reset state
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import * as SecureStore from 'expo-secure-store';
import { JWT_KEY, REFRESH_TOKEN_KEY, onUnauthenticated } from '@/lib/api/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Minimal user payload decoded from the JWT body. */
export interface AuthUser {
  id: string;
  username: string;
  avatarEmoji: string;
  city: string;
  xp: number;
  rankTier: 'bronze' | 'silver' | 'gold' | 'platinum' | 'diamond';
}

export interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  isLoading: boolean;
  /**
   * Persist `jwt`, `refreshToken`, and `user`.
   * @param jwt          Raw access JWT string received from the Zobia API.
   * @param user         Decoded user object (avoid runtime crypto dependency).
   * @param refreshToken Raw refresh token (optional for backward compat).
   */
  signIn: (jwt: string, user: AuthUser, refreshToken?: string) => Promise<void>;
  /** Clear the stored token and reset auth state. */
  signOut: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const AuthContext = createContext<AuthContextValue>({
  user: null,
  token: null,
  isLoading: true,
  signIn: async () => {},
  signOut: async () => {},
});

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

/**
 * AuthProvider — wrap the root layout with this.
 *
 * On mount it attempts to restore a persisted JWT from SecureStore.
 * Because the JWT payload is stored alongside the token, no crypto
 * dependency is needed at startup.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Restore persisted session on app start.
  useEffect(() => {
    (async () => {
      try {
        const [storedToken, storedUser] = await Promise.all([
          SecureStore.getItemAsync(JWT_KEY),
          SecureStore.getItemAsync('zobia_user'),
        ]);
        if (storedToken && storedUser) {
          setToken(storedToken);
          setUser(JSON.parse(storedUser) as AuthUser);
        }
      } catch {
        // Storage read failures are non-fatal — user just needs to log in.
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  // Subscribe to unauthenticated events (triggered when token refresh fails).
  useEffect(() => {
    const unsubscribe = onUnauthenticated(() => {
      setToken(null);
      setUser(null);
    });
    return unsubscribe;
  }, []);

  const signIn = useCallback(async (jwt: string, authUser: AuthUser, refreshToken?: string) => {
    const writes: Promise<void>[] = [
      SecureStore.setItemAsync(JWT_KEY, jwt),
      SecureStore.setItemAsync('zobia_user', JSON.stringify(authUser)),
    ];
    if (refreshToken) {
      writes.push(SecureStore.setItemAsync(REFRESH_TOKEN_KEY, refreshToken));
    }
    await Promise.all(writes);
    setToken(jwt);
    setUser(authUser);
  }, []);

  const signOut = useCallback(async () => {
    await Promise.all([
      SecureStore.deleteItemAsync(JWT_KEY),
      SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY),
      SecureStore.deleteItemAsync('zobia_user'),
    ]);
    setToken(null);
    setUser(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ user, token, isLoading, signIn, signOut }),
    [user, token, isLoading, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// ---------------------------------------------------------------------------
// Internal hook (used by the public useAuth hook)
// ---------------------------------------------------------------------------

/** @internal */
export function useAuthContext(): AuthContextValue {
  return useContext(AuthContext);
}
