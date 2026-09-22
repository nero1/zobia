"use client";

/**
 * components/merch/ReferralShareDropdown.tsx
 *
 * Collapsible "Earn a commission" panel shown on a Market/merch product card
 * for items the creator opted into the referral program. Only rendered for
 * logged-in users (referral links require a referral code). Shows the
 * commission rate and a ready-to-share link with the viewer's own `?r=` code
 * already attached, plus a copy button.
 *
 * The referral code itself comes from the shared useMyReferralCode() hook
 * (lib/referral/useReferralCode.ts), fetched once per session and cached in
 * localStorage, scoped by user id so it never leaks between users of a
 * shared device.
 */

import { useState } from "react";
import { useAuth } from "@/lib/auth/hooks";
import { appendReferralCode } from "@zobia/shared/utils";
import { useMyReferralCode } from "@/lib/referral/useReferralCode";

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface ReferralShareDropdownProps {
  /** Absolute or relative URL to the product/item (the referral code is appended to this). */
  itemUrl: string;
  /** true for physical items with a creator-set %; false/undefined for digital (platform standard rate). */
  isPhysical?: boolean;
  /** Creator-set commission % — only meaningful when isPhysical is true. */
  commissionPct?: number | null;
}

export function ReferralShareDropdown({ itemUrl, isPhysical, commissionPct }: ReferralShareDropdownProps) {
  const { user } = useAuth();
  const { code: refCode, loading: codeLoading } = useMyReferralCode();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  if (!user) return null;

  const link = refCode ? appendReferralCode(itemUrl, refCode) : null;
  const loading = open && codeLoading;

  function toggle() {
    setOpen((prev) => !prev);
  }

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable — no-op, link is still selectable/visible
    }
  }

  const commissionLabel = isPhysical
    ? commissionPct
      ? `Earn ${commissionPct}% commission`
      : null
    : "Earn a commission";

  if (!commissionLabel) return null;

  return (
    <div className="mt-1 text-xs">
      <button
        type="button"
        onClick={toggle}
        className="flex w-full items-center justify-between rounded-lg border border-teal-200 bg-teal-50 px-2 py-1.5 font-medium text-teal-700 hover:bg-teal-100 dark:border-teal-900 dark:bg-teal-950 dark:text-teal-300 dark:hover:bg-teal-900"
      >
        <span>💰 {commissionLabel}</span>
        <span aria-hidden>{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="mt-1.5 rounded-lg border border-neutral-200 bg-white p-2 dark:border-neutral-800 dark:bg-neutral-900">
          {loading ? (
            <p className="text-neutral-500">Loading your link…</p>
          ) : link ? (
            <div className="flex items-center gap-1.5">
              <input
                readOnly
                value={link}
                onClick={(e) => (e.target as HTMLInputElement).select()}
                className="min-w-0 flex-1 truncate rounded border border-neutral-200 bg-neutral-50 px-1.5 py-1 text-[11px] text-neutral-600 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300"
              />
              <button
                type="button"
                onClick={copy}
                title="Copy link"
                className="shrink-0 rounded bg-teal-600 px-2 py-1 text-white hover:bg-teal-700"
              >
                {copied ? "✓" : "📋"}
              </button>
            </div>
          ) : (
            <p className="text-neutral-500">Couldn&apos;t load your referral link.</p>
          )}
        </div>
      )}
    </div>
  );
}
