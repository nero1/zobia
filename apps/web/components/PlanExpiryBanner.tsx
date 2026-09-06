"use client";

/**
 * PlanExpiryBanner
 *
 * Dismissible banner warning that a personal (Plus/Pro/Max) or Business
 * plan is about to expire, or has expired. Extracted from
 * app/(app)/home/page.tsx so it can also be shown on the Business hub page
 * (app/(app)/business/page.tsx) — PRD §17: "when a business plan is nearing
 * its end, there should be a well structured notification and reminder on
 * the home page ... and on the Business page."
 *
 * Callers fetch /api/users/me themselves and pass plan_ends_at /
 * business_plan_ends_at into resolvePlanExpiry() to build the `info` prop —
 * this component only renders and manages dismissal, it doesn't fetch.
 */

import { useState, useEffect } from "react";
import Link from "next/link";
import { useTranslation } from "react-i18next";

export interface PlanExpiryInfo {
  /** "personal" (Plus/Pro/Max) or "business" plan */
  kind: "personal" | "business";
  endsAt: string;
  daysRemaining: number;
}

const PLAN_EXPIRY_WARNING_DAYS = 14;
const PLAN_EXPIRY_URGENT_DAYS = 7;
const PLAN_EXPIRY_DISMISS_KEY = "zobia_plan_expiry_dismissed";

function daysUntil(iso: string): number {
  const ms = new Date(iso).getTime() - Date.now();
  return Math.ceil(ms / (24 * 60 * 60 * 1000));
}

/** Picks whichever of the user's personal/business plans expires soonest, if within the warning window. */
export function resolvePlanExpiry(planEndsAt: string | null, businessPlanEndsAt: string | null): PlanExpiryInfo | null {
  const candidates: PlanExpiryInfo[] = [];
  if (planEndsAt) candidates.push({ kind: "personal", endsAt: planEndsAt, daysRemaining: daysUntil(planEndsAt) });
  if (businessPlanEndsAt) candidates.push({ kind: "business", endsAt: businessPlanEndsAt, daysRemaining: daysUntil(businessPlanEndsAt) });
  const withinWindow = candidates.filter((c) => c.daysRemaining <= PLAN_EXPIRY_WARNING_DAYS);
  if (withinWindow.length === 0) return null;
  return withinWindow.sort((a, b) => a.daysRemaining - b.daysRemaining)[0];
}

export function PlanExpiryBanner({ info }: { info: PlanExpiryInfo }) {
  const { t } = useTranslation();
  const [dismissed, setDismissed] = useState(false);
  const urgent = info.daysRemaining <= PLAN_EXPIRY_URGENT_DAYS;

  useEffect(() => {
    if (urgent) return; // urgent state is never dismissible
    try {
      const stored = JSON.parse(localStorage.getItem(PLAN_EXPIRY_DISMISS_KEY) ?? "{}") as { endsAt?: string; kind?: string };
      setDismissed(stored.endsAt === info.endsAt && stored.kind === info.kind);
    } catch {
      setDismissed(false);
    }
  }, [info.endsAt, info.kind, urgent]);

  function dismiss() {
    try {
      localStorage.setItem(PLAN_EXPIRY_DISMISS_KEY, JSON.stringify({ endsAt: info.endsAt, kind: info.kind }));
    } catch { /* ignore */ }
    setDismissed(true);
  }

  if (dismissed) return null;

  const message =
    info.daysRemaining <= 0
      ? t(info.kind === "business" ? "home.planExpiry.businessExpired" : "home.planExpiry.personalExpired")
      : t(info.kind === "business" ? "home.planExpiry.businessEndsIn" : "home.planExpiry.personalEndsIn", { count: info.daysRemaining });

  return (
    <div
      role="alert"
      className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm font-medium ${
        urgent
          ? "border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200"
          : "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
      }`}
    >
      <span>
        {message}{" "}
        <Link
          href={info.kind === "business" ? "/settings/business" : "/settings/subscription"}
          className="font-semibold underline underline-offset-2"
        >
          {t("home.planExpiry.resubscribe")}
        </Link>
      </span>
      {!urgent && (
        <button
          onClick={dismiss}
          aria-label={t("home.planExpiry.dismiss")}
          className="shrink-0 opacity-70 hover:opacity-100"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  );
}
