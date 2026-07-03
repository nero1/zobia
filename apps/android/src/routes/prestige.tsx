/**
 * apps/android/src/routes/prestige.tsx
 *
 * Prestige confirmation flow — mirrors apps/web/app/(app)/prestige/page.tsx.
 * GET /api/prestige for eligibility (Zobia Icon rank, sublevel III), POST
 * /api/prestige to confirm. Locked screen with progress bar when ineligible.
 */

import { useState } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';
import { useCurrency } from '@/lib/hooks/useCurrency';

const REQUIRED_RANK_NUMBER = 10;

interface PrestigeData {
  eligible: boolean;
  prestigeCount: number;
  currentRank: { rankName: string; rankNumber: number; sublevel: 1 | 2 | 3; nextRankXp: number | null };
  requirements: { rank: string; sublevel: number; xpRequired: string };
  rewards: { coins: number; stars: number; frame: string; title: string };
}

async function fetchPrestige(): Promise<PrestigeData> {
  const { data } = await apiClient.get<PrestigeData>('/prestige');
  return data;
}

function LockScreen({ data }: { data: PrestigeData }) {
  const { t } = useTranslation();
  const currentLevel = Math.max(data.currentRank.rankNumber, 1);
  const progressPct = Math.min(100, Math.round((currentLevel / REQUIRED_RANK_NUMBER) * 100));

  return (
    <div className="flex flex-col items-center py-12 px-6 text-center">
      <span className="text-6xl">🔒</span>
      <h2 className="mt-4 text-2xl font-bold text-neutral-900">{t('prestige.notYet', 'Not Yet')}</h2>
      <p className="mt-2 text-neutral-500">
        {t('prestige.currentRank', 'You are currently')}{' '}
        <span className="font-semibold text-neutral-900">{data.currentRank.rankName || 'Beginner'}</span>{' '}
        (Level {currentLevel}).
      </p>
      <p className="mt-1 text-sm text-neutral-500">
        {t('prestige.requiresLevel', 'Prestige requires reaching Level {{level}}', { level: REQUIRED_RANK_NUMBER })}{' '}
        (<strong>{data.requirements.rank} III</strong>).
      </p>

      <div className="mt-6 w-full max-w-xs">
        <div className="mb-1 flex justify-between text-xs text-neutral-400">
          <span>Level {currentLevel}</span>
          <span>Level {REQUIRED_RANK_NUMBER} required</span>
        </div>
        <div className="h-3 overflow-hidden rounded-full bg-neutral-200">
          <div className="h-full rounded-full bg-primary-500 transition-all" style={{ width: `${progressPct}%` }} />
        </div>
      </div>

      <Link to="/profile" className="mt-8 rounded-xl border border-neutral-300 px-6 py-2.5 text-sm font-semibold text-neutral-700">
        {t('prestige.backToProfile', 'Back to Profile')}
      </Link>
    </div>
  );
}

