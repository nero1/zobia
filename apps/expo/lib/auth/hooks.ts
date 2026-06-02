/**
 * Zobia Social — useAuth hook.
 *
 * Convenience wrapper around AuthContext so consumers never import the
 * context object directly.
 *
 * @example
 * const { user, signIn, signOut, isLoading } = useAuth();
 */

import { useAuthContext, type AuthContextValue } from './context';

/**
 * Returns the full auth context value:
 *  - `user`      — currently authenticated user (or null)
 *  - `token`     — raw JWT (or null)
 *  - `isLoading` — true while the stored token is being restored
 *  - `signIn`    — persist a new JWT + user
 *  - `signOut`   — wipe stored credentials
 */
export function useAuth(): AuthContextValue {
  return useAuthContext();
}

/**
 * Returns `true` when a user is authenticated and the auth state has finished
 * loading from SecureStore.
 */
export function useIsAuthenticated(): boolean {
  const { user, isLoading } = useAuthContext();
  return !isLoading && user !== null;
}
