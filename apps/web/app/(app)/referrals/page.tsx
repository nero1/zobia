"use client";

/**
 * app/(app)/referrals/page.tsx
 *
 * Referrals page.
 * - Shows the user's referral link
 * - Copy-to-clipboard button
 * - Tier 1 (direct) and Tier 2 (indirect) counts, XP/Coins earned
 * - Table of referred users
 * - Explains the two-tier system
 */

import { useState, useEffect } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ReferralStats {
  referralCode: string;
  referralUrl: string;
  tier1Count: number;
  tier2Count: number;
  tier1XpEarned: number;
  tier2XpEarned: number;
  tier1CoinsEarned: number;
  tier2CoinsEarned: number;
}

interface ReferredUser {
  userId: string;
  username: string;
  displayName: string;
  tier: 1 | 2;
  joinedAt: string;
  qualifyingActionCompleted: boolean;
  xpEarned: number;
  coinsEarned: number;
}

interface ReferralsData {
  stats: ReferralStats | null;
  referredUsers: ReferredUser[];
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function SkeletonBlock({ className }: { className: string }) {
  return <div className={`animate-pulse rounded bg-neutral-200 dark:bg-neutral-700 ${className}`} />;
}

function PageSkeleton() {
  return (
    <div className="space-y-5">
      <SkeletonBlock className="h-24 rounded-xl" />
      <div className="grid grid-cols-2 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonBlock key={i} className="h-20 rounded-xl" />
        ))}
      </div>
      <SkeletonBlock className="h-64 rounded-xl" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Referral Link Card
// ---------------------------------------------------------------------------

function ReferralLinkCard({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Fallback: select text
    }
  }

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-card dark:border-neutral-800 dark:bg-neutral-900">
      <h2 className="mb-3 text-sm font-semibold text-neutral-700 dark:text-neutral-300">Your Referral Link</h2>
      <div className="flex gap-2">
        <input
          readOnly
          value={url}
          className="flex-1 truncate rounded-xl border border-neutral-300 bg-neutral-50 px-4 py-2.5 text-sm text-neutral-600 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-400"
        />
        <button
          onClick={handleCopy}
          className={`shrink-0 rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors ${
            copied
              ? "bg-teal-600 text-white"
              : "bg-blue-600 text-white hover:bg-blue-700"
          }`}
        >
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
      <p className="mt-2 text-xs text-neutral-500">
        Share this link to earn rewards when friends join and complete their first action.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stats grid
// ---------------------------------------------------------------------------

