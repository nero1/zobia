"use client";

/**
 * app/(app)/settings/business/page.tsx
 *
 * Business account settings page.
 * Shows current business info (if exists) or an onboarding form.
 * Submits via POST (create) or PATCH (update) to /api/business.
 * Loads real analytics from /api/business/analytics.
 * Verification requests via /api/business/verify.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTranslation } from "react-i18next";
import { translateApiError } from "@/lib/i18n/apiErrors";

// ---------------------------------------------------------------------------
// BusinessTierCard
// ---------------------------------------------------------------------------

type TierKey = "starter" | "growth" | "enterprise";

const TIERS: { key: TierKey; label: string; price: string }[] = [
  { key: "starter", label: "Starter", price: "₦5,000/mo" },
  { key: "growth", label: "Growth", price: "₦15,000/mo" },
  { key: "enterprise", label: "Enterprise", price: "₦50,000+/mo" },
];

const TIER_ORDER: Record<TierKey, number> = { starter: 0, growth: 1, enterprise: 2 };

const FEATURES: { label: string; tiers: Record<TierKey, boolean> }[] = [
  { label: "Verified business badge", tiers: { starter: true, growth: true, enterprise: true } },
  { label: "Broadcast capability",    tiers: { starter: true, growth: true, enterprise: true } },
  { label: "Basic analytics",         tiers: { starter: true, growth: true, enterprise: true } },
  { label: "Quest Marketplace",       tiers: { starter: false, growth: true, enterprise: true } },
  { label: "Room promotion credits",  tiers: { starter: false, growth: true, enterprise: true } },
  { label: "Custom Room theming",     tiers: { starter: false, growth: false, enterprise: true } },
  { label: "API access",              tiers: { starter: false, growth: false, enterprise: true } },
  { label: "Dedicated account manager", tiers: { starter: false, growth: false, enterprise: true } },
];

function BusinessTierCard({
  currentTier,
  downgradeToTier,
  downgradeEffectiveAt,
  onUpgraded,
  onDowngradeChanged,
}: {
  currentTier: string;
  downgradeToTier: string | null;
  downgradeEffectiveAt: string | null;
  onUpgraded: (tier: TierKey) => void;
  onDowngradeChanged: (tier: TierKey | null, effectiveAt: string | null) => void;
}) {
  const { t } = useTranslation();
  const [upgrading, setUpgrading] = useState<TierKey | null>(null);
  const [upgradeError, setUpgradeError] = useState<string | null>(null);
  const [pendingConflict, setPendingConflict] = useState<{ expiresAt: string | null } | null>(null);
  const [cancellingPending, setCancellingPending] = useState(false);

  const current = (currentTier.toLowerCase() as TierKey) in TIER_ORDER
    ? (currentTier.toLowerCase() as TierKey)
    : "starter";

  async function changeTier(tier: TierKey) {
    setUpgrading(tier);
    setUpgradeError(null);
    setPendingConflict(null);
    try {
      const res = await fetch("/api/business/tier", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier }),
      });
      const body = await res.json() as {
        success?: boolean;
        data?: { paymentUrl?: string; downgradeToTier?: string; downgradeEffectiveAt?: string; downgradeCancelled?: boolean };
        error?: { message?: string; code?: string; params?: { expiresAt?: string | null } };
      };
      if (!res.ok) {
        const err = new Error(body.error?.message ?? "Update failed") as Error & { code?: string | null };
        err.code = body.error?.code ?? null;
        if (err.code === "UPGRADE_ALREADY_PENDING") {
          setPendingConflict({ expiresAt: body.error?.params?.expiresAt ?? null });
        }
        throw err;
      }
      if (body.data?.paymentUrl) {
        window.location.href = body.data.paymentUrl;
      } else if (body.data?.downgradeCancelled) {
        onDowngradeChanged(null, null);
      } else if (body.data?.downgradeToTier) {
        onDowngradeChanged(body.data.downgradeToTier as TierKey, body.data.downgradeEffectiveAt ?? null);
      } else {
        onUpgraded(tier);
      }
    } catch (e) {
      const err = e as Error & { code?: string | null };
      setUpgradeError(e instanceof Error ? translateApiError(t, err.code, err.message || "Update failed") : "Update failed");
    } finally {
      setUpgrading(null);
    }
  }

  async function cancelPending() {
    setCancellingPending(true);
    try {
      const res = await fetch("/api/business/pending", { method: "DELETE", credentials: "include" });
      if (res.ok) {
        setPendingConflict(null);
        setUpgradeError(null);
      }
    } finally {
      setCancellingPending(false);
    }
  }

  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
      <h2 className="mb-4 text-base font-semibold text-neutral-900 dark:text-neutral-100">
        Business Tiers
      </h2>

      {downgradeToTier && downgradeEffectiveAt && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
          <span>
            Downgrading to <span className="font-semibold capitalize">{downgradeToTier}</span> on{" "}
            {new Date(downgradeEffectiveAt).toLocaleDateString()}. Pages/quests beyond that tier&apos;s limits deactivate then.
          </span>
          <button
            onClick={() => changeTier(current)}
            disabled={upgrading !== null}
            className="flex-shrink-0 rounded-lg border border-amber-400 px-2.5 py-1 text-xs font-semibold text-amber-800 hover:bg-amber-100 disabled:opacity-50 dark:text-amber-300 dark:hover:bg-amber-900/40"
          >
            Cancel
          </button>
        </div>
      )}

      {upgradeError && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          <p>{upgradeError}</p>
          {pendingConflict && (
            <>
              {pendingConflict.expiresAt && (
                <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                  Expires at {new Date(pendingConflict.expiresAt).toLocaleTimeString()}.
                </p>
              )}
              <button
                onClick={cancelPending}
                disabled={cancellingPending}
                className="mt-2 rounded-full border border-red-400 px-3 py-1 text-xs font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50 dark:text-red-300 dark:hover:bg-red-900/40"
              >
                {cancellingPending ? "Cancelling…" : "Cancel Pending Transaction"}
              </button>
            </>
          )}
        </div>
      )}

      <div className="grid grid-cols-3 gap-3">
        {TIERS.map(({ key, label, price }) => {
          const isCurrent = key === current;
          const isUpgradable = TIER_ORDER[key] > TIER_ORDER[current];
          const isEnterprise = key === "enterprise";

          return (
            <div
              key={key}
              className={`flex flex-col rounded-xl border p-3 ${
                isCurrent
                  ? "border-blue-500 bg-blue-50 dark:bg-blue-950/30"
                  : "border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-800/50"
              }`}
            >
              <div className="mb-2">
                <div className="flex items-center justify-between gap-1">
                  <p className="text-sm font-bold text-neutral-900 dark:text-neutral-100">{label}</p>
                  {isCurrent && (
                    <span className="rounded-full bg-blue-600 px-2 py-0.5 text-[10px] font-semibold text-white">
                      Current
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-xs font-semibold text-neutral-500">{price}</p>
              </div>

              <ul className="mb-3 flex-1 space-y-1.5">
                {FEATURES.map(({ label: feat, tiers }) => {
                  const included = tiers[key];
                  return (
                    <li key={feat} className="flex items-start gap-1.5 text-xs">
                      {included ? (
                        <span className="mt-px font-bold text-teal-600">✓</span>
                      ) : (
                        <span className="mt-px font-bold text-neutral-300 dark:text-neutral-600">✗</span>
                      )}
                      <span className={included ? "text-neutral-700 dark:text-neutral-300" : "text-neutral-400 dark:text-neutral-600"}>
                        {feat}
                      </span>
                    </li>
                  );
                })}
              </ul>

              {isCurrent ? (
                <div className="rounded-xl border border-blue-400 py-2 text-center text-xs font-semibold text-blue-600 dark:text-blue-400">
                  Active Plan
                </div>
              ) : isUpgradable ? (
                isEnterprise ? (
                  <a
                    href="mailto:sales@zobia.app?subject=Enterprise%20Plan%20Enquiry"
                    className="block rounded-xl bg-neutral-900 py-2 text-center text-xs font-semibold text-white hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
                  >
                    Contact Us
                  </a>
                ) : (
                  <button
                    onClick={() => changeTier(key)}
                    disabled={upgrading === key}
                    className="rounded-xl bg-blue-600 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
                  >
                    {upgrading === key ? "Redirecting…" : "Upgrade"}
                  </button>
                )
              ) : (
                <button
                  onClick={() => changeTier(key)}
                  disabled={upgrading === key || downgradeToTier === key}
                  className="rounded-xl border border-neutral-300 py-2 text-xs font-semibold text-neutral-600 hover:bg-neutral-100 disabled:opacity-60 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800"
                >
                  {upgrading === key ? "…" : downgradeToTier === key ? "Downgrade scheduled" : "Downgrade"}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type BusinessType = "retail" | "service" | "media" | "other";
type VerificationStatus = "unverified" | "pending" | "verified" | "rejected";

interface BusinessAccount {
  id: string;
  user_id: string;
  business_name: string;
  business_type: BusinessType | null;
  tier: string;
  verified: boolean;
  status: string;
  verification_status: VerificationStatus;
  downgrade_to_tier: string | null;
  downgrade_effective_at: string | null;
  current_period_ends_at: string | null;
  created_at: string;
}

interface Analytics {
  follower_count: number;
  total_rooms: number;
  total_room_members: number;
  total_earnings_kobo: number;
  broadcasts_sent: number;
  active_subscribers: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BUSINESS_TYPES: { value: BusinessType; label: string }[] = [
  { value: "retail", label: "Retail" },
  { value: "service", label: "Service" },
  { value: "media", label: "Media & Content" },
  { value: "other", label: "Other" },
];

const VERIFICATION_BADGE: Record<VerificationStatus, { label: string; classes: string }> = {
  unverified: { label: "Unverified", classes: "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400" },
  pending: { label: "Pending Review", classes: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" },
  verified: { label: "Verified ✓", classes: "bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300" },
  rejected: { label: "Rejected", classes: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300" },
};

function fmtKobo(kobo: number) {
  if (kobo === 0) return "₦0";
  return `₦${(kobo / 100).toLocaleString("en-NG", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function BusinessSettingsPage() {
  const { t } = useTranslation();
  const searchParams = useSearchParams();
  const preselectedTier = searchParams.get("tier");
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);
  const [business, setBusiness] = useState<BusinessAccount | null>(null);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  const [businessName, setBusinessName] = useState("");
  const [businessType, setBusinessType] = useState<BusinessType>("retail");
  const [editing, setEditing] = useState(false);
  const [pendingConflict, setPendingConflict] = useState<{ expiresAt: string | null } | null>(null);
  const [cancellingPending, setCancellingPending] = useState(false);
  const [renewing, setRenewing] = useState(false);

  const showToast = useCallback((msg: string, type: "success" | "error" = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }, []);

  const loadBusiness = useCallback(async () => {
    try {
      const res = await fetch("/api/business", { credentials: "include" });
      if (res.status === 401) { window.location.href = "/auth/login"; return; }
      if (res.status === 404) {
        setBusiness(null);
        setEditing(true);
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: { code?: string; message?: string } };
        const err = new Error(body.error?.message ?? "Failed to load business info") as Error & { code?: string | null };
        err.code = body.error?.code ?? null;
        throw err;
      }
      const json = await res.json() as { success: boolean; data: { business: BusinessAccount } };
      const biz = json.data.business;
      setBusiness(biz);
      setBusinessName(biz.business_name);
      setBusinessType((biz.business_type as BusinessType) ?? "retail");
    } catch (e) {
      const err = e as Error & { code?: string | null };
      setError(e instanceof Error ? translateApiError(tRef.current, err.code, err.message || "Unknown error") : "Unknown error");
    }
  }, []);

  const loadAnalytics = useCallback(async () => {
    try {
      const res = await fetch("/api/business/analytics", { credentials: "include" });
      if (res.ok) {
        const json = await res.json() as { success: boolean; data: { analytics: Analytics } };
        setAnalytics(json.data.analytics);
      }
    } catch {
      // Analytics are non-critical; fail silently
    }
  }, []);

  useEffect(() => {
    (async () => {
      await loadBusiness();
      setLoading(false);
    })();
  }, [loadBusiness]);

  useEffect(() => {
    if (business) loadAnalytics();
  }, [business, loadAnalytics]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!business) return; // create path uses the per-tier buttons below (handleCreate)
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/business", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ business_name: businessName.trim(), business_type: businessType }),
      });
      const json = await res.json() as { success: boolean; data?: { business: BusinessAccount }; error?: { message?: string; code?: string } };
      if (!res.ok) {
        const err = new Error(json.error?.message ?? "Failed to save") as Error & { code?: string | null };
        err.code = json.error?.code ?? null;
        throw err;
      }
      if (json.data?.business) {
        setBusiness(json.data.business);
      }
      setEditing(false);
      showToast("Business info updated!");
    } catch (e) {
      const err = e as Error & { code?: string | null };
      setError(e instanceof Error ? translateApiError(t, err.code, err.message || "Save failed") : "Save failed");
    } finally {
      setSubmitting(false);
    }
  }

  /** Create a new Business account on the chosen tier (PRD §17 — every tier is choosable at signup, not just Starter). */
  async function handleCreate(tier: TierKey) {
    if (!businessName.trim()) {
      setError("Enter a business name to continue.");
      return;
    }
    setSubmitting(true);
    setError(null);
    setPendingConflict(null);
    try {
      const res = await fetch("/api/business", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ business_name: businessName.trim(), business_type: businessType, tier }),
      });
      const json = await res.json() as {
        success: boolean;
        data?: { paymentUrl?: string };
        error?: { message?: string; code?: string; params?: { expiresAt?: string | null } };
      };
      if (!res.ok) {
        const err = new Error(json.error?.message ?? "Failed to start signup") as Error & { code?: string | null };
        err.code = json.error?.code ?? null;
        if (err.code === "SIGNUP_ALREADY_PENDING") {
          setPendingConflict({ expiresAt: json.error?.params?.expiresAt ?? null });
        }
        throw err;
      }
      // Business account creation is a paid tier (PRD §17) — redirect to checkout.
      // The business_accounts row is only created once the webhook fires.
      if (json.data?.paymentUrl) {
        window.location.href = json.data.paymentUrl;
        return;
      }
    } catch (e) {
      const err = e as Error & { code?: string | null };
      setError(e instanceof Error ? translateApiError(t, err.code, err.message || "Failed to start signup") : "Failed to start signup");
    } finally {
      setSubmitting(false);
    }
  }

  /** Cancel an abandoned signup/upgrade payment so the user can retry immediately (payment edge case). */
  async function handleCancelPending() {
    setCancellingPending(true);
    try {
      const res = await fetch("/api/business/pending", { method: "DELETE", credentials: "include" });
      if (res.ok) {
        setPendingConflict(null);
        setError(null);
        showToast("Pending transaction cancelled. You can try again now.");
      } else {
        showToast("Could not cancel the pending transaction. Try again.", "error");
      }
    } finally {
      setCancellingPending(false);
    }
  }

  async function handleVerificationRequest() {
    setVerifying(true);
    try {
      const res = await fetch("/api/business/verify", {
        method: "POST",
        credentials: "include",
      });
      const json = await res.json() as { success: boolean; data?: { verification_status: string }; error?: { message?: string; code?: string } };
      if (!res.ok) {
        const err = new Error(json.error?.message ?? "Request failed") as Error & { code?: string | null };
        err.code = json.error?.code ?? null;
        throw err;
      }
      setBusiness((prev) => prev ? { ...prev, verification_status: "pending" } : prev);
      showToast("Verification request submitted! We'll review it soon.");
    } catch (e) {
      const err = e as Error & { code?: string | null };
      showToast(e instanceof Error ? translateApiError(t, err.code, err.message || "Request failed") : "Request failed", "error");
    } finally {
      setVerifying(false);
    }
  }

  async function handleCancelVerification() {
    setVerifying(true);
    try {
      const res = await fetch("/api/business/verify", {
        method: "DELETE",
        credentials: "include",
      });
      const json = await res.json() as { success: boolean; error?: { message?: string; code?: string } };
      if (!res.ok) {
        const err = new Error(json.error?.message ?? "Cancel failed") as Error & { code?: string | null };
        err.code = json.error?.code ?? null;
        throw err;
      }
      setBusiness((prev) => prev ? { ...prev, verification_status: "unverified" } : prev);
      showToast("Verification request cancelled.");
    } catch (e) {
      const err = e as Error & { code?: string | null };
      showToast(e instanceof Error ? translateApiError(t, err.code, err.message || "Cancel failed") : "Cancel failed", "error");
    } finally {
      setVerifying(false);
    }
  }

  async function handleRenew() {
    setRenewing(true);
    setError(null);
    setPendingConflict(null);
    try {
      const res = await fetch("/api/business/renew", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const json = await res.json() as {
        success: boolean;
        data?: { paymentUrl?: string };
        error?: { message?: string; code?: string; params?: { expiresAt?: string | null } };
      };
      if (!res.ok) {
        const err = new Error(json.error?.message ?? "Failed to start renewal") as Error & { code?: string | null };
        err.code = json.error?.code ?? null;
        if (err.code === "RENEWAL_ALREADY_PENDING") {
          setPendingConflict({ expiresAt: json.error?.params?.expiresAt ?? null });
        }
        throw err;
      }
      if (json.data?.paymentUrl) {
        window.location.href = json.data.paymentUrl;
        return;
      }
    } catch (e) {
      const err = e as Error & { code?: string | null };
      setError(e instanceof Error ? translateApiError(t, err.code, err.message || "Failed to start renewal") : "Failed to start renewal");
    } finally {
      setRenewing(false);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-lg space-y-5 p-4 sm:p-6">
        <div className="h-8 w-56 animate-pulse rounded bg-neutral-200 dark:bg-neutral-700" />
        <div className="h-64 animate-pulse rounded-2xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900" />
      </div>
    );
  }

  const verStatus: VerificationStatus = business?.verification_status ?? "unverified";
  const badge = VERIFICATION_BADGE[verStatus];

  return (
    <div className="mx-auto max-w-lg space-y-6 p-4 sm:p-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/settings" className="text-sm text-neutral-500 hover:underline">← Settings</Link>
        <span className="text-neutral-300">/</span>
        <h1 className="text-xl font-bold text-neutral-900 dark:text-neutral-50">Business Account</h1>
      </div>

      {/* Toast */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 rounded-xl px-4 py-3 text-sm font-medium text-white shadow-lg ${
            toast.type === "success" ? "bg-teal-600" : "bg-red-600"
          }`}
        >
          {toast.msg}
        </div>
      )}

      {/* Suspended notice (admin moderation action) */}
      {business && business.status === "suspended" && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          Your business account is suspended. Contact support for more information.
        </div>
      )}

      {/* Billing lapsed / in grace period — renewal is a manual action since checkout is a one-off charge, not a recurring subscription. */}
      {business && (business.status === "grace" || business.status === "lapsed") && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
          <span>
            {business.status === "lapsed"
              ? "Your business account's billing period has lapsed. Renew to restore full access."
              : "Your business account's billing period has ended and is now in its grace period. Renew to avoid losing access."}
          </span>
          <button
            onClick={handleRenew}
            disabled={renewing}
            className="flex-shrink-0 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
          >
            {renewing ? "Redirecting…" : "Renew Now"}
          </button>
        </div>
      )}

      {/* Current info card */}
      {business && !editing && (
        <div className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
          <div className="mb-4 flex items-start justify-between">
            <div>
              <h2 className="text-lg font-bold text-neutral-900 dark:text-neutral-100">{business.business_name}</h2>
              {business.business_type && (
                <p className="text-sm text-neutral-500 capitalize">{business.business_type}</p>
              )}
            </div>
            <span className={`rounded-full px-3 py-1 text-xs font-semibold ${badge.classes}`}>
              {badge.label}
            </span>
          </div>

          {/* Tier */}
          <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-neutral-100 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-800/50">
            <div>
              <p className="text-xs font-semibold text-neutral-500">Tier</p>
              <p className="mt-0.5 font-semibold capitalize text-neutral-900 dark:text-neutral-100">{business.tier}</p>
              {business.current_period_ends_at && business.status === "active" && (
                <p className="mt-0.5 text-xs text-neutral-400">
                  Renews/ends {new Date(business.current_period_ends_at).toLocaleDateString()}
                </p>
              )}
            </div>
            {business.status === "active" && business.current_period_ends_at &&
              Math.ceil((new Date(business.current_period_ends_at).getTime() - Date.now()) / (24 * 60 * 60 * 1000)) <= 14 && (
                <button
                  onClick={handleRenew}
                  disabled={renewing}
                  className="flex-shrink-0 rounded-lg border border-blue-400 px-3 py-1.5 text-xs font-semibold text-blue-600 hover:bg-blue-50 disabled:opacity-50 dark:text-blue-400 dark:hover:bg-blue-950/40"
                >
                  {renewing ? "Redirecting…" : "Renew Early"}
                </button>
              )}
          </div>

          {/* Analytics */}
          {analytics && (
            <div className="mb-4 grid grid-cols-3 gap-2">
              {[
                { label: "Followers", value: analytics.follower_count.toLocaleString() },
                { label: "Room Members", value: analytics.total_room_members.toLocaleString() },
                { label: "Subscribers", value: analytics.active_subscribers.toLocaleString() },
                { label: "Rooms", value: analytics.total_rooms.toLocaleString() },
                { label: "Broadcasts", value: analytics.broadcasts_sent.toLocaleString() },
                { label: "Earnings", value: fmtKobo(analytics.total_earnings_kobo) },
              ].map(({ label, value }) => (
                <div key={label} className="rounded-xl border border-neutral-100 bg-neutral-50 p-2.5 text-center dark:border-neutral-800 dark:bg-neutral-800/50">
                  <p className="text-xs font-semibold text-neutral-900 dark:text-neutral-100">{value}</p>
                  <p className="text-[10px] text-neutral-400">{label}</p>
                </div>
              ))}
            </div>
          )}

          {/* Verification workflow */}
          {verStatus === "rejected" && (
            <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
              Your verification was rejected. Update your business details and resubmit.
            </div>
          )}
          {verStatus === "pending" && (
            <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
              Your business is under review. We&apos;ll notify you once verified.
            </div>
          )}

          <div className="flex gap-2">
            {(verStatus === "unverified" || verStatus === "rejected") && (
              <button
                onClick={handleVerificationRequest}
                disabled={verifying}
                className="flex-1 rounded-xl bg-teal-600 py-2.5 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-60"
              >
                {verifying ? "Submitting…" : "Request Verification"}
              </button>
            )}
            {verStatus === "pending" && (
              <button
                onClick={handleCancelVerification}
                disabled={verifying}
                className="flex-1 rounded-xl border border-neutral-300 py-2.5 text-sm font-semibold text-neutral-600 hover:bg-neutral-50 disabled:opacity-60 dark:border-neutral-700 dark:text-neutral-400"
              >
                {verifying ? "Cancelling…" : "Cancel Request"}
              </button>
            )}
            <button
              onClick={() => setEditing(true)}
              className="flex-1 rounded-xl border border-neutral-300 py-2.5 text-sm font-semibold text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              Edit Info
            </button>
          </div>
        </div>
      )}

      {/* Tier comparison */}
      {business && !editing && (
        <BusinessTierCard
          currentTier={business.tier}
          downgradeToTier={business.downgrade_to_tier}
          downgradeEffectiveAt={business.downgrade_effective_at}
          onUpgraded={(tier) => setBusiness((prev) => prev ? { ...prev, tier, downgrade_to_tier: null, downgrade_effective_at: null } : prev)}
          onDowngradeChanged={(tier, effectiveAt) => setBusiness((prev) => prev ? { ...prev, downgrade_to_tier: tier, downgrade_effective_at: effectiveAt } : prev)}
        />
      )}

      {/* Create / Edit form */}
      {(!business || editing) && (
        <div className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
          <h2 className="mb-1 text-base font-semibold text-neutral-900 dark:text-neutral-100">
            {business ? "Edit Business Info" : "Create Business Account"}
          </h2>
          {!business && (
            <p className="mb-4 text-sm text-neutral-500 dark:text-neutral-400">
              Fill in your business details, then pick a plan below — you&apos;ll be redirected to checkout to complete payment.
            </p>
          )}

          {error && (
            <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
              <p>{error}</p>
              {pendingConflict && (
                <>
                  {pendingConflict.expiresAt && (
                    <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                      Expires at {new Date(pendingConflict.expiresAt).toLocaleTimeString()}.
                    </p>
                  )}
                  <button
                    onClick={handleCancelPending}
                    disabled={cancellingPending}
                    className="mt-2 rounded-full border border-red-400 px-3 py-1 text-xs font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50 dark:text-red-300 dark:hover:bg-red-900/40"
                  >
                    {cancellingPending ? "Cancelling…" : "Cancel Pending Transaction"}
                  </button>
                </>
              )}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-semibold text-neutral-700 dark:text-neutral-300">
                Business Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                placeholder="e.g. Acme Clothing"
                required
                maxLength={100}
                className="w-full rounded-xl border border-neutral-300 bg-neutral-50 px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-semibold text-neutral-700 dark:text-neutral-300">
                Business Type <span className="text-red-500">*</span>
              </label>
              <select
                value={businessType}
                onChange={(e) => setBusinessType(e.target.value as BusinessType)}
                required
                className="w-full rounded-xl border border-neutral-300 bg-neutral-50 px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100"
              >
                {BUSINESS_TYPES.map(({ value, label }) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>

            {business ? (
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setEditing(false)}
                  className="flex-1 rounded-xl border border-neutral-300 py-2.5 text-sm font-semibold text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting || !businessName.trim()}
                  className="flex-1 rounded-xl bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
                >
                  {submitting ? "Saving…" : "Save Changes"}
                </button>
              </div>
            ) : null}
          </form>

          {/* Plan picker — one button per tier (not just Starter). PRD §17. */}
          {!business && (
            <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
              {TIERS.map(({ key, label, price }) => (
                <div
                  key={key}
                  className={`flex flex-col rounded-xl border p-3 ${
                    preselectedTier === key
                      ? "border-blue-500 bg-blue-50 dark:bg-blue-950/30"
                      : "border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-800/50"
                  }`}
                >
                  <p className="text-sm font-bold text-neutral-900 dark:text-neutral-100">{label}</p>
                  <p className="mb-3 mt-0.5 text-xs font-semibold text-neutral-500">{price}</p>
                  {key === "enterprise" ? (
                    <a
                      href="mailto:sales@zobia.app?subject=Enterprise%20Plan%20Enquiry"
                      className="mt-auto block rounded-xl bg-neutral-900 py-2 text-center text-xs font-semibold text-white hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
                    >
                      Contact Us
                    </a>
                  ) : (
                    <button
                      onClick={() => handleCreate(key)}
                      disabled={submitting || !businessName.trim()}
                      className="mt-auto rounded-xl bg-blue-600 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                      {submitting ? "Redirecting…" : `Get Started — ${label}`}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
