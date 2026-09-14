/**
 * apps/android/src/routes/settings/subscription.tsx
 *
 * Subscription & Billing — Android had no equivalent of
 * apps/web/app/(app)/settings/subscription/page.tsx at all. Shows the same
 * plan/status data as web (read via the same GET /api/users/me and
 * GET /api/economy/subscriptions used there — no backend changes needed),
 * but routes the actual purchase through Google Play Billing instead of
 * linking out to Paystack/crypto checkout, per this project's policy
 * that Android must use Play Billing for any real purchase (PRD §18).
 *
 * Cancel is a plain DB status change (DELETE /api/economy/subscriptions/:id)
 * with no payment-processor involvement, so it's reused as-is from web.
 * There's no "downgrade to another paid plan" action here: web does that via
 * PUT /api/economy/subscriptions/:id (an immediate, no-repayment plan swap)
 * which assumes a Paystack-billed subscription; a Play-billed subscription
 * can't be swapped that way; switching plans on Android instead purchases
 * the new plan via Play Billing like any upgrade (Play cancels the old
 * entitlement itself once the new one is granted).
 */

import { useCallback, useEffect, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';
import { useCurrency } from '@/lib/hooks/useCurrency';
import {
  SUBSCRIPTION_PRODUCTS,
  ANNUAL_SUBSCRIPTION_PRODUCTS,
  purchaseSubscription,
  type SubscriptionProduct,
} from '@/lib/payments/googlePlay';

type PlanId = 'free' | 'plus' | 'pro' | 'max';
type BillingInterval = 'monthly' | 'annual';

const PLAN_ORDER: PlanId[] = ['free', 'plus', 'pro', 'max'];
function planRank(id: PlanId): number { return PLAN_ORDER.indexOf(id); }

const PLAN_BADGE: Record<PlanId, string> = {
  free: 'bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400',
  plus: 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300',
  pro: 'bg-teal-100 dark:bg-teal-900/40 text-teal-700 dark:text-teal-300',
  max: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300',
};

interface CurrentSubscription {
  id: string;
  plan: PlanId;
  status: string;
  currentPeriodEnd?: string | null;
  cancelledAt?: string | null;
}

interface SubscriptionsGetResponse {
  currentSubscription?: CurrentSubscription | null;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-NG', { year: 'numeric', month: 'long', day: 'numeric' });
}

function SubscriptionPage() {
  const { t } = useTranslation();
  const currency = useCurrency();
  const [plan, setPlan] = useState<PlanId>('free');
  const [sub, setSub] = useState<CurrentSubscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [interval, setIntervalPref] = useState<BillingInterval>('monthly');
  const [busy, setBusy] = useState<PlanId | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const load = useCallback(async () => {
    try {
      const [meRes, subRes] = await Promise.all([
        apiClient.get<{ user?: { plan?: string } }>('/users/me'),
        apiClient.get<SubscriptionsGetResponse>('/economy/subscriptions'),
      ]);
      const planId = (meRes.data.user?.plan ?? 'free') as PlanId;
      const current = subRes.data.currentSubscription;
      setPlan(planId);
      setSub(current && current.plan === planId ? current : null);
    } catch {
      setError(t('subscription.loadError', 'Failed to load subscription info'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { void load(); }, [load]);

  function productFor(targetPlan: 'plus' | 'pro' | 'max'): SubscriptionProduct | undefined {
    const list = interval === 'annual' ? ANNUAL_SUBSCRIPTION_PRODUCTS : SUBSCRIPTION_PRODUCTS;
    return list.find((p) => p.plan === targetPlan);
  }

  async function handleUpgrade(targetPlan: 'plus' | 'pro' | 'max') {
    const product = productFor(targetPlan);
    if (!product) return;
    setBusy(targetPlan);
    try {
      const outcome = await purchaseSubscription(product.id);
      if (outcome.success) {
        showToast(t('subscription.upgradedSuccess', { plan: targetPlan }));
        await load();
      } else if (outcome.error) {
        showToast(outcome.error, 'error');
      }
    } finally {
      setBusy(null);
    }
  }

  async function handleCancel() {
    if (!sub?.id) return;
    if (!window.confirm(t('subscription.cancelConfirm', "Are you sure you want to cancel your subscription? You'll keep your plan until the end of the billing period."))) return;
    setCancelling(true);
    try {
      await apiClient.delete(`/economy/subscriptions/${sub.id}`);
      showToast(t('subscription.cancelledSuccess', "Subscription cancelled. You'll retain access until the period ends."));
      await load();
    } catch {
      showToast(t('subscription.cancelFailed', 'Cancel failed'), 'error');
    } finally {
      setCancelling(false);
    }
  }

  if (loading) {
    return <div className="flex h-full items-center justify-center text-sm text-neutral-400 dark:text-neutral-500">{t('action.loading', 'Loading…')}</div>;
  }

  const currentRank = planRank(plan);
  const isPaid = plan !== 'free';
  const isCancelled = sub?.status === 'cancelled';

  return (
    <div className="h-full overflow-y-auto bg-neutral-50 dark:bg-neutral-800 px-4 py-4 space-y-3">
      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 rounded-xl px-4 py-3 text-sm font-medium text-white shadow-lg ${toast.type === 'success' ? 'bg-teal-600' : 'bg-red-600'}`}>
          {toast.msg}
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 dark:bg-red-900/30 px-4 py-3 text-sm text-red-700 dark:text-red-300">{error}</div>
      )}

      {/* Current plan */}
      <div className="rounded-xl bg-white dark:bg-neutral-800 p-4 shadow-card">
        <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">{t('subscription.currentPlan', 'Current Plan')}</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <span className={`rounded-full px-2.5 py-0.5 text-sm font-bold capitalize ${PLAN_BADGE[plan]}`}>{plan}</span>
          {isCancelled && sub?.currentPeriodEnd && (
            <span className="rounded-full bg-red-100 dark:bg-red-900/40 px-2 py-0.5 text-xs font-semibold text-red-600 dark:text-red-300">
              {t('subscription.cancels', { date: formatDate(sub.currentPeriodEnd) })}
            </span>
          )}
          {!isCancelled && isPaid && sub?.currentPeriodEnd && (
            <span className="text-xs text-neutral-500 dark:text-neutral-400">{t('subscription.renews', { date: formatDate(sub.currentPeriodEnd) })}</span>
          )}
        </div>
        {isPaid && !isCancelled && (
          <button
            onClick={() => void handleCancel()}
            disabled={cancelling}
            className="mt-3 w-full rounded-xl border border-red-300 py-2.5 text-sm font-semibold text-red-600 dark:text-red-300 disabled:opacity-60"
          >
            {cancelling ? t('subscription.cancelling', 'Cancelling…') : t('subscription.cancelSubscription', 'Cancel Subscription')}
          </button>
        )}
      </div>

      {/* Billing interval */}
      <div className="flex items-center justify-between gap-3 rounded-xl bg-white dark:bg-neutral-800 px-4 py-3 shadow-card">
        <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{t('subscription.billingPeriod', 'Billing Period')}</p>
        <div className="flex rounded-lg border border-neutral-200 dark:border-neutral-700 bg-neutral-100 dark:bg-neutral-800 p-1">
          {(['monthly', 'annual'] as BillingInterval[]).map((iv) => (
            <button
              key={iv}
              onClick={() => setIntervalPref(iv)}
              className={`rounded-md px-3 py-1 text-xs font-semibold ${interval === iv ? 'bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 shadow-sm' : 'text-neutral-500 dark:text-neutral-400'}`}
            >
              {t(`subscription.${iv}`, iv === 'monthly' ? 'Monthly' : 'Annual')}
            </button>
          ))}
        </div>
      </div>

      {/* Upgrade tiers */}
      <div className="space-y-2">
        {(['plus', 'pro', 'max'] as const).map((tierPlan) => {
          const product = productFor(tierPlan);
          const isCurrent = tierPlan === plan;
          const isUpgrade = planRank(tierPlan) > currentRank;
          return (
            <div key={tierPlan} className="flex items-center justify-between gap-3 rounded-xl bg-white dark:bg-neutral-800 p-4 shadow-card">
              <div className="min-w-0">
                <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-bold capitalize ${PLAN_BADGE[tierPlan]}`}>{tierPlan}</span>
                <p className="mt-1 text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                  {product?.monthlyPrice ?? '—'}{interval === 'monthly' ? t('subscription.perMonth', '/mo') : ''}
                </p>
                <p className="text-xs text-neutral-500 dark:text-neutral-400">
                  {product?.monthlyCoins ?? 0} {currency.softPlural.toLowerCase()}/mo
                </p>
              </div>
              {isCurrent ? (
                <span className="flex-shrink-0 rounded-full bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white">
                  {t('subscription.currentPlanBadge', 'Current Plan')}
                </span>
              ) : isUpgrade ? (
                <button
                  onClick={() => void handleUpgrade(tierPlan)}
                  disabled={busy !== null}
                  className="flex-shrink-0 rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-60"
                >
                  {busy === tierPlan ? t('subscription.redirecting', 'Redirecting…') : t('subscription.upgradeTo', { plan: tierPlan })}
                </button>
              ) : (
                <button
                  onClick={() => void handleUpgrade(tierPlan)}
                  disabled={busy !== null}
                  className="flex-shrink-0 rounded-xl border border-neutral-300 dark:border-neutral-600 px-4 py-2 text-xs font-semibold text-neutral-500 dark:text-neutral-400 disabled:opacity-60"
                >
                  {busy === tierPlan ? t('subscription.redirecting', 'Redirecting…') : t('subscription.switchTo', { plan: tierPlan })}
                </button>
              )}
            </div>
          );
        })}
      </div>

      <p className="pb-4 text-center text-xs text-neutral-400 dark:text-neutral-500">{t('subscription.finePrint', 'Prices are in Nigerian Naira (NGN). Subscriptions renew automatically and can be cancelled at any time. Annual plans are billed as a single payment.')}</p>
    </div>
  );
}

export const Route = createFileRoute('/settings/subscription')({
  component: SubscriptionPage,
});
