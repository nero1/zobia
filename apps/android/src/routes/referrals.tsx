/**
 * apps/android/src/routes/referrals.tsx
 *
 * Referrals screen — mirrors apps/web/app/(app)/referrals/page.tsx: the
 * user's referral link (copy-to-clipboard), Tier 1/Tier 2 stats, a two-tier
 * explainer, and a table of referred users. GET /referrals returns the
 * envelope apiClient already unwraps to { referralCode, referralUrl,
 * tier1Count, tier2Count, xpEarned, coinsEarned, commissions, referrals }.
 */

import { useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';

interface ReferralStats {
  referralCode: string;
  referralUrl: string;
  tier1Count: number;
  tier2Count: number;
  tier1XpEarned: number;
  tier2XpEarned: number;
  tier1CoinsEarned: number;
  tier2CoinsEarned: number;
}

interface ReferredUser {
  userId: string;
  username: string;
  displayName: string;
  tier: 1 | 2;
  joinedAt: string;
  qualifyingActionCompleted: boolean;
  xpEarned: number;
  coinsEarned: number;
}

interface ReferralsData {
  stats: ReferralStats;
  referredUsers: ReferredUser[];
}

async function fetchReferrals(): Promise<ReferralsData> {
  const { data: apiData } = await apiClient.get<Record<string, unknown>>('/referrals');
  return {
    stats: {
      referralCode: String(apiData.referralCode ?? ''),
      referralUrl: String(apiData.referralUrl ?? ''),
      tier1Count: Number(apiData.tier1Count ?? 0),
      tier2Count: Number(apiData.tier2Count ?? 0),
      tier1XpEarned: Number(apiData.xpEarned ?? 0),
      tier2XpEarned: 0,
      tier1CoinsEarned: Number(apiData.coinsEarned ?? 0),
      tier2CoinsEarned: Number((apiData.commissions as Record<string, unknown>)?.tier2CoinsEarned ?? 0),
    },
    referredUsers: ((apiData.referrals as Record<string, unknown>[]) ?? []).map((r) => ({
      userId: String(r.id ?? ''),
      username: String(r.referredUsername ?? ''),
      displayName: String(r.referredDisplayName ?? r.referredUsername ?? 'Unknown'),
      tier: (Number(r.tier) === 1 ? 1 : 2) as 1 | 2,
      joinedAt: String(r.createdAt ?? r.created_at ?? new Date().toISOString()),
      qualifyingActionCompleted: Boolean(r.qualified),
      xpEarned: Number(r.xpReward ?? r.xp_reward ?? 0),
      coinsEarned: Number(r.coinReward ?? r.coin_reward ?? 0),
    })),
  };
}

function ReferralLinkCard({ url }: { url: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Fallback: nothing further we can do without a Clipboard plugin.
    }
  }

  return (
    <div className="bg-white rounded-xl p-4 shadow-card mb-3">
      <h2 className="mb-3 text-sm font-semibold text-neutral-700">{t('referrals.linkCard.title')}</h2>
      <div className="flex gap-2">
        <input
          readOnly
          value={url}
          className="flex-1 truncate rounded-xl border border-neutral-300 bg-neutral-50 px-4 py-2.5 text-sm text-neutral-600"
        />
        <button
          onClick={handleCopy}
          className={`shrink-0 rounded-xl px-4 py-2.5 text-sm font-semibold ${copied ? 'bg-success-600 text-white' : 'bg-primary-600 text-white'}`}
        >
          {copied ? t('referrals.linkCard.copied') : t('referrals.linkCard.copy')}
        </button>
      </div>
      <p className="mt-2 text-xs text-neutral-500">{t('referrals.linkCard.hint')}</p>
    </div>
  );
}

function StatsGrid({ stats }: { stats: ReferralStats }) {
  const { t } = useTranslation();
  const items = [
    { label: t('referrals.stats.tier1'), value: stats.tier1Count.toLocaleString(), sub: t('referrals.stats.direct') },
    { label: t('referrals.stats.tier2'), value: stats.tier2Count.toLocaleString(), sub: t('referrals.stats.indirect') },
    { label: t('referrals.stats.xpEarned'), value: (stats.tier1XpEarned + stats.tier2XpEarned).toLocaleString(), sub: t('referrals.stats.totalXp') },
    { label: t('referrals.stats.coinsEarned'), value: (stats.tier1CoinsEarned + stats.tier2CoinsEarned).toLocaleString(), sub: t('referrals.stats.totalCoins') },
  ];

  return (
    <div className="grid grid-cols-2 gap-2 mb-3">
      {items.map((item) => (
        <div key={item.label} className="bg-white rounded-xl p-3 shadow-card">
          <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500">{item.label}</p>
          <p className="mt-1 text-lg font-bold text-neutral-900">{item.value}</p>
          <p className="text-xs text-neutral-400">{item.sub}</p>
        </div>
      ))}
    </div>
  );
}

