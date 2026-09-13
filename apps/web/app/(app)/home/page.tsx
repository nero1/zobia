"use client";

/**
 * app/(app)/home/page.tsx
 *
 * Home Dashboard — redesigned as a thin composition of components/home/*.
 * Top to bottom: ad slot, notices carousel, ad slot, tab bar (logo tab +
 * For You/Trending/Friends/New), then either the logo tab's dashboard
 * content or a paginated feed tab, wrapped in pull-to-refresh.
 *
 * PlanExpiryBanner/ErrorAlert/ActivityBanner and the Mystery XP Drop toast
 * stay visible regardless of the active tab (they're page-level alerts, not
 * feed content); everything else that was previously inline here has moved
 * into components/home/*.tsx — see that directory for each piece's
 * (unchanged) behavior.
 */

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityBanner } from "@/components/ui/ActivityBanner";
import { ErrorAlert } from "@/components/ui/ErrorAlert";
import { PlanExpiryBanner, resolvePlanExpiry, type PlanExpiryInfo } from "@/components/PlanExpiryBanner";
import { PullToRefresh } from "@/components/ui/PullToRefresh";
import { NoticesCarousel } from "@/components/home/NoticesCarousel";
import { HomeTabs, useHomeTab, feedTabFullNameKey, TAB_ACRONYM } from "@/components/home/HomeTabs";
import { LogoTabContent } from "@/components/home/LogoTabContent";
import { FeedTabContent } from "@/components/home/FeedTabContent";
import { MysteryDropToast } from "@/components/home/MysteryDropToast";
import { HomeSectionErrorBoundary } from "@/components/home/HomeSectionErrorBoundary";
import AdSlot from "@/components/ads/AdSlot";
import type { FeedTab } from "@/lib/feed/types";

interface PlatformEvent {
  name: string;
  description: string;
  xp_multiplier: number;
}

export default function HomePage() {
  const { t } = useTranslation();
  const [tab, setTab] = useHomeTab();
  const [platformEvent, setPlatformEvent] = useState<PlatformEvent | null>(null);
  const [planExpiry, setPlanExpiry] = useState<PlanExpiryInfo | null>(null);
  const [error] = useState<string | null>(null);
  const [refreshSignal, setRefreshSignal] = useState(0);

  useEffect(() => {
    fetch("/api/presence", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { data?: { event?: PlatformEvent } } | null) => {
        if (d?.data?.event) setPlatformEvent(d.data.event);
      })
      .catch(() => {});

    fetch("/api/users/me", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { user?: { plan_ends_at?: string | null; business_plan_ends_at?: string | null } } | null) => {
        const me = d?.user;
        setPlanExpiry(resolvePlanExpiry(me?.plan_ends_at ?? null, me?.business_plan_ends_at ?? null));
      })
      .catch(() => {});
  }, []);

  const handleRefresh = useCallback(async () => {
    setRefreshSignal((v) => v + 1);
    // small delay so the pull indicator doesn't just flash on a fast client cache read
    await new Promise((resolve) => setTimeout(resolve, 300));
  }, []);

  const isFeedTab = tab !== "logo";

  return (
    <div className="flex flex-col">
      <ActivityBanner event={platformEvent} />

      <div className="mx-auto w-full max-w-3xl space-y-4 p-4 sm:p-6">
        <ErrorAlert error={error} />
        {planExpiry && <PlanExpiryBanner info={planExpiry} />}
        <MysteryDropToast />

        <HomeSectionErrorBoundary section="adSlotTop">
          <AdSlot placement="home_top" />
        </HomeSectionErrorBoundary>
        <HomeSectionErrorBoundary section="noticesCarousel">
          <NoticesCarousel />
        </HomeSectionErrorBoundary>
        <HomeSectionErrorBoundary section="adSlotMid">
          <AdSlot placement="home_mid" />
        </HomeSectionErrorBoundary>

        <HomeTabs active={tab} onChange={setTab} />

        <PullToRefresh onRefresh={handleRefresh}>
          {isFeedTab ? (
            <div className="space-y-4">
              <div className="flex items-baseline gap-3">
                <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide text-blue-700 dark:bg-blue-900/50 dark:text-blue-300">
                  {TAB_ACRONYM[tab as FeedTab]}
                </span>
                <h1 className="text-xl font-bold text-neutral-900 dark:text-neutral-50">
                  {t(feedTabFullNameKey(tab as FeedTab))}
                </h1>
              </div>
              <HomeSectionErrorBoundary section="feedTabContent">
                <FeedTabContent tab={tab as FeedTab} refreshSignal={refreshSignal} />
              </HomeSectionErrorBoundary>
            </div>
          ) : (
            <HomeSectionErrorBoundary section="logoTabContent">
              <LogoTabContent key={refreshSignal} />
            </HomeSectionErrorBoundary>
          )}
        </PullToRefresh>
      </div>
    </div>
  );
}
