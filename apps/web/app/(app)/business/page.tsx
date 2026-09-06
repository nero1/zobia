"use client";

/**
 * app/(app)/business/page.tsx
 *
 * Business hub (PRD §17) — the destination for the sidebar's "Business" link.
 *
 * - No business account yet: explains the feature, plans, and pricing, with
 *   a Create Business Account CTA (routes to /settings/business, which owns
 *   the actual paid signup flow — see BUSINESS_SELECT_COLUMNS/webhook flow).
 * - Has a business account: a dashboard hub linking to Account & Billing,
 *   Business Pages, and the Advertising Panel, plus a quick status summary.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import { PlanExpiryBanner, resolvePlanExpiry, type PlanExpiryInfo } from "@/components/PlanExpiryBanner";

interface BusinessAccount {
  id: string;
  business_name: string;
  tier: "starter" | "growth" | "enterprise";
  verified: boolean;
  status: string;
  verification_status: string;
  downgrade_to_tier: string | null;
  downgrade_effective_at: string | null;
}

interface BusinessPagePreview {
  id: string;
  name: string;
  status: string;
  view_count: number;
}

const TIER_ORDER: Record<string, number> = { starter: 1, growth: 2, enterprise: 3 };

/** Tier-gated features shown on the hub with a lock + upgrade chip when unavailable (PRD §17). */
const GATED_FEATURES: { icon: string; title: string; desc: string; minTier: "growth" | "enterprise"; href: string }[] = [
  { icon: "🎯", title: "Sponsored Quests", desc: "Submit self-service Sponsored Quests for creators to complete.", minTier: "growth", href: "/business/ads" },
  { icon: "🎨", title: "Custom Room Theming", desc: "Brand your Rooms with custom colors and assets.", minTier: "enterprise", href: "/business/pages" },
  { icon: "🔌", title: "API Access", desc: "Programmatic access to your business's data.", minTier: "enterprise", href: "/settings/business" },
];

const TIERS = [
  {
    key: "starter",
    label: "Starter",
    price: "₦5,000/mo",
    features: ["Verified business badge (on approval)", "Broadcast capability", "Run Ads (CPM campaigns)", "Basic analytics (totals)", "Up to 2 Business Pages"],
  },
  {
    key: "growth",
    label: "Growth",
    price: "₦15,000/mo",
    features: ["Everything in Starter", "Quest Marketplace — create Sponsored Quests", "Room promotion credits", "Per-page stats breakdown", "Up to 10 Business Pages"],
  },
  {
    key: "enterprise",
    label: "Enterprise",
    price: "₦50,000+/mo",
    features: ["Everything in Growth", "Custom Room theming", "API access", "Dedicated account management", "90-day daily stats drill-down + CSV export", "Up to 50 Business Pages"],
  },
] as const;

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" });
}

