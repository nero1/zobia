/**
 * apps/android/src/components/home/MysteryDropToast.tsx
 *
 * Mirrors apps/web/components/home/MysteryDropToast.tsx (PRD §2.1). Fetches
 * recent unread mystery drop notifications and shows a dismissible toast.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';

interface MysteryDropNotification {
  xpAmount: number;
}

async function fetchMysteryDrop(): Promise<MysteryDropNotification | null> {
  const { data } = await apiClient.get<{ notifications?: Array<{ payload?: { xpAmount?: number } }> }>(
    '/notifications?type=mystery_xp_drop&unread=true&limit=1'
  );
  const latest = data?.notifications?.[0];
  if (!latest) return null;
  return { xpAmount: latest.payload?.xpAmount ?? 0 };
}

export function MysteryDropToast() {
  const { t } = useTranslation();
  const { data: drop } = useQuery({ queryKey: ['home', 'mysteryDrop'], queryFn: fetchMysteryDrop });
  const [dismissed, setDismissed] = useState(false);

  if (dismissed || !drop || drop.xpAmount <= 0) return null;

  return (
    <div className="flex items-center gap-3 rounded-xl border border-yellow-300 bg-yellow-50 px-4 py-3 shadow-sm">
      <span className="text-2xl">⚡</span>
      <div className="flex-1">
        <p className="text-sm font-bold text-yellow-900">{t('home.mysteryDrop.title')}</p>
        <p className="text-xs text-yellow-700">{t('home.mysteryDrop.body', { xp: drop.xpAmount.toLocaleString() })}</p>
      </div>
      <button type="button" onClick={() => setDismissed(true)} className="text-yellow-500" aria-label={t('action.close')}>
        ✕
      </button>
    </div>
  );
}
