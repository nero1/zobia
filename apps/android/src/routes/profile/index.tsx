/**
 * apps/android/src/routes/profile/index.tsx
 *
 * Own-profile redirect — mirrors apps/web/app/(app)/profile/page.tsx, which
 * renders the logged-in user's own profile at /profile. The Android app
 * already has a full profile view at /profile/$username (used for other
 * users' profiles too, and it special-cases "viewing your own profile" so it
 * doesn't need the /api/users/search round trip) — so /profile just forwards
 * to /profile/$username for the current user rather than duplicating that UI.
 */

import { useEffect } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useAuth } from '@/lib/auth/store';

function ProfileIndexRedirect() {
  const navigate = useNavigate();
  const { user, isLoaded } = useAuth();

  useEffect(() => {
    if (!isLoaded) return;
    if (user?.username) {
      navigate({ to: '/profile/$username', params: { username: user.username }, replace: true });
    } else {
      navigate({ to: '/settings', replace: true });
    }
  }, [isLoaded, user?.username, navigate]);

  return <div className="h-full bg-white" />;
}

export const Route = createFileRoute('/profile/')({
  component: ProfileIndexRedirect,
});
