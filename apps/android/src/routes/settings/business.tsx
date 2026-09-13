/**
 * apps/android/src/routes/settings/business.tsx
 *
 * Business Account settings — Android mirror of
 * apps/web/app/(app)/settings/business/page.tsx (business verification +
 * info editing). Reuses the same read/write endpoints as web wherever
 * they're platform-agnostic:
 *   - GET    /api/business           (current account)
 *   - GET    /api/business/analytics (follower/room/earnings stats)
 *   - PATCH  /api/business           (edit name/type — plain DB update)
 *   - POST/DELETE /api/business/verify (request/cancel verification — plain
 *     DB status change, no payment involved)
 *
 * Creating an account and changing/renewing its tier are payment actions —
 * web does those via Paystack/DodoPayments checkout links (POST /api/business,
 * PATCH /api/business/tier, POST /api/business/renew), which Play Store
 * policy forbids on Android. Those route through
 * lib/payments/googlePlay.ts's purchaseBusinessTier() instead, which posts
 * the verified Play purchase to POST /api/business/iap/verify — the
 * Android-only endpoint that creates or upgrades/downgrades the account
 * once Google confirms the charge (see that file's header comment). A Play
 * subscription also renews itself automatically, so there's no separate
 * "Renew" action here the way there is on web's one-off Paystack charge.
 */