function ConfirmScreen({ data, onConfirm, confirming, done }: {
  data: PrestigeData;
  onConfirm: () => void;
  confirming: boolean;
  done: boolean;
}) {
  const { t } = useTranslation();
  const currency = useCurrency();

  if (done) {
    return (
      <div className="flex flex-col items-center py-16 px-6 text-center">
        <span className="text-6xl">🌟</span>
        <h2 className="mt-4 text-3xl font-bold text-neutral-900">{t('prestige.prestigeAchieved', 'Prestige Achieved!')}</h2>
        <p className="mt-2 text-neutral-500">{t('prestige.honourMessage', 'You have begun again — with honour. Your legacy grows.')}</p>
        <p className="mt-4 text-sm font-semibold text-amber-600">
          +{data.rewards.coins.toLocaleString()} {currency.softPlural.toLowerCase()}
        </p>
        <Link to="/profile" className="mt-8 rounded-xl bg-primary-600 px-8 py-3 font-semibold text-white">
          {t('prestige.returnToProfile', 'Return to Profile')}
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-5 px-4 py-4">
      <div className="rounded-xl border border-neutral-200 bg-white p-6 text-center shadow-card">
        <span className="text-5xl">⭐</span>
        <h2 className="mt-3 text-2xl font-bold text-neutral-900">{t('prestige.masteredZobia', 'You have mastered Zobia.')}</h2>
        <p className="mt-1 text-neutral-600">
          {t('prestige.confirmMessage', 'You are a {{rank}}. Do you want to Prestige and begin again — with honour?', { rank: data.currentRank.rankName })}
        </p>
        {data.prestigeCount > 0 && (
          <p className="mt-2 text-sm text-amber-600">
            {t('prestige.currentPrestige', 'Current Prestige')}: {'⭐'.repeat(Math.min(data.prestigeCount, 5))} ({data.prestigeCount})
          </p>
        )}
      </div>

      <div className="grid gap-3 grid-cols-2">
        <div className="rounded-xl border border-red-200 bg-red-50 p-3">
          <h3 className="mb-2 text-xs font-semibold text-red-700">⚠ {t('prestige.resets', 'Resets')}</h3>
          <p className="text-xs text-red-600">{t('prestige.mainRankReset', 'Main rank (back to Bronze I)')}</p>
        </div>
        <div className="rounded-xl border border-teal-200 bg-teal-50 p-3">
          <h3 className="mb-2 text-xs font-semibold text-teal-700">✓ {t('prestige.staysForever', 'Stays Forever')}</h3>
          <ul className="space-y-0.5 text-xs text-teal-600">
            <li>{t('prestige.trackLevels', 'Track levels')}</li>
            <li>{currency.softPlural} balance</li>
            <li>{t('prestige.guildMembership', 'Guild membership')}</li>
            <li>{t('prestige.legacyScore', 'Legacy score')}</li>
            <li>{t('prestige.prestigeSeasonHistory', 'Season history')}</li>
            <li>{t('prestige.friendsFollowers', 'Friends & followers')}</li>
          </ul>
        </div>
      </div>

      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
        <h3 className="mb-2 text-sm font-semibold text-amber-700">{t('prestige.prestigeRewards', 'Prestige Rewards')}</h3>
        <ul className="space-y-1 text-sm text-amber-700">
          <li>{t('prestige.prestigeStar', 'Prestige star on your profile')}</li>
          {data.rewards.frame && <li>{t('prestige.exclusiveFrame', 'Exclusive frame')}: {data.rewards.frame}</li>}
          {data.rewards.title && <li>{t('prestige.titleReward', 'Title')}: "{data.rewards.title}"</li>}
          <li>{data.rewards.coins.toLocaleString()} {currency.softPlural.toLowerCase()}</li>
        </ul>
      </div>

      <div className="flex gap-3">
        <button
          onClick={onConfirm}
          disabled={confirming}
          className="flex-1 rounded-xl bg-primary-600 py-3 font-semibold text-white disabled:opacity-60"
        >
          {confirming ? t('prestige.processing', 'Processing…') : t('prestige.yesPrestige', 'Yes, Prestige')}
        </button>
        <Link to="/profile" className="flex-1 rounded-xl border border-neutral-300 py-3 text-center font-semibold text-neutral-700">
          {t('prestige.notYetButton', 'Not yet')}
        </Link>
      </div>
    </div>
  );
}

function PrestigePage() {
  const { t } = useTranslation();
  const currency = useCurrency();
  const [done, setDone] = useState(false);
  const { data, status } = useQuery({ queryKey: ['prestige'], queryFn: fetchPrestige });

  const confirmMutation = useMutation({
    mutationFn: async () => { await apiClient.post('/prestige'); },
    onSuccess: () => setDone(true),
  });

  if (status === 'pending') {
    return (
      <div className="h-full overflow-y-auto bg-neutral-50 px-4 py-4">
        <div className="h-64 animate-pulse rounded-xl bg-neutral-200" />
      </div>
    );
  }

  if (status === 'error' || !data) {
    return (
      <div className="p-6">
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{t('error.generic')}</div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-neutral-50">
      <div className="px-4 pt-4">
        <h1 className="text-xl font-bold text-neutral-900">{t('prestige.title', 'Prestige')}</h1>
        <div className="mt-3 rounded-xl border border-blue-200 bg-blue-50 p-4">
          <p className="text-sm text-blue-700">
            {t('prestige.explainer', 'Prestige is a special milestone for the most dedicated Zobia players. Reach the highest rank to reset for exclusive rewards and a permanent star that shows how many times you have mastered the game.')}
          </p>
          <ul className="mt-2 space-y-1 text-xs text-blue-600">
            <li>⭐ Each prestige adds a star to your profile badge</li>
            <li>🪙 Earn {currency.softPlural.toLowerCase()} and exclusive frames with each prestige</li>
            <li>🔥 3× XP boost for 7 days after prestige (from your 3rd prestige)</li>
            <li>🏆 Reach Prestige 10 to be inducted into the Hall of Fame</li>
          </ul>
        </div>
      </div>

      {data.eligible ? (
        <ConfirmScreen data={data} onConfirm={() => confirmMutation.mutate()} confirming={confirmMutation.isPending} done={done} />
      ) : (
        <LockScreen data={data} />
      )}
    </div>
  );
}

export const Route = createFileRoute('/prestige')({
  component: PrestigePage,
});
