"use client";

/**
 * components/portals/PortalSuggestionCard.tsx
 *
 * "Portals for you" card injected into the Home Feed after
 * FeedPage.portalSuggestion.afterIndex items (chosen server-side, weighted by
 * the admin boost dial, see lib/portals/suggestions.ts).
 *
 * Dismissal is remembered per signed-in user for 24h in localStorage (key
 * includes the user id, so it never leaks between people sharing a device).
 */

import Link from "@/components/ui/Link";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/lib/auth/hooks";
import { Icon } from "@/components/ui/Icon";
import { PortalCardTile } from "./PortalCardTile";
import type { PortalCard } from "@zobia/types";

const DISMISS_MS = 24 * 60 * 60 * 1000;

function dismissKey(userId: string): string {
  return `zobia:portals:suggest-dismissed:v1:${userId}`;
}

export function PortalSuggestionCard({ portals }: { portals: PortalCard[] }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (!userId) return;
    try {
      const at = Number(localStorage.getItem(dismissKey(userId)) ?? 0);
      if (at && Date.now() - at < DISMISS_MS) setHidden(true);
    } catch {
      /* storage unavailable — show the card */
    }
  }, [userId]);

  if (hidden || portals.length === 0) return null;

  const dismiss = () => {
    setHidden(true);
    if (!userId) return;
    try {
      localStorage.setItem(dismissKey(userId), String(Date.now()));
    } catch {
      /* best-effort */
    }
  };

  return (
    <section
      aria-label={t("portals.suggestionTitle")}
      className="rounded-xl border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-900/60"
    >
      <div className="mb-2 flex items-center gap-2">
        <Icon emoji="🧭" size={16} />
        <h3 className="text-sm font-bold text-neutral-900 dark:text-neutral-100">{t("portals.suggestionTitle")}</h3>
        <Link href="/h" className="ml-auto text-xs font-semibold text-primary hover:underline">
          {t("portals.seeAll")}
        </Link>
        <button
          type="button"
          onClick={dismiss}
          aria-label={t("portals.dismiss")}
          className="rounded p-1 text-neutral-400 hover:bg-neutral-200 hover:text-neutral-600 dark:hover:bg-neutral-800"
        >
          <Icon emoji="✕" size={12} />
        </button>
      </div>
      <div className="-mx-1 flex snap-x gap-2 overflow-x-auto px-1 pb-1">
        {portals.map((p) => (
          <PortalCardTile key={p.id} portal={p} src="feed" className="w-44 shrink-0 snap-start" />
        ))}
      </div>
    </section>
  );
}
