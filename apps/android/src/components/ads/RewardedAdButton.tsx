/**
 * apps/android/src/components/ads/RewardedAdButton.tsx
 *
 * "Watch an ad, earn Credits" button (PRD §11/§17 — free & Plus plan users,
 * capped at `ad_rewarded_daily_cap`/day). Mirrors
 * apps/web/components/ads/RewardedAdButton.tsx but drives the native AdMob
 * rewarded unit (lib/ads/admob.ts showRewarded()) instead of an in-house
 * "watch for N seconds" placement, then claims via the same
 * POST /api/economy/rewards/ad-reward endpoint.
 *
 * On a 429 (daily cap reached) response, the cap-reached state is cached
 * locally for the rest of the UTC day (Preferences) — mirrors the Expo
 * app's MMKV local cap hint (PRD Bug 52) so the button doesn't invite the
 * user to retry a call the server will just reject again.
 */

import { useEffect, useState } from 'react';
import { Preferences } from '@capacitor/preferences';
import { useTranslation } from 'react-i18next';
import type { AxiosError } from 'axios';
import { apiClient } from '@/lib/api/client';
import { showRewarded } from '@/lib/ads/admob';

const CAP_HINT_KEY = 'zobia_ad_reward_cap_date';

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

interface AdRewardResponse {
  coinsAwarded: number;
  remainingToday: number;
}

interface AdRewardErrorBody {
  error?: { code?: string; message?: string };
}

export default function RewardedAdButton({ onRewarded }: { onRewarded?: (coinsAwarded: number) => void }) {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<'idle' | 'loading' | 'claiming' | 'error' | 'capped'>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Preferences.get({ key: CAP_HINT_KEY }).then(({ value }) => {
      if (value === todayUTC()) setPhase('capped');
    });
  }, []);

  async function handleWatch() {
    setPhase('loading');
    setError(null);
    try {
      const result = await showRewarded();
      if (!result) {
        setError(t('wallet.rewardedAd.unavailable', 'No rewarded ad is available right now — try again later.'));
        setPhase('error');
        return;
      }

      setPhase('claiming');
      const { data } = await apiClient.post<AdRewardResponse>('/economy/rewards/ad-reward', {});
      onRewarded?.(data.coinsAwarded);
      setPhase('idle');
    } catch (err) {
      const axiosErr = err as AxiosError<AdRewardErrorBody>;
      if (axiosErr.response?.status === 429) {
        await Preferences.set({ key: CAP_HINT_KEY, value: todayUTC() });
        setPhase('capped');
        return;
      }
      setError(axiosErr.response?.data?.error?.message ?? t('wallet.rewardedAd.failed', 'Could not claim reward.'));
      setPhase('error');
    }
  }

  if (phase === 'capped') {
    return (
      <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-4 text-center">
        <p className="text-sm font-medium text-neutral-500">{t('wallet.rewardedAd.capped', "You've claimed all your rewarded ads today. Come back tomorrow!")}</p>
      </div>
    );
  }

  return (
    <div>
      <button
        onClick={handleWatch}
        disabled={phase === 'loading' || phase === 'claiming'}
        className="w-full rounded-xl bg-primary-600 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
      >
        {phase === 'loading'
          ? t('wallet.rewardedAd.loading', 'Loading ad…')
          : phase === 'claiming'
            ? t('wallet.rewardedAd.claiming', 'Claiming…')
            : t('wallet.rewardedAd.cta', '🎬 Watch an ad, earn Credits')}
      </button>
      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
    </div>
  );
}
