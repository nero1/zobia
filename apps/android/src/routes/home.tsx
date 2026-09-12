/**
 * apps/android/src/routes/home.tsx
 *
 * Home Dashboard — mirrors apps/web/app/(app)/home/page.tsx's redesigned
 * structure as a thin composition of components/home/*. Top to bottom: ad
 * slot, notices carousel, ad slot, tab bar (logo tab + FU/TR/FF/NE tabs),
 * then either the logo tab's dashboard content or a paginated feed tab,
 * wrapped in pull-to-refresh.
 *
 * GET /api/feed is now a real backend endpoint (built alongside the web
 * Home Dashboard work) — this route used to fall back to GET /api/moments
 * because GET /api/home/feed never existed; that workaround is gone, feed
 * tabs hit the real GET /api/feed?tab=... below (see components/home/
 * FeedTabContent.tsx).
 */

import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { PullToRefresh } from '@/components/ui/PullToRefresh';
import AdSlot from '@/components/ads/AdSlot';
import { NoticesCarousel } from '@/components/home/NoticesCarousel';
import { HomeTabs, useHomeTab, feedTabFullNameKey, TAB_ACRONYM } from '@/components/home/HomeTabs';
import { LogoTabContent } from '@/components/home/LogoTabContent';
import { FeedTabContent } from '@/components/home/FeedTabContent';
import { MysteryDropToast } from '@/components/home/MysteryDropToast';
import type { FeedTab } from '@/lib/feed/types';

function HomePage() {
  const { t } = useTranslation();
  const [tab, setTab] = useHomeTab();
  const queryClient = useQueryClient();

  const isFeedTab = tab !== 'logo';

  const handleRefresh = useCallback(async () => {
    // All Home Dashboard queries are keyed under the ['home', ...] prefix
    // (see components/home/*.tsx) — react-query's default prefix matching
    // invalidates every one of them together, whichever tab is active.
    await queryClient.invalidateQueries({ queryKey: ['home'] });
  }, [queryClient]);

  return (
    <div className="h-full overflow-y-auto bg-neutral-50">
      <div className="mx-auto w-full max-w-3xl space-y-4 p-4">
        <MysteryDropToast />

        <AdSlot placement="home_top" />
        <NoticesCarousel />
        <AdSlot placement="home_mid" />

        <HomeTabs active={tab} onChange={setTab} />

        <PullToRefresh onRefresh={handleRefresh}>
          {isFeedTab ? (
            <div className="space-y-4">
              <div className="flex items-baseline gap-3">
                <span className="rounded-full bg-primary-100 px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide text-primary-700">
                  {TAB_ACRONYM[tab as FeedTab]}
                </span>
                <h1 className="text-xl font-bold text-neutral-900">{t(feedTabFullNameKey(tab as FeedTab))}</h1>
              </div>
              <FeedTabContent tab={tab as FeedTab} />
            </div>
          ) : (
            <LogoTabContent />
          )}
        </PullToRefresh>
      </div>
    </div>
  );
}

export const Route = createFileRoute('/home')({
  component: HomePage,
});
