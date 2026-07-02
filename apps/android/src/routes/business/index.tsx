/**
 * apps/android/src/routes/business/index.tsx
 *
 * Business hub — mirrors apps/web/app/(app)/business/page.tsx. Paid
 * signup/upgrade opens Paystack/DodoPayments checkout in the external
 * in-app browser (same Browser.open pattern used for OAuth), never as an
 * in-app purchase UI — Google Play Billing is the only allowed in-app
 * purchase mechanism on Android (PRD §18).
 */

import { useState } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Browser } from '@capacitor/browser';
import { apiClient } from '@/lib/api/client';

interface BusinessAccount {
  id: string;
  business_name: string;
  tier: 'starter' | 'growth' | 'enterprise';
  verified: boolean;
  status: string;
  downgrade_to_tier: string | null;
  downgrade_effective_at: string | null;
}

const TIERS = [
  { key: 'starter', label: 'Starter', price: '₦5,000/mo' },
  { key: 'growth', label: 'Growth', price: '₦15,000/mo' },
  { key: 'enterprise', label: 'Enterprise', price: '₦50,000+/mo' },
] as const;

async function fetchBusiness(): Promise<BusinessAccount | null> {
  try {
    const { data } = await apiClient.get<{ business: BusinessAccount }>('/business');
    return data.business;
  } catch (err: unknown) {
    const status = (err as { response?: { status?: number } })?.response?.status;
    if (status === 404) return null;
    throw err;
  }
}

function BusinessPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data: account, status } = useQuery({ queryKey: ['business', 'me'], queryFn: fetchBusiness, staleTime: 60_000 });
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    setCreating(true);
    setError(null);
    try {
      const { data } = await apiClient.post<{ paymentUrl?: string }>('/business', { business_name: 'My Business' });
      if (data.paymentUrl) {
        await Browser.open({ url: data.paymentUrl, presentationStyle: 'popover' });
      }
      qc.invalidateQueries({ queryKey: ['business', 'me'] });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start signup');
    } finally {
      setCreating(false);
    }
  }

  if (status === 'pending') {
    return <div className="p-6 text-center text-neutral-400">{t('common.loading', 'Loading…')}</div>;
  }

  if (!account) {
    return (
      <div className="h-full overflow-y-auto bg-neutral-50 px-4 py-6">
        <h1 className="text-lg font-bold text-neutral-900 mb-2">{t('business.intro.title', 'Grow your brand on Zobia')}</h1>
        <p className="text-sm text-neutral-500 mb-4">
          {t('business.intro.subtitle', 'Business Accounts unlock a verified badge, broadcast tools, Business Pages you can post to, a Quest Marketplace, and analytics that grow with your plan.')}
        </p>
        <div className="space-y-2 mb-4">
          {TIERS.map((tier) => (
            <div key={tier.key} className="bg-white rounded-xl p-3 shadow-card flex items-center justify-between">
              <span className="font-semibold text-sm text-neutral-900">{tier.label}</span>
              <span className="text-xs text-neutral-500">{tier.price}</span>
            </div>
          ))}
        </div>
        {error && <p className="text-sm text-red-600 mb-3">{error}</p>}
        <button
          onClick={handleCreate}
          disabled={creating}
          className="w-full rounded-xl bg-primary-600 py-3 text-sm font-semibold text-white disabled:opacity-60"
        >
          {creating ? t('common.loading', 'Loading…') : t('business.intro.createButton', 'Create Business Account')}
        </button>
        <p className="mt-2 text-xs text-neutral-400 text-center">Opens secure checkout in your browser.</p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-neutral-50 px-4 py-6">
      <h1 className="text-lg font-bold text-neutral-900">{account.business_name}</h1>
      <div className="mt-1 flex flex-wrap gap-2">
        <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-semibold capitalize text-blue-700">{account.tier} tier</span>
        {account.verified && <span className="rounded-full bg-teal-100 px-2.5 py-0.5 text-xs font-semibold text-teal-700">Verified ✓</span>}
      </div>

      {account.downgrade_to_tier && account.downgrade_effective_at && (
        <div className="mt-3 rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
          Downgrading to {account.downgrade_to_tier} on {new Date(account.downgrade_effective_at).toLocaleDateString()}.
        </div>
      )}

      <div className="mt-4 space-y-2">
        <Link to="/business/pages" className="block bg-white rounded-xl p-4 shadow-card">
          <p className="font-semibold text-sm text-neutral-900">🏢 Business Pages</p>
          <p className="text-xs text-neutral-500 mt-0.5">Create and manage pages, post updates.</p>
        </Link>
        <Link to="/business/ads" className="block bg-white rounded-xl p-4 shadow-card">
          <p className="font-semibold text-sm text-neutral-900">📣 Advertising Panel</p>
          <p className="text-xs text-neutral-500 mt-0.5">Submit and track Sponsored Quests.</p>
        </Link>
      </div>

      <p className="mt-4 text-xs text-neutral-400 text-center">
        Manage tier, verification and full analytics on web/PWA under Settings → Business.
      </p>
    </div>
  );
}

export const Route = createFileRoute('/business/')({
  component: BusinessPage,
});
