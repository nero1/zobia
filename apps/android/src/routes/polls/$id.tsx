/**
 * apps/android/src/routes/polls/$id.tsx
 *
 * Id-based redirect shim for poll deep links from the Home Feed (see
 * lib/feed/deeplink.ts header comment). No client-callable id->slug JSON
 * API exists, so this hands off to the web app's own id->slug DB redirect
 * shim (apps/web/app/(app)/polls/[id]/page.tsx) via the in-app Browser,
 * then returns the user to Home once that browser tab is closed. Mirrors
 * routes/blog-posts/$id.tsx.
 */

import { useEffect, useRef } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Browser } from '@capacitor/browser';
import { env } from '@/lib/env';

function PollRedirect() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const openedRef = useRef(false);

  useEffect(() => {
    if (openedRef.current) return;
    openedRef.current = true;
    void Browser.open({ url: `${env.VITE_WEB_BASE_URL}/polls/${id}` }).finally(() => {
      navigate({ to: '/home', replace: true });
    });
  }, [id, navigate]);

  return null;
}

export const Route = createFileRoute('/polls/$id')({
  component: PollRedirect,
});
