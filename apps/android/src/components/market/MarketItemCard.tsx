/**
 * apps/android/src/components/market/MarketItemCard.tsx
 *
 * Mirrors apps/web/components/market/MarketItemCard.tsx — one Market item,
 * grid or list layout, for both creator and platform items.
 */

import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useAuth } from '@/lib/auth/store';
import { apiClient } from '@/lib/api/client';
import { appendReferralCode } from '@zobia/shared/utils';
import { useMyReferralCode } from '@/lib/referral/useReferralCode';

export type MarketCategory = 'digital' | 'physical' | 'cosmetics_themes' | 'boosts_passes' | 'credits';

export interface MarketItem {
  id: string;
  kind: 'creator' | 'platform';
  category: MarketCategory;
  name: string;
  description: string | null;
  imageUrl: string | null;
  priceCoin: number | null;
  starsCost: number | null;
  creatorId: string | null;
  creatorUsername: string | null;
  rating: number | null;
  ratingCount: number;
  isSponsored: boolean;
  isAdminFeatured: boolean;
  referralEnabled: boolean;
  referralCommissionPct: number | null;
  href: string;
}

const CATEGORY_LABEL: Record<MarketCategory, string> = {
  digital: 'Digital',
  physical: 'Physical',
  cosmetics_themes: 'Cosmetics & Themes',
  boosts_passes: 'Boosts & Passes',
  credits: 'Credits',
};

function ReferralRow({ item }: { item: MarketItem }) {
  const { user } = useAuth();
  const { code: refCode } = useMyReferralCode();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  if (!user || !item.referralEnabled) return null;
  const label = item.category === 'physical'
    ? (item.referralCommissionPct ? `Earn ${item.referralCommissionPct}% commission` : null)
    : 'Earn a commission';
  if (!label) return null;

  const link = refCode ? appendReferralCode(item.href, refCode) : null;

  function toggle() {
    setOpen((prev) => !prev);
  }

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* no-op — no Clipboard plugin fallback, mirrors routes/referrals.tsx */ }
  }

  return (
    <div className="mt-1 text-[11px]">
      <button type="button" onClick={toggle} className="w-full rounded-lg border border-teal-200 bg-teal-50 dark:bg-teal-900/30 px-2 py-1 font-medium text-teal-700 dark:text-teal-300">
        💰 {label}
      </button>
      {open && (
        <div className="mt-1 flex items-center gap-1 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 p-1.5">
          {link ? (
            <>
              <span className="min-w-0 flex-1 truncate text-neutral-600 dark:text-neutral-400">{link}</span>
              <button type="button" onClick={copy} className="shrink-0 rounded bg-teal-600 px-1.5 py-0.5 text-white">{copied ? '✓' : '📋'}</button>
            </>
          ) : (
            <span className="text-neutral-500 dark:text-neutral-400">Loading…</span>
          )}
        </div>
      )}
    </div>
  );
}

/** Boosts are bought directly with Coins (no checkout flow needed) — see POST /economy/boosters. */
function BuyBoostButton({ item }: { item: MarketItem }) {
  const [state, setState] = useState<'idle' | 'buying' | 'done' | 'error'>('idle');

  async function buy() {
    if (!window.confirm(`Buy ${item.name} for ${item.priceCoin?.toLocaleString()} coins?`)) return;
    setState('buying');
    try {
      await apiClient.post('/economy/boosters', { boosterType: item.id });
      setState('done');
      setTimeout(() => setState('idle'), 3000);
    } catch {
      setState('error');
      setTimeout(() => setState('idle'), 3000);
    }
  }

  return (
    <button
      type="button"
      onClick={buy}
      disabled={state === 'buying'}
      className="mt-2 w-full rounded-xl bg-primary-600 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
    >
      {state === 'buying' ? 'Buying…' : state === 'done' ? 'Activated!' : state === 'error' ? 'Failed — try again' : 'Buy'}
    </button>
  );
}

export function MarketItemCard({ item, view }: { item: MarketItem; view: 'grid' | 'list' }) {
  const isBoost = item.kind === 'platform' && item.category === 'boosts_passes';
  const price = item.priceCoin != null ? `🪙 ${item.priceCoin.toLocaleString()}` : item.starsCost != null ? `⭐ ${item.starsCost.toLocaleString()}` : null;

  if (view === 'list') {
    const inner = (
      <>
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-neutral-100 dark:bg-neutral-800 text-xl">
          {item.imageUrl ? <img src={item.imageUrl} alt={item.name} className="h-11 w-11 rounded-lg object-cover" /> : '🛍️'}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">{item.name}</p>
          <p className="text-[11px] text-neutral-500 dark:text-neutral-400">{CATEGORY_LABEL[item.category]}</p>
        </div>
        {price && <span className="shrink-0 text-sm font-bold text-amber-600 dark:text-amber-300">{price}</span>}
      </>
    );
    if (isBoost) {
      return (
        <div className="flex flex-col gap-2 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 p-3 shadow-sm">
          <div className="flex items-center gap-3">{inner}</div>
          <BuyBoostButton item={item} />
        </div>
      );
    }
    return (
      <Link to={item.href} className="flex items-center gap-3 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 p-3 shadow-sm">
        {inner}
      </Link>
    );
  }

  const cardBody = (
    <>
      <div className="mb-2 flex h-24 items-center justify-center overflow-hidden rounded-xl bg-neutral-100 dark:bg-neutral-800 text-3xl">
        {item.imageUrl ? <img src={item.imageUrl} alt={item.name} className="h-full w-full object-cover" /> : '🛍️'}
      </div>
      <div className="mb-1 flex flex-wrap gap-1">
        {item.isSponsored && <span className="rounded-full bg-amber-100 dark:bg-amber-900/40 px-1.5 py-0.5 text-[9px] font-semibold text-amber-700 dark:text-amber-300">Sponsored</span>}
        {item.isAdminFeatured && <span className="rounded-full bg-blue-100 dark:bg-blue-900/40 px-1.5 py-0.5 text-[9px] font-semibold text-blue-700 dark:text-blue-300">Featured</span>}
      </div>
      <p className="truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100">{item.name}</p>
      {item.kind === 'creator' && item.rating != null && (
        <p className="text-[11px] text-amber-600 dark:text-amber-300">★ {item.rating.toFixed(1)} ({item.ratingCount})</p>
      )}
      {price && <p className="mt-1 text-base font-bold text-amber-600 dark:text-amber-300">{price}</p>}
    </>
  );

  return (
    <div className="flex flex-col rounded-2xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 p-3 shadow-sm">
      {isBoost ? <div className="flex flex-col">{cardBody}</div> : <Link to={item.href} className="flex flex-col">{cardBody}</Link>}
      {isBoost && <BuyBoostButton item={item} />}
      <ReferralRow item={item} />
    </div>
  );
}
