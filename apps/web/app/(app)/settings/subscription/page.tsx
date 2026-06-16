"use client";

/**
 * app/(app)/settings/subscription/page.tsx
 *
 * Subscription & Billing settings page (PRD §3 / §12).
 * Shows current plan, plan comparison table with monthly/annual toggle,
 * upgrade/manage buttons, and cancel subscription for paid plans.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { useCurrency } from "@/lib/hooks/useCurrency";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PlanId = "free" | "plus" | "pro" | "max";
type BillingInterval = "monthly" | "annual";

interface CurrentPlanData {
  plan: PlanId;
  subscription?: {
    interval?: BillingInterval;
    currentPeriodEnd?: string;
    cancelAtPeriodEnd?: boolean;
  } | null;
}

interface MeResponse {
  user?: { plan?: string } | null;
  plan?: string;
}

interface SubscriptionResponse {
  subscription?: {
    interval?: BillingInterval;
    current_period_end?: string;
    cancel_at_period_end?: boolean;
  } | null;
}

interface PlanFeature {
  text: string;
  included: boolean;
}

interface PlanDefinition {
  id: PlanId;
  name: string;
  monthlyPrice: number;    // NGN per month
  annualPrice: number;     // NGN per year (already discounted 10%)
  color: string;
  badgeClass: string;
  features: PlanFeature[];
}

// ---------------------------------------------------------------------------
// Plan definitions (PRD §3)
// ---------------------------------------------------------------------------

const PLANS: PlanDefinition[] = [
  {
    id: "free",
    name: "Free",
    monthlyPrice: 0,
    annualPrice: 0,
    color: "neutral",
    badgeClass: "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400",
    features: [
      { text: "Core social features", included: true },
      { text: "Daily quests", included: true },
      { text: "Guild membership", included: true },
      { text: "Basic leaderboard", included: true },
      { text: "Custom chat theme", included: false },
      { text: "Priority support", included: false },
      { text: "Creator monetisation", included: false },
      { text: "Advanced analytics", included: false },
    ],
  },
  {
    id: "plus",
    name: "Plus",
    monthlyPrice: 500,
    annualPrice: 5000, // 10 × ₦500 — 2 months free per PRD §3
    color: "blue",
    badgeClass: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
    features: [
      { text: "1.5× XP multiplier", included: true },
      { text: "Rewarded ads only", included: true },
      { text: "4 daily quests", included: true },
      { text: "50 monthly coin bonus", included: true },
      { text: "Custom chat themes", included: false },
      { text: "Priority support", included: false },
      { text: "3× XP multiplier", included: false },
      { text: "Full creator tools", included: false },
    ],
  },
  {
    id: "pro",
    name: "Pro",
    monthlyPrice: 1500,
    annualPrice: 15000, // 10 × ₦1,500 — 2 months free per PRD §3
    color: "teal",
    badgeClass: "bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-300",
    features: [
      { text: "3× XP multiplier", included: true },
      { text: "No ads", included: true },
      { text: "5 daily quests", included: true },
      { text: "200 monthly coin bonus", included: true },
      { text: "Custom chat themes", included: true },
      { text: "Priority support", included: true },
      { text: "Full creator tools", included: true },
      { text: "5× XP multiplier", included: false },
    ],
  },
  {
    id: "max",
    name: "Max",
    monthlyPrice: 3500, // PRD §3 — ₦3,500/month
    annualPrice: 35000, // 10 × ₦3,500 — 2 months free per PRD §3
    color: "amber",
    badgeClass: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
    features: [
      { text: "5× XP multiplier", included: true },
      { text: "No ads", included: true },
      { text: "6 daily quests", included: true },
      { text: "500 monthly coin bonus", included: true },
      { text: "Custom chat themes", included: true },
      { text: "Dedicated support", included: true },
      { text: "Full creator tools + boosts", included: true },
      { text: "Early feature access (2 weeks)", included: true },
    ],
  },
];

const PLAN_ORDER: PlanId[] = ["free", "plus", "pro", "max"];

function planRank(planId: PlanId): number {
  return PLAN_ORDER.indexOf(planId);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatPrice(amount: number): string {
  if (amount === 0) return "₦0";
  return `₦${amount.toLocaleString("en-NG")}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-NG", { year: "numeric", month: "long", day: "numeric" });
}

// ---------------------------------------------------------------------------
// Plan Card
// ---------------------------------------------------------------------------

interface PlanCardProps {
  plan: PlanDefinition;
  interval: BillingInterval;
  isCurrent: boolean;
  currentPlanRank: number;
  onUpgrade: (planId: PlanId) => void;
  onManage: () => void;
  upgrading: PlanId | null;
}

function PlanCard({ plan, interval, isCurrent, currentPlanRank, onUpgrade, onManage, upgrading }: PlanCardProps) {
  const { t } = useTranslation();
  const currency = useCurrency();
  const price = interval === "annual" ? plan.annualPrice : plan.monthlyPrice * 12;
  const displayMonthly = interval === "monthly" ? plan.monthlyPrice : Math.round(plan.annualPrice / 12);
  const isDowngrade = planRank(plan.id) < currentPlanRank;
  const isUpgrade = planRank(plan.id) > currentPlanRank;

  const cardBorderClass = isCurrent
    ? "border-blue-500 dark:border-blue-400 ring-2 ring-blue-500/30"
    : "border-neutral-200 dark:border-neutral-800";

  return (
    <div className={`relative flex flex-col rounded-xl border bg-white shadow-sm dark:bg-neutral-900 ${cardBorderClass}`}>
      {isCurrent && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2">
          <span className="rounded-full bg-blue-600 px-3 py-0.5 text-xs font-semibold text-white shadow">
            {t('subscription.currentPlanBadge')}
          </span>
        </div>
      )}

      <div className="p-5">
        <div className="mb-1 flex items-center gap-2">
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${plan.badgeClass}`}>
            {plan.name}
          </span>
        </div>

        <div className="mt-3">
          {plan.monthlyPrice === 0 ? (
            <p className="text-3xl font-extrabold text-neutral-900 dark:text-neutral-50">₦0</p>
          ) : (
            <>
              <p className="text-3xl font-extrabold text-neutral-900 dark:text-neutral-50">
                {formatPrice(displayMonthly)}
                <span className="ml-1 text-sm font-normal text-neutral-400">{t('subscription.perMonth')}</span>
              </p>
              {interval === "annual" && (
                <p className="mt-0.5 text-xs text-neutral-500">
                  {t('subscription.billedAnnually', { price: formatPrice(price) })}
                  <span className="ml-1.5 rounded-full bg-teal-100 px-1.5 py-0.5 text-xs font-semibold text-teal-700 dark:bg-teal-900 dark:text-teal-300">
                    {t('subscription.twoMonthsFree')}
                  </span>
                </p>
              )}
            </>
          )}
        </div>

        {/* Features list */}
        <ul className="mt-4 space-y-2">
          {plan.features.map((f) => (
            <li key={f.text} className="flex items-center gap-2 text-sm">
              {f.included ? (
                <svg className="h-4 w-4 shrink-0 text-teal-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                <svg className="h-4 w-4 shrink-0 text-neutral-300 dark:text-neutral-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              )}
              <span className={f.included ? "text-neutral-700 dark:text-neutral-300" : "text-neutral-400 dark:text-neutral-600"}>
                {f.text
                  .replace(/\bcoins\b/gi, currency.softPlural.toLowerCase())
                  .replace(/\bcoin\b/gi, currency.softSingular.toLowerCase())}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-auto p-5 pt-0">
        {isCurrent ? (
          <button
            onClick={onManage}
            className="w-full rounded-xl border border-neutral-300 py-2.5 text-sm font-semibold text-neutral-700 transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            {t('subscription.manage')}
          </button>
        ) : isUpgrade ? (
          <button
            onClick={() => onUpgrade(plan.id)}
            disabled={upgrading !== null}
            className="w-full rounded-xl bg-blue-600 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-60"
          >
            {upgrading === plan.id ? t('subscription.redirecting') : t('subscription.upgradeTo', { plan: plan.name })}
          </button>
        ) : isDowngrade ? (
          <button
            onClick={() => onUpgrade(plan.id)}
            disabled={upgrading !== null}
            className="w-full rounded-xl border border-neutral-300 py-2.5 text-sm font-semibold text-neutral-500 transition-colors hover:bg-neutral-50 disabled:opacity-60 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800"
          >
            {upgrading === plan.id ? t('subscription.redirecting') : t('subscription.switchTo', { plan: plan.name })}
          </button>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

/**
 * Subscription & Billing settings page.
 */
export default function SubscriptionPage() {
  const { t } = useTranslation();
  // Effects below only need the *current* t at fetch time, not on every
  // language change (which would otherwise force a needless refetch since
  // `t`'s identity changes when react-i18next switches languages).
  const tRef = useRef(t);
  useEffect(() => { tRef.current = t; }, [t]);
  const router = useRouter();
  const [planData, setPlanData] = useState<CurrentPlanData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [interval, setInterval] = useState<BillingInterval>("monthly");
  const [upgrading, setUpgrading] = useState<PlanId | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  const showToast = useCallback((msg: string, type: "success" | "error" = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const [meRes, subRes] = await Promise.all([
          fetch("/api/users/me", { credentials: "include" }),
          fetch("/api/economy/subscriptions", { credentials: "include" }),
        ]);
        if (meRes.status === 401) { router.push("/auth/login"); return; }
        if (!meRes.ok) throw new Error(tRef.current('subscription.loadError'));
        const meJson = (await meRes.json()) as MeResponse;
        const subJson = subRes.ok ? (await subRes.json()) as SubscriptionResponse : null;
        const rawUser = meJson.user ?? meJson;
        const planId = ((rawUser as { plan?: string }).plan ?? "free") as PlanId;
        const sub = subJson?.subscription;
        const data: CurrentPlanData = {
          plan: planId,
          subscription: sub ? {
            interval: sub.interval,
            currentPeriodEnd: sub.current_period_end,
            cancelAtPeriodEnd: sub.cancel_at_period_end,
          } : null,
        };
        setPlanData(data);
        if (data.subscription?.interval) {
          setInterval(data.subscription.interval);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    })();
  }, [router]);

  async function handleUpgrade(targetPlan: PlanId) {
    const currentPlanAtTime = (planData?.plan ?? "free") as PlanId;
    const isUpgrading = planRank(targetPlan) > planRank(currentPlanAtTime);

    setUpgrading(targetPlan);
    try {
      const res = await fetch("/api/economy/subscriptions", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: targetPlan, interval }),
      });
      if (!res.ok) {
        const d = (await res.json()) as { message?: string };
        throw new Error(d.message ?? t(isUpgrading ? 'subscription.upgradeFailed' : 'subscription.downgradeFailed'));
      }
      const d = (await res.json()) as { checkoutUrl?: string; redirectUrl?: string };
      const url = d.checkoutUrl ?? d.redirectUrl;
      if (url) {
        window.location.href = url;
      } else {
        showToast(t(isUpgrading ? 'subscription.upgradedSuccess' : 'subscription.downgradedSuccess', { plan: targetPlan }));
        // Refetch plan data
        const [meRes2, subRes2] = await Promise.all([
          fetch("/api/users/me", { credentials: "include" }),
          fetch("/api/economy/subscriptions", { credentials: "include" }),
        ]);
        if (meRes2.ok) {
          const meJson2 = (await meRes2.json()) as MeResponse;
          const subJson2 = subRes2.ok ? (await subRes2.json()) as SubscriptionResponse : null;
          const rawUser2 = meJson2.user ?? meJson2;
          const sub2 = subJson2?.subscription;
          setPlanData({
            plan: ((rawUser2 as { plan?: string }).plan ?? "free") as PlanId,
            subscription: sub2 ? { interval: sub2.interval, currentPeriodEnd: sub2.current_period_end, cancelAtPeriodEnd: sub2.cancel_at_period_end } : null,
          });
        }
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : t(isUpgrading ? 'subscription.upgradeFailed' : 'subscription.downgradeFailed'), "error");
    } finally {
      setUpgrading(null);
    }
  }

  async function handleCancel() {
    if (!confirm(t('subscription.cancelConfirm'))) return;
    setCancelling(true);
    try {
      const res = await fetch("/api/economy/subscriptions", {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        const d = (await res.json()) as { message?: string };
        throw new Error(d.message ?? t('subscription.cancelFailed'));
      }
      showToast(t('subscription.cancelledSuccess'));
      // Refetch
      const [meRes3, subRes3] = await Promise.all([
        fetch("/api/users/me", { credentials: "include" }),
        fetch("/api/economy/subscriptions", { credentials: "include" }),
      ]);
      if (meRes3.ok) {
        const meJson3 = (await meRes3.json()) as MeResponse;
        const subJson3 = subRes3.ok ? (await subRes3.json()) as SubscriptionResponse : null;
        const rawUser3 = meJson3.user ?? meJson3;
        const sub3 = subJson3?.subscription;
        setPlanData({
          plan: ((rawUser3 as { plan?: string }).plan ?? "free") as PlanId,
          subscription: sub3 ? { interval: sub3.interval, currentPeriodEnd: sub3.current_period_end, cancelAtPeriodEnd: sub3.cancel_at_period_end } : null,
        });
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : t('subscription.cancelFailed'), "error");
    } finally {
      setCancelling(false);
    }
  }

  async function handleIntervalToggle(newInterval: BillingInterval) {
    setInterval(newInterval);
    // Persist preference if user has an active subscription
    if (planData?.plan && planData.plan !== "free") {
      try {
        await fetch("/api/economy/subscriptions", {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ interval: newInterval }),
        });
      } catch {
        // Non-fatal — the toggle still updates local UI
      }
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-2xl space-y-4 p-4 sm:p-6">
        <div className="h-8 w-48 animate-pulse rounded bg-neutral-200 dark:bg-neutral-700" />
        <div className="h-12 w-64 animate-pulse rounded-xl bg-neutral-200 dark:bg-neutral-700" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-72 animate-pulse rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      </div>
    );
  }

  const currentPlan = (planData?.plan ?? "free") as PlanId;
  const subscription = planData?.subscription;
  const isPaidPlan = currentPlan !== "free";
  const isCancelled = subscription?.cancelAtPeriodEnd === true;
  const currentPeriodEnd = subscription?.currentPeriodEnd;
  const currentRank = planRank(currentPlan);

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6">
      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 rounded-xl px-4 py-3 text-sm font-medium text-white shadow-lg ${toast.type === "success" ? "bg-teal-600" : "bg-red-600"}`}>
          {toast.msg}
        </div>
      )}

      <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-50">{t('subscription.title')}</h1>

      {/* Current plan status banner */}
      <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500">{t('subscription.currentPlan')}</p>
            <div className="mt-1.5 flex items-center gap-2">
              <span className={`rounded-full px-2.5 py-0.5 text-sm font-bold capitalize ${PLANS.find((p) => p.id === currentPlan)?.badgeClass ?? ""}`}>
                {currentPlan}
              </span>
              {isCancelled && (
                <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-600 dark:bg-red-900 dark:text-red-300">
                  {t('subscription.cancels', { date: currentPeriodEnd ? formatDate(currentPeriodEnd) : '…' })}
                </span>
              )}
              {!isCancelled && currentPeriodEnd && isPaidPlan && (
                <span className="text-xs text-neutral-500">
                  {t('subscription.renews', { date: formatDate(currentPeriodEnd) })}
                </span>
              )}
            </div>
          </div>

          {isPaidPlan && !isCancelled && (
            <button
              onClick={handleCancel}
              disabled={cancelling}
              className="rounded-xl border border-red-300 px-4 py-2 text-sm font-semibold text-red-600 transition-colors hover:bg-red-50 disabled:opacity-60 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-950"
            >
              {cancelling ? t('subscription.cancelling') : t('subscription.cancelSubscription')}
            </button>
          )}
        </div>
      </div>

      {/* Billing interval toggle */}
      <div className="flex items-center justify-between gap-4 rounded-xl border border-neutral-200 bg-white px-5 py-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        <div>
          <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{t('subscription.billingPeriod')}</p>
          <p className="text-xs text-neutral-500">{t('subscription.billingHint')}</p>
        </div>
        <div className="flex rounded-xl border border-neutral-200 bg-neutral-100 p-1 dark:border-neutral-700 dark:bg-neutral-800">
          <button
            onClick={() => handleIntervalToggle("monthly")}
            className={`rounded-lg px-4 py-1.5 text-sm font-semibold transition-colors ${interval === "monthly" ? "bg-white text-neutral-900 shadow-sm dark:bg-neutral-900 dark:text-neutral-50" : "text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"}`}
          >
            {t('subscription.monthly')}
          </button>
          <button
            onClick={() => handleIntervalToggle("annual")}
            className={`flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-sm font-semibold transition-colors ${interval === "annual" ? "bg-white text-neutral-900 shadow-sm dark:bg-neutral-900 dark:text-neutral-50" : "text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"}`}
          >
            {t('subscription.annual')}
            <span className="rounded-full bg-teal-100 px-1.5 py-0.5 text-xs font-bold text-teal-700 dark:bg-teal-900 dark:text-teal-300">
              {t('subscription.monthsFree')}
            </span>
          </button>
        </div>
      </div>

      {/* Plan cards */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        {PLANS.map((plan) => (
          <PlanCard
            key={plan.id}
            plan={plan}
            interval={interval}
            isCurrent={plan.id === currentPlan}
            currentPlanRank={currentRank}
            onUpgrade={handleUpgrade}
            onManage={() => window.open("https://paystack.com/my/subscriptions", "_blank")}
            upgrading={upgrading}
          />
        ))}
      </div>

      {/* Fine print */}
      <p className="text-center text-xs text-neutral-400">{t('subscription.finePrint')}</p>
    </div>
  );
}