function TwoTierExplainer() {
  const { t } = useTranslation();
  return (
    <div className="bg-white rounded-xl p-4 shadow-card mb-3">
      <h2 className="mb-3 text-sm font-semibold text-neutral-700">{t('referrals.explainer.title')}</h2>
      <div className="space-y-3 text-sm text-neutral-600">
        <div className="flex gap-3">
          <span className="mt-0.5 shrink-0 rounded-full bg-primary-100 px-2 py-0.5 text-xs font-bold text-primary-700">T1</span>
          <div>
            <p className="font-semibold text-neutral-900">{t('referrals.explainer.tier1Title')}</p>
            <p className="mt-0.5 text-xs">{t('referrals.explainer.tier1Body')}</p>
          </div>
        </div>
        <div className="flex gap-3">
          <span className="mt-0.5 shrink-0 rounded-full bg-success-100 px-2 py-0.5 text-xs font-bold text-success-700">T2</span>
          <div>
            <p className="font-semibold text-neutral-900">{t('referrals.explainer.tier2Title')}</p>
            <p className="mt-0.5 text-xs">{t('referrals.explainer.tier2Body')}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function ReferredUserRow({ u }: { u: ReferredUser }) {
  const { t } = useTranslation();
  return (
    <div className="px-4 py-3 border-b border-neutral-100 last:border-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold text-sm text-neutral-900 truncate">{u.displayName}</p>
          <p className="text-xs text-neutral-400">@{u.username}</p>
        </div>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${u.tier === 1 ? 'bg-primary-100 text-primary-700' : 'bg-success-100 text-success-700'}`}>
          {t('referrals.table.tier', { tier: u.tier })}
        </span>
      </div>
      <div className="mt-2 flex items-center justify-between text-xs">
        <span className="text-neutral-500">
          {new Date(u.joinedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
        </span>
        {u.qualifyingActionCompleted ? (
          <span className="text-success-600">{t('referrals.table.qualified')}</span>
        ) : (
          <span className="text-neutral-400">{t('referrals.table.pending')}</span>
        )}
      </div>
      <div className="mt-1 text-right">
        <p className="text-xs font-semibold text-neutral-900">+{u.xpEarned.toLocaleString()} XP</p>
        <p className="text-xs text-neutral-500">+{u.coinsEarned.toLocaleString()} 🪙</p>
      </div>
    </div>
  );
}

function ReferredUsersTable({ users }: { users: ReferredUser[] }) {
  const { t } = useTranslation();
  return (
    <div className="bg-white rounded-xl shadow-card mb-3">
      <div className="border-b border-neutral-100 px-4 py-3">
        <h2 className="text-sm font-semibold text-neutral-700">{t('referrals.table.title')}</h2>
      </div>
      {users.length === 0 ? (
        <div className="px-4 py-8 text-center text-sm text-neutral-500">{t('referrals.table.empty')}</div>
      ) : (
        users.map((u) => <ReferredUserRow key={u.userId} u={u} />)
      )}
    </div>
  );
}

function ReferralsPage() {
  const { t } = useTranslation();
  const { data, status } = useQuery({ queryKey: ['referrals'], queryFn: fetchReferrals });

  return (
    <div className="h-full overflow-y-auto bg-neutral-50 px-4 py-4">
      <h1 className="text-xl font-bold text-neutral-900 mb-4">{t('referrals.title')}</h1>

      {status === 'pending' && (
        <div className="py-8 text-center text-sm text-neutral-400">{t('common.loading', 'Loading…')}</div>
      )}

      {status === 'error' && (
        <div className="py-8 text-center text-sm text-neutral-500">{t('error.generic')}</div>
      )}

      {status === 'success' && (
        <>
          {data.stats.referralUrl && <ReferralLinkCard url={data.stats.referralUrl} />}
          <StatsGrid stats={data.stats} />
          <TwoTierExplainer />
          <ReferredUsersTable users={data.referredUsers} />
        </>
      )}
    </div>
  );
}

export const Route = createFileRoute('/referrals')({
  component: ReferralsPage,
});
