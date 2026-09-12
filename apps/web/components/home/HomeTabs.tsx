"use client";

/**
 * components/home/HomeTabs.tsx
 *
 * Home Dashboard tab bar — a logo-only default tab plus 4 feed tabs
 * (For You / Trending / Friends / New). Full names show at md: and above
 * (matching the app's existing md: breakpoint convention, e.g.
 * components/layout/Navbar.tsx's desktop/mobile split); below that,
 * acronyms (FU/TR/FF/NE) keep the bar usable on narrow phone widths.
 *
 * The logo tab is the default/active tab on a fresh login. Selection is
 * persisted in sessionStorage (not localStorage) under
 * `zobia:home:lastTab` so a same-session remount (client-side nav away and
 * back) restores the last tab, but a fresh login/page load always starts
 * back on the logo tab — sessionStorage naturally clears each new session.
 */

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { FeedTab } from "@/lib/feed/types";
import { LogoTabIcon } from "./LogoTabIcon";

export type HomeTabKey = "logo" | FeedTab;

const SESSION_KEY = "zobia:home:lastTab";

const FEED_TAB_ORDER: FeedTab[] = ["for_you", "trending", "friends", "new"];

const TAB_ICON: Record<FeedTab, string> = {
  for_you: "✨",
  trending: "🔥",
  friends: "👥",
  new: "🆕",
};

const TAB_ACRONYM: Record<FeedTab, string> = {
  for_you: "FU",
  trending: "TR",
  friends: "FF",
  new: "NE",
};

export function feedTabFullNameKey(tab: FeedTab): string {
  return `feedTabs.full.${tab}`;
}

export function useHomeTab(): [HomeTabKey, (tab: HomeTabKey) => void] {
  const [tab, setTabState] = useState<HomeTabKey>("logo");

  useEffect(() => {
    try {
      const stored = sessionStorage.getItem(SESSION_KEY);
      if (stored && (stored === "logo" || FEED_TAB_ORDER.includes(stored as FeedTab))) {
        setTabState(stored as HomeTabKey);
      }
    } catch {
      // ignore — default "logo" stands
    }
  }, []);

  function setTab(next: HomeTabKey) {
    setTabState(next);
    try {
      sessionStorage.setItem(SESSION_KEY, next);
    } catch {
      // best-effort
    }
  }

  return [tab, setTab];
}

export function HomeTabs({ active, onChange }: { active: HomeTabKey; onChange: (tab: HomeTabKey) => void }) {
  const { t } = useTranslation();

  return (
    <div
      role="tablist"
      aria-label={t("home.tabs.ariaLabel")}
      className="flex items-stretch gap-1 rounded-xl border border-neutral-200 bg-white p-1 dark:border-neutral-800 dark:bg-neutral-900"
    >
      <button
        role="tab"
        aria-selected={active === "logo"}
        onClick={() => onChange("logo")}
        className={`flex flex-1 items-center justify-center rounded-lg px-2 py-2 transition-colors ${
          active === "logo"
            ? "bg-blue-600"
            : "text-neutral-500 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
        }`}
        aria-label={t("home.tabs.home")}
      >
        <LogoTabIcon size={20} />
      </button>
      {FEED_TAB_ORDER.map((feedTab) => (
        <button
          key={feedTab}
          role="tab"
          aria-selected={active === feedTab}
          onClick={() => onChange(feedTab)}
          className={`flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-2 py-2 text-sm font-semibold transition-colors ${
            active === feedTab
              ? "bg-blue-600 text-white"
              : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
          }`}
        >
          <span aria-hidden="true">{TAB_ICON[feedTab]}</span>
          <span className="hidden md:inline">{t(feedTabFullNameKey(feedTab))}</span>
          <span className="md:hidden">{TAB_ACRONYM[feedTab]}</span>
        </button>
      ))}
    </div>
  );
}

export { FEED_TAB_ORDER, TAB_ACRONYM };
