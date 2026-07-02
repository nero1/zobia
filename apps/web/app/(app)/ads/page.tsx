"use client";

/**
 * app/(app)/ads/page.tsx
 *
 * Ads hub — destination for the sidebar's "Ads" link (PRD §17 Pillar 3:
 * "Ads has its own menu link and can also be accessed from Business
 * account page"). Eligible advertisers (verified Business Account, KYC
 * Tier 1+ owner — lib/ads/limits.ts) are sent straight to the full
 * Advertising Panel at /business/ads, which is the single source of truth
 * for campaign creation/management — this page just gates the entry point
 * and explains the feature to everyone else.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";

interface Eligibility {
  eligible: boolean;
  reason?: string;
}

export default function AdsHubPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const [eligibility, setEligibility] = useState<Eligibility | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/business/ads/eligibility", { credentials: "include" });
        if (res.ok) {
          const json = await res.json();
          const data: Eligibility = json.data;
          setEligibility(data);
          if (data.eligible) {
            router.replace("/business/ads");
            return;
          }
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [router]);

  if (loading || eligibility?.eligible) {
    return (
      <div className="mx-auto max-w-4xl space-y-5 p-4 sm:p-6">
        <div className="h-8 w-56 animate-pulse rounded bg-neutral-200 dark:bg-neutral-700" />
        <div className="h-40 animate-pulse rounded-2xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-50">{t("ads.hubTitle", "Advertise on Zobia")}</h1>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
          {t("ads.hubSubtitle", "Reach the Zobia community with banners, native placements, interstitials, and rewarded video — billed by CPM.")}
        </p>
      </div>

      <div className="rounded-2xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
        <h2 className="font-semibold text-neutral-900 dark:text-neutral-100">{t("ads.eligibilityTitle", "Getting started")}</h2>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
          {eligibility?.reason ?? t("ads.eligibilityDefault", "You need a verified Business Account with identity verification to place ads.")}
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link href="/business" className="rounded-xl bg-primary-600 px-4 py-2.5 text-sm font-semibold text-white">
            {t("ads.createBusinessAccount", "Create a Business Account")}
          </Link>
          <Link href="/kyc" className="rounded-xl border border-neutral-200 px-4 py-2.5 text-sm font-semibold text-neutral-700 dark:border-neutral-700 dark:text-neutral-200">
            {t("ads.completeKyc", "Complete identity verification")}
          </Link>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {[
          { emoji: "🖼️", key: "adFormats", title: "Ad formats", body: "300×250 square, 320×50 banner, full-screen interstitial, rewarded video, and in-stream native placements." },
          { emoji: "💰", key: "cpmBilling", title: "CPM billing", body: "Pay per 1,000 impressions with Zobia Credits — top up with cash (Paystack/DodoPayments/Play Billing) or Credits directly." },
          { emoji: "🤖", key: "moderation", title: "Fast, safe review", body: "AI-assisted moderation with manual escalation keeps campaigns brand-safe without slowing you down." },
          { emoji: "📈", key: "boosting", title: "Boost your content", body: "Promote a Blog post or Room alongside standalone campaigns — same budget, same stats." },
        ].map((f) => (
          <div key={f.key} className="rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
            <span className="text-2xl">{f.emoji}</span>
            <h3 className="mt-2 text-sm font-semibold text-neutral-900 dark:text-neutral-100">{f.title}</h3>
            <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">{f.body}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