function StatsGrid({ stats }: { stats: ReferralStats }) {
  const items = [
    { label: "Tier 1 Referrals", value: stats.tier1Count.toLocaleString(), sub: "Direct" },
    { label: "Tier 2 Referrals", value: stats.tier2Count.toLocaleString(), sub: "Indirect" },
    { label: "XP Earned", value: (stats.tier1XpEarned + stats.tier2XpEarned).toLocaleString(), sub: "Total XP" },
    { label: "Coins Earned", value: (stats.tier1CoinsEarned + stats.tier2CoinsEarned).toLocaleString(), sub: "Total 🪙" },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {items.map((item) => (
        <div
          key={item.label}
          className="rounded-xl border border-neutral-200 bg-white p-4 shadow-card dark:border-neutral-800 dark:bg-neutral-900"
        >
          <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500">{item.label}</p>
          <p className="mt-1 text-xl font-bold text-neutral-900 dark:text-neutral-50">{item.value}</p>
          <p className="text-xs text-neutral-400">{item.sub}</p>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Two-tier explanation
// ---------------------------------------------------------------------------

function TwoTierExplainer() {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-card dark:border-neutral-800 dark:bg-neutral-900">
      <h2 className="mb-3 text-sm font-semibold text-neutral-700 dark:text-neutral-300">How the Two-Tier System Works</h2>
      <div className="space-y-3 text-sm text-neutral-600 dark:text-neutral-400">
        <div className="flex gap-3">
          <span className="mt-0.5 shrink-0 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-bold text-blue-700 dark:bg-blue-900 dark:text-blue-300">
            T1
          </span>
          <div>
            <p className="font-semibold text-neutral-900 dark:text-neutral-100">Tier 1 — Direct Referrals</p>
            <p className="mt-0.5 text-xs">
              When someone signs up using your referral link and completes their first qualifying
              action, you earn XP and Coins.
            </p>
          </div>
        </div>
        <div className="flex gap-3">
          <span className="mt-0.5 shrink-0 rounded-full bg-teal-100 px-2 py-0.5 text-xs font-bold text-teal-700 dark:bg-teal-900 dark:text-teal-300">
            T2
          </span>
          <div>
            <p className="font-semibold text-neutral-900 dark:text-neutral-100">Tier 2 — Indirect Referrals</p>
            <p className="mt-0.5 text-xs">
              When your Tier 1 referrals refer others, you earn a smaller bonus from those Tier 2
              sign-ups too.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Referred users table
// ---------------------------------------------------------------------------

function ReferredUsersTable({ users }: { users: ReferredUser[] }) {
  if (users.length === 0) {
    return (
      <div className="rounded-xl border border-neutral-200 bg-white shadow-card dark:border-neutral-800 dark:bg-neutral-900">
        <div className="border-b border-neutral-200 px-5 py-4 dark:border-neutral-800">
          <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">Referred Users</h2>
        </div>
        <div className="px-5 py-8 text-center text-sm text-neutral-500">
          No referred users yet. Share your link to get started!
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-neutral-200 bg-white shadow-card dark:border-neutral-800 dark:bg-neutral-900">
      <div className="border-b border-neutral-200 px-5 py-4 dark:border-neutral-800">
        <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">Referred Users</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-xs uppercase tracking-wider text-neutral-500">
              <th className="px-4 py-3 text-left font-semibold">User</th>
              <th className="px-4 py-3 text-left font-semibold">Tier</th>
              <th className="px-4 py-3 text-left font-semibold">Joined</th>
              <th className="px-4 py-3 text-left font-semibold">Qualified</th>
              <th className="px-4 py-3 text-right font-semibold">XP / Coins</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {users.map((u) => (
              <tr key={u.userId} className="hover:bg-neutral-50 dark:hover:bg-neutral-800/50">
                <td className="px-4 py-3">
                  <div>
                    <p className="font-semibold text-neutral-900 dark:text-neutral-100">{u.displayName}</p>
                    <p className="text-xs text-neutral-400">@{u.username}</p>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                      u.tier === 1
                        ? "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300"
                        : "bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-300"
                    }`}
                  >
                    Tier {u.tier}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs text-neutral-500">
                  {new Date(u.joinedAt).toLocaleDateString("en-GB", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}
                </td>
                <td className="px-4 py-3">
                  {u.qualifyingActionCompleted ? (
                    <span className="text-teal-600 dark:text-teal-400">✓ Yes</span>
                  ) : (
                    <span className="text-neutral-400">Pending</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  <p className="font-semibold text-neutral-900 dark:text-neutral-100">
                    +{u.xpEarned.toLocaleString()} XP
                  </p>
                  <p className="text-xs text-neutral-500">+{u.coinsEarned.toLocaleString()} 🪙</p>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function ReferralsPage() {
  const [data, setData] = useState<ReferralsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/referrals", { credentials: "include" });
        if (res.status === 401) { window.location.href = "/auth/login"; return; }
        if (!res.ok) throw new Error("Failed to load referrals");
        const json = await res.json() as Record<string, unknown>;
        // API returns { success, data: { referralCode, referralUrl, tier1Count, ... } }
        const apiData = ((json.data ?? json) as Record<string, unknown>);
        const referralsData: ReferralsData = {
          stats: {
            referralCode: String(apiData.referralCode ?? ""),
            referralUrl: String(apiData.referralUrl ?? ""),
            tier1Count: Number(apiData.tier1Count ?? 0),
            tier2Count: Number(apiData.tier2Count ?? 0),
            tier1XpEarned: Number(apiData.xpEarned ?? 0),
            tier2XpEarned: 0,
            tier1CoinsEarned: Number(apiData.coinsEarned ?? 0),
            tier2CoinsEarned: Number((apiData.commissions as Record<string,unknown>)?.tier2CoinsEarned ?? 0),
          },
          referredUsers: ((apiData.referrals as Record<string, unknown>[]) ?? []).map((r) => ({
            userId: String(r.id ?? ""),
            username: String(r.referredUsername ?? ""),
            displayName: String(r.referredDisplayName ?? r.referredUsername ?? "Unknown"),
            tier: (Number(r.tier) === 1 ? 1 : 2) as 1 | 2,
            joinedAt: String(r.createdAt ?? r.created_at ?? new Date().toISOString()),
            qualifyingActionCompleted: Boolean(r.qualified),
            xpEarned: Number(r.xpReward ?? r.xp_reward ?? 0),
            coinsEarned: Number(r.coinReward ?? r.coin_reward ?? 0),
          })),
        };
        setData(referralsData);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl p-4 sm:p-6">
        <h1 className="mb-5 text-2xl font-bold text-neutral-900 dark:text-neutral-50">Referrals</h1>
        <PageSkeleton />
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-3xl p-4 sm:p-6">
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-4 sm:p-6">
      <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-50">Referrals</h1>

      {data?.stats?.referralUrl && (
        <ReferralLinkCard url={data.stats.referralUrl} />
      )}

      {data?.stats && <StatsGrid stats={data.stats} />}

      <TwoTierExplainer />

      <ReferredUsersTable users={data?.referredUsers ?? []} />
    </div>
  );
}
