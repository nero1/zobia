/**
 * apps/android/src/routes/h/$slug.tsx
 *
 * Portal screen (/h/<slug>) — mirrors apps/web/app/h/[slug]/page.tsx. Reached
 * from #hashtag links, feed suggestion cards, the portals directory and
 * https://<web>/h/<slug> / zobia://h/<slug> deep links (see routes/__root.tsx).
 *
 * GET /api/public/portals/<slug> (cached server-side). A merged hashtag
 * resolves to its surviving portal via `canonicalSlug`, which this screen
 * follows with a replace-navigation (the native equivalent of web's 308).
 */

import { useEffect } from 'react';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';
import { useMyReferralCode } from '@/lib/referral/useReferralCode';
import { Icon } from '@/components/ui/Icon';
import { PortalView } from '@/components/portals/PortalView';
import type { PortalPayload } from '@zobia/shared/types';

type PortalResponse = PortalPayload & { canonicalSlug: string };

function PortalPage() {
  const { slug } = Route.useParams();
  const { src } = Route.useSearch();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { code: referralCode } = useMyReferralCode();

  const { data, isLoading, isError } = useQuery({
    queryKey: ['portals', 'page', slug],
    queryFn: async () => (await apiClient.get<PortalResponse>(`/public/portals/${encodeURIComponent(slug)}`)).data,
    staleTime: 60_000,
    retry: (count, err) => (err as { response?: { status?: number } })?.response?.status !== 404 && count < 2,
  });

  useEffect(() => {
    if (data && data.canonicalSlug !== slug) {
      void navigate({ to: '/h/$slug', params: { slug: data.canonicalSlug }, replace: true });
    }
  }, [data, slug, navigate]);

  if (isLoading) {
    return <div className="p-4"><div className="h-48 animate-pulse rounded-xl bg-neutral-100 dark:bg-neutral-800" /></div>;
  }
  if (isError || !data) {
    return (
      <div className="space-y-3 p-8 text-center">
        <p className="flex justify-center"><Icon emoji="🧭" size={40} /></p>
        <p className="text-sm text-neutral-600 dark:text-neutral-300">{t('portals.notFound', { tag: slug })}</p>
        <Link to="/h" className="text-sm font-medium text-primary-600">{t('portals.allPortals')}</Link>
      </div>
    );
  }
  return <PortalView payload={data} src={src} referralCode={referralCode} />;
}

export const Route = createFileRoute('/h/$slug')({
  validateSearch: (search: Record<string, unknown>): { src?: 'feed' | 'search' } => ({
    src: search.src === 'feed' || search.src === 'search' ? search.src : undefined,
  }),
  component: PortalPage,
});
