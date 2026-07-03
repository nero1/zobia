/**
 * apps/android/src/components/admin/AdminGuard.tsx
 *
 * Client-side gate for /admin/* routes: redirects to /home if the signed-in
 * user isn't an admin. This is a UX convenience only — every /api/admin/*
 * call is independently re-verified against the DB by withAdminAuth on the
 * backend (see apps/web/lib/api/middleware.ts), so a spoofed/stale `is_admin`
 * claim here can never grant real access, only a misleading nav state.
 */

import { useEffect } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useAuth } from '@/lib/auth/store';

export function AdminGuard({ children }: { children: React.ReactNode }) {
  const { user, isLoaded } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (isLoaded && !user?.is_admin) {
      navigate({ to: '/home', replace: true });
    }
  }, [isLoaded, user, navigate]);

  if (!isLoaded || !user?.is_admin) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="w-8 h-8 border-2 border-primary-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return <>{children}</>;
}
