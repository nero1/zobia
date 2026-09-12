/**
 * apps/android/src/routes/business-posts/$id.tsx
 *
 * Id-based redirect shim for business page post deep links from the Home
 * Feed — mirrors routes/blog-posts/$id.tsx (see lib/feed/deeplink.ts header
 * comment). Hands off to apps/web/app/(app)/business-posts/[id]/page.tsx
 * via the in-app Browser.
 */

import { useEffect, useRef } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Browser } from '@capacitor/browser';
import { env } from '@/lib/env';

function BusinessPostRedirect() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const openedRef = useRef(false);

  useEffect(() => {
    if (openedRef.current) return;
    openedRef.current = true;
    void Browser.open({ url: `${env.VITE_WEB_BASE_URL}/business-posts/${id}` }).finally(() => {
      navigate({ to: '/home', replace: true });
    });
  }, [id, navigate]);

  return null;
}

export const Route = createFileRoute('/business-posts/$id')({
  component: BusinessPostRedirect,
});
