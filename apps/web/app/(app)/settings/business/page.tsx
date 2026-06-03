"use client";

/**
 * app/(app)/settings/business/page.tsx
 *
 * Business account settings page.
 * Shows current business info (if exists) or an onboarding form.
 * Submits via POST (create) or PATCH (update) to /api/business.
 */

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type BusinessType = "retail" | "service" | "media" | "other";
type VerificationStatus = "unverified" | "pending" | "verified" | "rejected";

interface BusinessAccount {
  id: string;
  businessName: string;
  businessType: BusinessType;
  tier: string;
  verificationStatus: VerificationStatus;
  createdAt: string;
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
  pending: { label: "Pending Review", classes: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300" },
  verified: { label: "Verified", classes: "bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-300" },
  rejected: { label: "Rejected", classes: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300" },
};

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

/**
 * Business account settings — create or manage a business account.
 */
export default function BusinessSettingsPage() {
  const [business, setBusiness] = useState<BusinessAccount | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  // Form state
  const [businessName, setBusinessName] = useState("");
  const [businessType, setBusinessType] = useState<BusinessType>("retail");
  const [editing, setEditing] = useState(false);

  const showToast = useCallback((msg: string, type: "success" | "error" = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/business", { credentials: "include" });
        if (res.status === 401) { window.location.href = "/login"; return; }
        if (res.status === 404) {
          // No business account yet — show form
          setBusiness(null);
          setEditing(true);
          return;
        }
        if (!res.ok) throw new Error("Failed to load business info");
        const data = (await res.json()) as BusinessAccount;
        setBusiness(data);
        setBusinessName(data.businessName);
        setBusinessType(data.businessType);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

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
      if (!res.ok) {
        const body = (await res.json()) as { error?: { message?: string } };
        throw new Error(body.error?.message ?? "Failed to save");
      }
      const updated = (await res.json()) as BusinessAccount;
      setBusiness(updated);
      setEditing(false);
      showToast(business ? "Business info updated!" : "Business account created!");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSubmitting(false);
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

  const badge = business ? VERIFICATION_BADGE[business.verificationStatus] : null;

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

      {/* Current info card (if exists and not editing) */}
      {business && !editing && (
        <div className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
          <div className="mb-4 flex items-start justify-between">
            <div>
              <h2 className="text-lg font-bold text-neutral-900 dark:text-neutral-100">{business.businessName}</h2>
              <p className="text-sm text-neutral-500 capitalize">{business.businessType}</p>
            </div>
            {badge && (
              <span className={`rounded-full px-3 py-1 text-xs font-semibold ${badge.classes}`}>
                {badge.label}
              </span>
            )}
          </div>

          {/* Tier */}
          <div className="mb-4 rounded-xl border border-neutral-100 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-800/50">
            <p className="text-xs font-semibold text-neutral-500">Tier</p>
            <p className="mt-0.5 font-semibold capitalize text-neutral-900 dark:text-neutral-100">{business.tier}</p>
          </div>

          {/* Verification note */}
          {business.verificationStatus === "rejected" && (
            <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
              Your verification was rejected. Update your business details and resubmit.
            </div>
          )}
          {business.verificationStatus === "pending" && (
            <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
              Your business is under review. We&apos;ll notify you once verified.
            </div>
          )}

          <button
            onClick={() => setEditing(true)}
            className="w-full rounded-xl border border-neutral-300 py-2.5 text-sm font-semibold text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            Edit Business Info
          </button>
        </div>
      )}

      {/* Form */}
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
            {/* Business name */}
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

            {/* Business type */}
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

            {/* Actions */}
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