import { useCallback, useEffect, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';
import { BUSINESS_TIER_PRODUCTS, purchaseBusinessTier } from '@/lib/payments/googlePlay';

type BusinessType = 'retail' | 'service' | 'media' | 'other';
type VerificationStatus = 'unverified' | 'pending' | 'verified' | 'rejected';
type TierKey = 'starter' | 'growth' | 'enterprise';

interface BusinessAccount {
  id: string;
  business_name: string;
  business_type: BusinessType | null;
  tier: string;
  status: string;
  verification_status: VerificationStatus;
  current_period_ends_at: string | null;
}

interface Analytics {
  follower_count: number;
  total_rooms: number;
  total_room_members: number;
  total_earnings_kobo: number;
  broadcasts_sent: number;
  active_subscribers: number;
}

const BUSINESS_TYPES: { value: BusinessType; label: string }[] = [
  { value: 'retail', label: 'Retail' },
  { value: 'service', label: 'Service' },
  { value: 'media', label: 'Media & Content' },
  { value: 'other', label: 'Other' },
];

const TIER_ORDER: Record<TierKey, number> = { starter: 0, growth: 1, enterprise: 2 };

const VERIFICATION_BADGE: Record<VerificationStatus, { label: string; classes: string }> = {
  unverified: { label: 'Unverified', classes: 'bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400' },
  pending: { label: 'Pending Review', classes: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300' },
  verified: { label: 'Verified ✓', classes: 'bg-teal-100 dark:bg-teal-900/40 text-teal-700 dark:text-teal-300' },
  rejected: { label: 'Rejected', classes: 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300' },
};

function fmtKobo(kobo: number): string {
  if (kobo === 0) return '₦0';
  return `₦${(kobo / 100).toLocaleString('en-NG', { maximumFractionDigits: 0 })}`;
}

function BusinessPage() {
  const { t } = useTranslation();
  const [business, setBusiness] = useState<BusinessAccount | null>(null);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [businessName, setBusinessName] = useState('');
  const [businessType, setBusinessType] = useState<BusinessType>('retail');
  const [submitting, setSubmitting] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [tierBusy, setTierBusy] = useState<TierKey | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const loadBusiness = useCallback(async () => {
    try {
      const res = await apiClient.get<{ data: { business: BusinessAccount } }>('/business');
      const biz = res.data.data.business;
      setBusiness(biz);
      setBusinessName(biz.business_name);
      setBusinessType((biz.business_type as BusinessType) ?? 'retail');
    } catch {
      setBusiness(null);
      setEditing(true);
    }
  }, []);

  const loadAnalytics = useCallback(async () => {
    try {
      const res = await apiClient.get<{ data: { analytics: Analytics } }>('/business/analytics');
      setAnalytics(res.data.data.analytics);
    } catch { /* non-critical */ }
  }, []);

  useEffect(() => { (async () => { await loadBusiness(); setLoading(false); })(); }, [loadBusiness]);
  useEffect(() => { if (business) void loadAnalytics(); }, [business, loadAnalytics]);

  async function handleSave() {
    if (!business) return;
    setSubmitting(true);
    try {
      const res = await apiClient.patch<{ data?: { business: BusinessAccount } }>('/business', {
        business_name: businessName.trim(),
        business_type: businessType,
      });
      if (res.data.data?.business) setBusiness(res.data.data.business);
      setEditing(false);
      showToast(t('business.updateSuccess', 'Business info updated!'));
    } catch {
      showToast(t('business.error.generic', 'Something went wrong. Please try again.'), 'error');
    } finally {
      setSubmitting(false);
    }
  }

  /** Create the account, or change its tier, via Google Play Billing (Android IAP policy — see file header). */
  async function handleTierAction(tier: TierKey) {
    const product = BUSINESS_TIER_PRODUCTS.find((p) => p.tier === tier);
    if (!product) return;
    if (!business && !businessName.trim()) {
      showToast(t('business.error.nameRequired', 'Business name is required'), 'error');
      return;
    }
    setTierBusy(tier);
    try {
      const outcome = await purchaseBusinessTier(
        product.id,
        !business ? businessName.trim() : undefined,
        !business ? businessType : undefined
      );
      if (outcome.success) {
        showToast(t('business.updateSuccess', 'Business info updated!'));
        await loadBusiness();
      } else if (outcome.error) {
        showToast(outcome.error, 'error');
      }
    } finally {
      setTierBusy(null);
    }
  }

  async function handleVerificationRequest() {
    setVerifying(true);
    try {
      await apiClient.post('/business/verify');
      setBusiness((prev) => prev ? { ...prev, verification_status: 'pending' } : prev);
      showToast(t('business.verify.submitted', "Verification request submitted! We'll review it soon."));
    } catch {
      showToast(t('business.error.generic', 'Something went wrong. Please try again.'), 'error');
    } finally {
      setVerifying(false);
    }
  }

  async function handleCancelVerification() {
    setVerifying(true);
    try {
      await apiClient.delete('/business/verify');
      setBusiness((prev) => prev ? { ...prev, verification_status: 'unverified' } : prev);
      showToast(t('business.verify.cancelled', 'Verification request cancelled.'));
    } catch {
      showToast(t('business.error.generic', 'Something went wrong. Please try again.'), 'error');
    } finally {
      setVerifying(false);
    }
  }

  if (loading) {
    return <div className="flex h-full items-center justify-center text-sm text-neutral-400 dark:text-neutral-500">{t('action.loading', 'Loading…')}</div>;
  }

  const verStatus: VerificationStatus = business?.verification_status ?? 'unverified';
  const badge = VERIFICATION_BADGE[verStatus];
  const currentTierKey = (business?.tier?.toLowerCase() as TierKey) in TIER_ORDER ? (business!.tier.toLowerCase() as TierKey) : 'starter';

  return (
    <div className="h-full overflow-y-auto bg-neutral-50 dark:bg-neutral-800 px-4 py-4 space-y-3">
      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 rounded-xl px-4 py-3 text-sm font-medium text-white shadow-lg ${toast.type === 'success' ? 'bg-teal-600' : 'bg-red-600'}`}>
          {toast.msg}
        </div>
      )}

      {business && business.status === 'suspended' && (
        <div className="rounded-xl border border-red-200 bg-red-50 dark:bg-red-900/30 px-4 py-3 text-sm text-red-700 dark:text-red-300">
          {t('business.suspended', 'Your business account is suspended. Contact support for more information.')}
        </div>
      )}

      {/* Current info */}
      {business && !editing && (
        <div className="rounded-xl bg-white dark:bg-neutral-800 p-4 shadow-card">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h2 className="text-base font-bold text-neutral-900 dark:text-neutral-100">{business.business_name}</h2>
              {business.business_type && <p className="text-sm capitalize text-neutral-500 dark:text-neutral-400">{business.business_type}</p>}
            </div>
            <span className={`flex-shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${badge.classes}`}>{badge.label}</span>
          </div>

          <div className="mt-3 rounded-lg bg-neutral-50 dark:bg-neutral-800 p-3">
            <p className="text-xs font-semibold text-neutral-500 dark:text-neutral-400">{t('business.tier.label', 'Tier')}</p>
            <p className="mt-0.5 font-semibold capitalize text-neutral-900 dark:text-neutral-100">{business.tier}</p>
            {business.current_period_ends_at && (
              <p className="mt-0.5 text-xs text-neutral-400 dark:text-neutral-500">
                {t('business.tier.renewsEnds', 'Renews/ends')} {new Date(business.current_period_ends_at).toLocaleDateString()}
              </p>
            )}
          </div>

          {analytics && (
            <div className="mt-3 grid grid-cols-3 gap-2">
              {[
                { label: t('business.analytics.followers', 'Followers'), value: analytics.follower_count.toLocaleString() },
                { label: t('business.analytics.roomMembers', 'Room Members'), value: analytics.total_room_members.toLocaleString() },
                { label: t('business.analytics.subscribers', 'Active Subscribers'), value: analytics.active_subscribers.toLocaleString() },
                { label: t('business.analytics.rooms', 'Rooms'), value: analytics.total_rooms.toLocaleString() },
                { label: t('business.analytics.broadcasts', 'Broadcasts Sent'), value: analytics.broadcasts_sent.toLocaleString() },
                { label: t('business.analytics.earnings', 'Lifetime Earnings'), value: fmtKobo(analytics.total_earnings_kobo) },
              ].map(({ label, value }) => (
                <div key={label} className="rounded-lg bg-neutral-50 dark:bg-neutral-800 p-2 text-center">
                  <p className="text-xs font-semibold text-neutral-900 dark:text-neutral-100">{value}</p>
                  <p className="text-[10px] text-neutral-400 dark:text-neutral-500">{label}</p>
                </div>
              ))}
            </div>
          )}

          {verStatus === 'rejected' && (
            <div className="mt-3 rounded-lg bg-red-50 dark:bg-red-900/30 px-3 py-2 text-xs text-red-700 dark:text-red-300">
              {t('business.verify.rejected', 'Your verification was rejected. Update your business details and resubmit.')}
            </div>
          )}
          {verStatus === 'pending' && (
            <div className="mt-3 rounded-lg bg-amber-50 dark:bg-amber-900/30 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
              {t('business.verify.pending', "Your business is under review. We'll notify you once verified.")}
            </div>
          )}

          <div className="mt-3 flex gap-2">
            {(verStatus === 'unverified' || verStatus === 'rejected') && (
              <button
                onClick={() => void handleVerificationRequest()}
                disabled={verifying}
                className="flex-1 rounded-xl bg-teal-600 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
              >
                {verifying ? t('action.submitting', 'Submitting…') : t('business.verify.request', 'Request Verification')}
              </button>
            )}
            {verStatus === 'pending' && (
              <button
                onClick={() => void handleCancelVerification()}
                disabled={verifying}
                className="flex-1 rounded-xl border border-neutral-300 dark:border-neutral-600 py-2.5 text-sm font-semibold text-neutral-600 dark:text-neutral-400 disabled:opacity-60"
              >
                {verifying ? t('action.cancelling', 'Cancelling…') : t('business.verify.cancel', 'Cancel Request')}
              </button>
            )}
            <button
              onClick={() => setEditing(true)}
              className="flex-1 rounded-xl border border-neutral-300 dark:border-neutral-600 py-2.5 text-sm font-semibold text-neutral-700 dark:text-neutral-300"
            >
              {t('business.editInfo', 'Edit Info')}
            </button>
          </div>
        </div>
      )}

      {/* Tier picker */}
      {business && !editing && (
        <div className="rounded-xl bg-white dark:bg-neutral-800 p-4 shadow-card">
          <h3 className="mb-3 text-sm font-semibold text-neutral-900 dark:text-neutral-100">{t('business.tiers.title', 'Business Tiers')}</h3>
          <div className="space-y-2">
            {BUSINESS_TIER_PRODUCTS.map((product) => {
              const isCurrent = product.tier === currentTierKey;
              const isUpgrade = TIER_ORDER[product.tier] > TIER_ORDER[currentTierKey];
              return (
                <div key={product.id} className="flex items-center justify-between gap-3 rounded-lg border border-neutral-100 dark:border-neutral-800 p-3">
                  <div>
                    <p className="text-sm font-bold capitalize text-neutral-900 dark:text-neutral-100">{product.label}</p>
                    <p className="text-xs font-semibold text-neutral-500 dark:text-neutral-400">{product.price}</p>
                  </div>
                  {isCurrent ? (
                    <span className="rounded-full bg-blue-600 px-3 py-1 text-xs font-semibold text-white">{t('business.tier.active', 'Active Plan')}</span>
                  ) : (
                    <button
                      onClick={() => void handleTierAction(product.tier)}
                      disabled={tierBusy !== null}
                      className={`rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-60 ${isUpgrade ? 'bg-blue-600 text-white' : 'border border-neutral-300 dark:border-neutral-600 text-neutral-600 dark:text-neutral-400'}`}
                    >
                      {tierBusy === product.tier ? t('subscription.redirecting', 'Redirecting…') : isUpgrade ? t('business.tier.upgrade', 'Upgrade') : t('business.downgrade.button', 'Downgrade')}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Create / edit form */}
      {(!business || editing) && (
        <div className="rounded-xl bg-white dark:bg-neutral-800 p-4 shadow-card">
          <h3 className="mb-3 text-sm font-semibold text-neutral-900 dark:text-neutral-100">
            {business ? t('business.editTitle', 'Edit Business Account') : t('business.createTitle', 'Create Business Account')}
          </h3>

          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-semibold text-neutral-700 dark:text-neutral-300">{t('business.form.businessName', 'Business Name')}</label>
              <input
                type="text"
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                maxLength={100}
                placeholder="e.g. Acme Clothing"
                className="w-full rounded-lg border border-neutral-300 dark:border-neutral-600 bg-neutral-50 dark:bg-neutral-800 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-neutral-700 dark:text-neutral-300">{t('business.form.businessType', 'Business Type')}</label>
              <select
                value={businessType}
                onChange={(e) => setBusinessType(e.target.value as BusinessType)}
                className="w-full rounded-lg border border-neutral-300 dark:border-neutral-600 bg-neutral-50 dark:bg-neutral-800 px-3 py-2 text-sm"
              >
                {BUSINESS_TYPES.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
              </select>
            </div>

            {business ? (
              <div className="flex gap-2 pt-1">
                <button onClick={() => setEditing(false)} className="flex-1 rounded-xl border border-neutral-300 dark:border-neutral-600 py-2.5 text-sm font-semibold text-neutral-700 dark:text-neutral-300">
                  {t('action.cancel', 'Cancel')}
                </button>
                <button
                  onClick={() => void handleSave()}
                  disabled={submitting || !businessName.trim()}
                  className="flex-1 rounded-xl bg-blue-600 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {submitting ? t('action.saving', 'Saving…') : t('business.saveChanges', 'Save Changes')}
                </button>
              </div>
            ) : (
              <div className="space-y-2 pt-1">
                <p className="text-xs text-neutral-500 dark:text-neutral-400">
                  {t('business.createHint', "Fill in your business details, then pick a plan below — you'll be charged via Google Play.")}
                </p>
                {BUSINESS_TIER_PRODUCTS.map((product) => (
                  <button
                    key={product.id}
                    onClick={() => void handleTierAction(product.tier)}
                    disabled={tierBusy !== null || !businessName.trim()}
                    className="flex w-full items-center justify-between rounded-lg border border-neutral-200 dark:border-neutral-700 px-3 py-2.5 text-sm font-semibold text-neutral-900 dark:text-neutral-100 disabled:opacity-50"
                  >
                    <span>{product.label} — {product.price}</span>
                    <span>{tierBusy === product.tier ? '…' : '→'}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export const Route = createFileRoute('/settings/business')({
  component: BusinessPage,
});
