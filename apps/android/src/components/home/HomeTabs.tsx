/**
 * apps/android/src/components/home/HomeTabs.tsx
 *
 * Home Dashboard tab bar — mirrors apps/web/components/home/HomeTabs.tsx: a
 * logo-only default tab plus 4 feed tabs (For You / Trending / Friends /
 * New). This screen is ALWAYS phone-width in the Capacitor app (no desktop
 * breakpoint exists here), so per the product spec the acronym labels
 * (FU/TR/FF/NE) are shown unconditionally — the full-name-at-md: behavior
 * is web-only.
 *
 * The logo tab is the default/active tab on a fresh app launch. Selection
 * is kept in a module-level variable (not localStorage/Preferences) so a
 * same-session remount (in-app nav away and back) restores the last tab,
 * but a fresh cold start of the app always starts back on the logo tab —
 * a Capacitor WebView is torn down and its JS heap discarded when the app
 * process is killed, so a plain in-memory variable is the true equivalent
 * of web's sessionStorage-per-tab behavior here, without depending on
 * whatever the WebView happens to do with sessionStorage across backgrounding.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { FeedTab } from '@/lib/feed/types';
import { LogoTabIcon } from './LogoTabIcon';

export type HomeTabKey = 'logo' | FeedTab;

const FEED_TAB_ORDER: FeedTab[] = ['for_you', 'trending', 'friends', 'new'];

const TAB_ICON: Record<FeedTab, string> = {
  for_you: '✨',
  trending: '🔥',
  friends: '👥',
  new: '🆕',
};

const TAB_ACRONYM: Record<FeedTab, string> = {
  for_you: 'FU',
  trending: 'TR',
  friends: 'FF',
  new: 'NE',
};

export function feedTabFullNameKey(tab: FeedTab): string {
  return `feedTabs.full.${tab}`;
}

// Module-level, not component state — survives remounts within the same
// app process (cold-start equivalent of web's per-session sessionStorage).
let lastTab: HomeTabKey = 'logo';

export function useHomeTab(): [HomeTabKey, (tab: HomeTabKey) => void] {
  const [tab, setTabState] = useState<HomeTabKey>(lastTab);

  function setTab(next: HomeTabKey) {
    lastTab = next;
    setTabState(next);
  }

  return [tab, setTab];
}

export function HomeTabs({ active, onChange }: { active: HomeTabKey; onChange: (tab: HomeTabKey) => void }) {
  const { t } = useTranslation();

  return (
    <div
      role="tablist"
      aria-label={t('home.tabs.ariaLabel')}
      className="flex items-stretch gap-1 rounded-xl border border-neutral-200 bg-white p-1"
    >
      <button
        type="button"
        role="tab"
        aria-selected={active === 'logo'}
        onClick={() => onChange('logo')}
        className={`flex flex-1 items-center justify-center rounded-lg px-2 py-2 transition-colors ${
          active === 'logo' ? 'bg-primary-600' : 'text-neutral-500 hover:bg-neutral-100'
        }`}
        aria-label={t('home.tabs.home')}
      >
        <LogoTabIcon size={20} />
      </button>
      {FEED_TAB_ORDER.map((feedTab) => (
        <button
          key={feedTab}
          type="button"
          role="tab"
          aria-selected={active === feedTab}
          onClick={() => onChange(feedTab)}
          className={`flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-2 py-2 text-sm font-semibold transition-colors ${
            active === feedTab ? 'bg-primary-600 text-white' : 'text-neutral-600 hover:bg-neutral-100'
          }`}
        >
          <span aria-hidden="true">{TAB_ICON[feedTab]}</span>
          <span>{TAB_ACRONYM[feedTab]}</span>
        </button>
      ))}
    </div>
  );
}

export { FEED_TAB_ORDER, TAB_ACRONYM };
