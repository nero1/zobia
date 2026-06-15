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

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

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
  onUpgraded,
}: {
  currentTier: string;
  onUpgraded: (tier: TierKey) => void;
}) {
  const [upgrading, setUpgrading] = useState<TierKey | null>(null);
  const [upgradeError, setUpgradeError] = useState<string | null>(null);

  const current = (currentTier.toLowerCase() as TierKey) in TIER_ORDER
    ? (currentTier.toLowerCase() as TierKey)
    : "starter";

  async function handleUpgrade(tier: TierKey) {
    if (tier === "enterprise") return;
    setUpgrading(tier);
    setUpgradeError(null);
    try {
      const res = await fetch("/api/business/tier", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier }),
      });
      const body = await res.json() as { success?: boolean; data?: { paymentUrl?: string }; error?: { message?: string } };
      if (!res.ok) throw new Error(body.error?.message ?? "Upgrade failed");
      if (body.data?.paymentUrl) {
        window.location.href = body.data.paymentUrl;
      } else {
        onUpgraded(tier);
      }
    } catch (e) {
      setUpgradeError(e instanceof Error ? e.message : "Upgrade failed");
    } finally {
      setUpgrading(null);
    }
  }

  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
      <h2 className="mb-4 text-base font-semibold text-neutral-900 dark:text-neutral-100">
        Business Tiers
      </h2>

      {upgradeError && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {upgradeError}
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
                    onClick={() => handleUpgrade(key)}
                    disabled={upgrading === key}
                    className="rounded-xl bg-blue-600 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
                  >
                    {upgrading === key ? "Redirecting…" : "Upgrade"}
                  </button>
                )
              ) : (
                <div className="rounded-xl border border-neutral-200 py-2 text-center text-xs font-semibold text-neutral-400 dark:border-neutral-700">
                  Unavailable
                </div>
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
      if (!res.ok) throw new Error("Failed to load business info");
      const json = await res.json() as { success: boolean; data: { business: BusinessAccount } };
      const biz = json.data.business;
      setBusiness(biz);
      setBusinessName(biz.business_name);
      setBusinessType((biz.business_type as BusinessType) ?? "retail");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
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
    setSubmitting(true);
    setError(null);
    try {
      const method = business ? "PATCH" : "POST";
      const res = await fetch("/api/business", {
        method,
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ business_name: businessName.trim(), business_type: businessType }),
      });
      const json = await res.json() as { success: boolean; data?: { business: BusinessAccount }; error?: { message?: string } };
      if (!res.ok) throw new Error(json.error?.message ?? "Failed to save");
      if (json.data?.business) {
        setBusiness(json.data.business);
      }
      setEditing(false);
      showToast(business ? "Business info updated!" : "Business account created!");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleVerificationRequest() {
    setVerifying(true);
    try {
      const res = await fetch("/api/business/verify", {
        method: "POST",
        credentials: "include",
      });
      const json = await res.json() as { success: boolean; data?: { verification_status: string }; error?: { message?: string } };
      if (!res.ok) throw new Error(json.error?.message ?? "Request failed");
      setBusiness((prev) => prev ? { ...prev, verification_status: "pending" } : prev);
      showToast("Verification request submitted! We'll review it soon.");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Request failed", "error");
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
      const json = await res.json() as { success: boolean; error?: { message?: string } };
      if (!res.ok) throw new Error(json.error?.message ?? "Cancel failed");
      setBusiness((prev) => prev ? { ...prev, verification_status: "unverified" } : prev);
      showToast("Verification request cancelled.");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Cancel failed", "error");
    } finally {
      setVerifying(false);
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
          <div className="mb-4 rounded-xl border border-neutral-100 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-800/50">
            <p className="text-xs font-semibold text-neutral-500">Tier</p>
            <p className="mt-0.5 font-semibold capitalize text-neutral-900 dark:text-neutral-100">{business.tier}</p>
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
          onUpgraded={(tier) => setBusiness((prev) => prev ? { ...prev, tier } : prev)}
        />
      )}

      {/* Create / Edit form */}
      {(!business || editing) && (
        <div className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
          <h2 className="mb-5 text-base font-semibold text-neutral-900 dark:text-neutral-100">
            {business ? "Edit Business Info" : "Create Business Account"}
          </h2>

          {error && (
            <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
              {error}
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

            <div className="flex gap-3 pt-2">
              {business && (
                <button
                  type="button"
                  onClick={() => setEditing(false)}
                  className="flex-1 rounded-xl border border-neutral-300 py-2.5 text-sm font-semibold text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300"
                >
                  Cancel
                </button>
              )}
              <button
                type="submit"
                disabled={submitting || !businessName.trim()}
                className="flex-1 rounded-xl bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
              >
                {submitting ? "Saving…" : business ? "Save Changes" : "Create Business Account"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
