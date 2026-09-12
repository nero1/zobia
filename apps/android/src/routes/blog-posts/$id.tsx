/**
 * apps/android/src/routes/blog-posts/$id.tsx
 *
 * Id-based redirect shim for blog post deep links from the Home Feed (see
 * lib/feed/deeplink.ts header comment). No client-callable id->slug JSON
 * API exists, so this hands off to the web app's own id->slug DB redirect
 * shim (apps/web/app/(app)/blog-posts/[id]/page.tsx) via the in-app
 * Browser, then returns the user to Home once that browser tab is closed.
 */

import { useEffect, useRef } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Browser } from '@capacitor/browser';
import { env } from '@/lib/env';

function BlogPostRedirect() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const openedRef = useRef(false);

  useEffect(() => {
    if (openedRef.current) return;
    openedRef.current = true;
    void Browser.open({ url: `${env.VITE_WEB_BASE_URL}/blog-posts/${id}` }).finally(() => {
      navigate({ to: '/home', replace: true });
    });
  }, [id, navigate]);

  return null;
}

export const Route = createFileRoute('/blog-posts/$id')({
  component: BlogPostRedirect,
});
