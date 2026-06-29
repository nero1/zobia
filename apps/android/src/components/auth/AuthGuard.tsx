/**
 * apps/android/src/components/auth/AuthGuard.tsx
 *
 * Redirects unauthenticated users to /auth/login.
 * Renders children when auth is loaded and token is present.
 */

import { useEffect } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useAuth } from '@/lib/auth/store';

interface AuthGuardProps {
  children: React.ReactNode;
}

export function AuthGuard({ children }: AuthGuardProps) {
  const { token, isLoaded } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (isLoaded && !token) {
      navigate({ to: '/auth/login', replace: true });
    }
  }, [isLoaded, token, navigate]);

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
