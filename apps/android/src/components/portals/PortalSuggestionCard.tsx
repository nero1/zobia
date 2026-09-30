/**
 * apps/android/src/components/portals/PortalSuggestionCard.tsx
 *
 * Mirrors apps/web/components/portals/PortalSuggestionCard.tsx: the "Portals
 * for you" feed card. Dismissal is remembered for 24h in localStorage under a
 * per-user key (same mechanism and scoping as useNewMemberQuestDismissal.ts),
 * so a shared device never leaks one user's dismissal into another's session.
 */

import { Link } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/lib/auth/store';
import { Icon } from '@/components/ui/Icon';
import { PortalCardTile } from './PortalCardTile';
import type { PortalCard } from '@zobia/shared/types';

const DISMISS_MS = 24 * 60 * 60 * 1000;
const dismissKey = (userId: string) => `zobia:portals:suggest-dismissed:v1:${userId}`;

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
    <section aria-label={t('portals.suggestionTitle')} className="rounded-xl border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800/60 p-3">
      <div className="mb-2 flex items-center gap-2">
        <Icon emoji="🧭" size={16} />
        <h3 className="text-sm font-bold text-neutral-900 dark:text-neutral-100">{t('portals.suggestionTitle')}</h3>
        <Link to="/h" className="ml-auto text-xs font-semibold text-primary-600">
          {t('portals.seeAll')}
        </Link>
        <button type="button" onClick={dismiss} aria-label={t('portals.dismiss')} className="rounded p-1 text-neutral-400">
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
