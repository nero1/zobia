/**
 * apps/android/src/components/auth/AuthGuard.tsx
 *
 * Redirects unauthenticated users to /auth/login.
 * Renders children when auth is loaded and token is present.
 */

import { useEffect } from 'react';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { useAuth } from '@/lib/auth/store';
import { getCachedToken, consumeAutoSignOutReason } from '@/lib/api/client';

interface AuthGuardProps {
  children: React.ReactNode;
}

export function AuthGuard({ children }: AuthGuardProps) {
  const { token, isLoaded } = useAuth();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  useEffect(() => {
    // getCachedToken() is set synchronously the instant login succeeds, before the
    // React state update from setAuth() commits. Falling back to it here avoids a
    // race right after OAuth where this effect can fire (and redirect to login)
    // during the one render that still sees the pre-login `token` from context.
    if (isLoaded && !token && !getCachedToken()) {
      // A refresh-token failure (session expired / revoked) sets this reason
      // via signalUnauthenticated(); a voluntary "Log out" tap never sets it.
      // Carry it through so the login screen can show an explanatory banner
      // instead of dumping the user back at login with no context — this is
      // the case users report as "I just get logged out with no explanation".
      const reason = consumeAutoSignOutReason();
      navigate({
        to: '/auth/login',
        replace: true,
        search: reason ? { reason, redirect: pathname } : undefined,
      });
    }
  }, [isLoaded, token, navigate, pathname]);

  if (!isLoaded) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-8 h-8 border-2 border-primary-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!token) return null;

  return <>{children}</>;
}