export default function BusinessHubPage() {
  const { t } = useTranslation();
  const [account, setAccount] = useState<BusinessAccount | null>(null);
  const [loading, setLoading] = useState(true);
  const [planExpiry, setPlanExpiry] = useState<PlanExpiryInfo | null>(null);
  const [pagesSummary, setPagesSummary] = useState<{ used: number; limit: number; pages: BusinessPagePreview[] } | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/business", { credentials: "include" });
        if (res.ok) {
          const json = await res.json();
          setAccount(json.data.business);
          // Quick pages preview for the hub — full CRUD lives at /business/pages.
          const pagesRes = await fetch("/api/business/pages", { credentials: "include" });
          if (pagesRes.ok) {
            const pagesJson = await pagesRes.json();
            setPagesSummary({
              used: pagesJson.data.used,
              limit: pagesJson.data.limit,
              pages: (pagesJson.data.pages as BusinessPagePreview[]).slice(0, 3),
            });
          }
        }
      } finally {
        setLoading(false);
      }
    })();

    // PRD §17: business plan expiry reminder, same banner shown on Home.
    fetch("/api/users/me", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((meData) => {
        const me = meData?.user ?? meData;
        setPlanExpiry(resolvePlanExpiry(me?.plan_ends_at ?? null, me?.business_plan_ends_at ?? null));
      })
      .catch(() => setPlanExpiry(null));
  }, []);

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl space-y-5 p-4 sm:p-6">
        <div className="h-8 w-56 animate-pulse rounded bg-neutral-200 dark:bg-neutral-700" />
        <div className="h-64 animate-pulse rounded-2xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900" />
      </div>
    );
  }

  // -------------------------------------------------------------------
  // Has a business account — dashboard hub
  // -------------------------------------------------------------------
  if (account) {
    return (
      <div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6">
        {planExpiry && <PlanExpiryBanner info={planExpiry} />}
        <div>
          <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-50">{account.business_name}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-semibold capitalize text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
              {account.tier} tier
            </span>
            {account.verified && (
              <span className="rounded-full bg-teal-100 px-2.5 py-0.5 text-xs font-semibold text-teal-700 dark:bg-teal-900/40 dark:text-teal-300">
                Verified ✓
              </span>
            )}
            {account.status !== "active" && (
              <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold capitalize text-red-700 dark:bg-red-900/40 dark:text-red-300">
                {account.status}
              </span>
            )}
          </div>
        </div>

        {account.downgrade_to_tier && account.downgrade_effective_at && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
            Downgrading to <span className="font-semibold capitalize">{account.downgrade_to_tier}</span> on{" "}
            <span className="font-semibold">{fmtDate(account.downgrade_effective_at)}</span>. Your pages and live
            sponsored quests stay active until then.{" "}
            <Link href="/settings/business" className="underline">Cancel downgrade</Link>
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Link
            href="/settings/business"
            className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm transition-colors hover:border-blue-300 dark:border-neutral-800 dark:bg-neutral-900"
          >
            <div className="mb-2 text-2xl">⚙️</div>
            <h2 className="font-semibold text-neutral-900 dark:text-neutral-100">Account &amp; Billing</h2>
            <p className="mt-1 text-sm text-neutral-500">Tier, verification, and upgrade/downgrade.</p>
          </Link>
          <Link
            href="/business/pages"
            className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm transition-colors hover:border-blue-300 dark:border-neutral-800 dark:bg-neutral-900"
          >
            <div className="mb-2 text-2xl">🏢</div>
            <h2 className="font-semibold text-neutral-900 dark:text-neutral-100">Business Pages</h2>
            <p className="mt-1 text-sm text-neutral-500">Create and manage pages, post updates.</p>
          </Link>
          <Link
            href="/business/ads"
            className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm transition-colors hover:border-blue-300 dark:border-neutral-800 dark:bg-neutral-900"
          >
            <div className="mb-2 text-2xl">📣</div>
            <h2 className="font-semibold text-neutral-900 dark:text-neutral-100">Advertising Panel</h2>
            <p className="mt-1 text-sm text-neutral-500">Run CPM ad campaigns and (Growth+) submit Sponsored Quests.</p>
          </Link>
          <Link
            href="/business/stats"
            className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm transition-colors hover:border-blue-300 dark:border-neutral-800 dark:bg-neutral-900"
          >
            <div className="mb-2 text-2xl">📊</div>
            <h2 className="font-semibold text-neutral-900 dark:text-neutral-100">Stats</h2>
            <p className="mt-1 text-sm text-neutral-500">Page and advert stats — depth grows with tier.</p>
          </Link>
          <Link
            href="/business/broadcasts"
            className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm transition-colors hover:border-blue-300 dark:border-neutral-800 dark:bg-neutral-900"
          >
            <div className="mb-2 text-2xl">📢</div>
            <h2 className="font-semibold text-neutral-900 dark:text-neutral-100">Broadcasts</h2>
            <p className="mt-1 text-sm text-neutral-500">Message your followers — quota grows with tier.</p>
          </Link>
        </div>

        {/* Pages preview — full list/CRUD at /business/pages */}
        {pagesSummary && (
          <div className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-semibold text-neutral-900 dark:text-neutral-100">Business Pages</h2>
              <span className="text-xs text-neutral-500">{pagesSummary.used}/{pagesSummary.limit} slots used</span>
            </div>
            {pagesSummary.pages.length === 0 ? (
              <p className="text-sm text-neutral-400">
                No pages yet. <Link href="/business/pages" className="underline">Create one</Link> to start attributing adverts and posts to your brand.
              </p>
            ) : (
              <div className="space-y-2">
                {pagesSummary.pages.map((p) => (
                  <Link
                    key={p.id}
                    href={`/business/pages/${p.id}`}
                    className="flex items-center justify-between rounded-xl border border-neutral-100 px-3 py-2 text-sm hover:border-blue-300 dark:border-neutral-800"
                  >
                    <span className="truncate font-medium text-neutral-800 dark:text-neutral-200">{p.name}</span>
                    <span className="shrink-0 text-xs text-neutral-400">👁 {p.view_count} · {p.status}</span>
                  </Link>
                ))}
                <Link href="/business/pages" className="block text-center text-xs font-semibold text-blue-600 hover:underline">
                  View all pages →
                </Link>
              </div>
            )}
          </div>
        )}

        {/* Tier-gated features — disabled with an upgrade chip when not on the required tier (PRD §17). */}
        <div>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">More Features</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {GATED_FEATURES.map((f) => {
              const available = TIER_ORDER[account.tier] >= TIER_ORDER[f.minTier];
              const content = (
                <>
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-2xl">{f.icon}</span>
                    {!available && (
                      <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
                        {f.minTier}+ only
                      </span>
                    )}
                  </div>
                  <h3 className="font-semibold text-neutral-900 dark:text-neutral-100">{f.title}</h3>
                  <p className="mt-1 text-sm text-neutral-500">{f.desc}</p>
                </>
              );
              return available ? (
                <Link
                  key={f.title}
                  href={f.href}
                  className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm transition-colors hover:border-blue-300 dark:border-neutral-800 dark:bg-neutral-900"
                >
                  {content}
                </Link>
              ) : (
                <Link
                  key={f.title}
                  href={`/settings/business?tier=${f.minTier}`}
                  className="rounded-2xl border border-dashed border-neutral-200 bg-neutral-50 p-5 opacity-70 transition-opacity hover:opacity-100 dark:border-neutral-800 dark:bg-neutral-900/50"
                  title={`Upgrade to ${f.minTier} to unlock this feature`}
                >
                  {content}
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------
  // No business account — marketing / pricing intro
  // -------------------------------------------------------------------
  return (
    <div className="mx-auto max-w-5xl space-y-8 p-4 sm:p-6">
      <div className="text-center">
        <h1 className="text-3xl font-bold text-neutral-900 dark:text-neutral-50">
          {t("business.intro.title", "Grow your brand on Zobia")}
        </h1>
        <p className="mx-auto mt-2 max-w-2xl text-neutral-500">
          {t(
            "business.intro.subtitle",
            "Business Accounts unlock a verified badge, broadcast tools, Business Pages you can post to, a Quest Marketplace to run sponsored campaigns, and analytics that grow with your plan."
          )}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { icon: "🏢", title: "Business Pages", desc: "Run 2–50 pages depending on tier, each with its own posts and stats." },
          { icon: "✅", title: "Verified Badge", desc: "Apply for platform verification once your account is active." },
          { icon: "🎯", title: "Sponsored Quests", desc: "Growth+ tiers can submit Sponsored Quests for creators to complete." },
          { icon: "📊", title: "Analytics", desc: "Stats depth grows with tier — from totals up to daily drill-downs + CSV export." },
        ].map((f) => (
          <div key={f.title} className="rounded-2xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
            <div className="mb-2 text-2xl">{f.icon}</div>
            <h3 className="font-semibold text-neutral-900 dark:text-neutral-100">{f.title}</h3>
            <p className="mt-1 text-sm text-neutral-500">{f.desc}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {TIERS.map((tier) => (
          <div key={tier.key} className="flex flex-col rounded-2xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
            <h3 className="text-lg font-bold text-neutral-900 dark:text-neutral-100">{tier.label}</h3>
            <p className="mt-0.5 text-sm font-semibold text-neutral-500">{tier.price}</p>
            <ul className="my-4 flex-1 space-y-2">
              {tier.features.map((feat) => (
                <li key={feat} className="flex items-start gap-1.5 text-sm text-neutral-700 dark:text-neutral-300">
                  <span className="mt-px font-bold text-teal-600">✓</span>
                  {feat}
                </li>
              ))}
            </ul>
            {tier.key === "enterprise" ? (
              <a
                href="mailto:sales@zobia.app?subject=Enterprise%20Plan%20Enquiry"
                className="block rounded-xl bg-neutral-900 py-2.5 text-center text-sm font-semibold text-white hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
              >
                Contact Us
              </a>
            ) : (
              <Link
                href={`/settings/business?tier=${tier.key}`}
                className="block rounded-xl bg-blue-600 py-2.5 text-center text-sm font-semibold text-white hover:bg-blue-700"
              >
                {t("business.intro.createButton", "Get Started")} — {tier.label}
              </Link>
            )}
          </div>
        ))}
      </div>

      <p className="text-center text-xs text-neutral-400">
        You can upgrade or downgrade anytime. Downgrades have a {" "}
        <span className="font-medium">30-day grace period</span>.
      </p>
    </div>
  );
}
