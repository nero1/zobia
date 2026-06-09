"use client";

/**
 * app/(app)/creator/marketplace/page.tsx
 *
 * Creator Marketplace — browse and apply for sponsored quests.
 * Only accessible to creators (is_creator = true).
 */

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SponsoredQuest {
  id: string;
  brandName: string;
  title: string;
  description: string;
  targetAction: string;
  rewardCoins: number;
  creatorPayout: number; // NGN
  status: "open" | "closed" | "full";
  applicantsCount: number;
  maxApplicants: number | null;
  expiresAt: string | null;
}

interface CurrentUser {
  id: string;
  isCreator: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatNgn(amount: number): string {
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    maximumFractionDigits: 0,
  }).format(amount);
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function QuestSkeleton() {
  return (
    <div className="animate-pulse rounded-2xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="mb-3 flex items-center gap-3">
        <div className="h-10 w-10 rounded-xl bg-neutral-200 dark:bg-neutral-700" />
        <div>
          <div className="mb-1 h-3 w-20 rounded bg-neutral-200 dark:bg-neutral-700" />
          <div className="h-4 w-40 rounded bg-neutral-200 dark:bg-neutral-700" />
        </div>
      </div>
      <div className="mb-2 h-3 w-full rounded bg-neutral-200 dark:bg-neutral-700" />
      <div className="mb-4 h-3 w-2/3 rounded bg-neutral-200 dark:bg-neutral-700" />
      <div className="h-9 rounded-xl bg-neutral-200 dark:bg-neutral-700" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Quest card
// ---------------------------------------------------------------------------

interface QuestCardProps {
  quest: SponsoredQuest;
  onApply: (questId: string) => void;
  applying: string | null;
  applied: Set<string>;
}

const STATUS_BADGE: Record<string, string> = {
  open: "bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-300",
  closed: "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400",
  full: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
};

function QuestCard({ quest, onApply, applying, applied }: QuestCardProps) {
  const isApplying = applying === quest.id;
  const hasApplied = applied.has(quest.id);
  const canApply = quest.status === "open" && !hasApplied;

  return (
    <div className="flex flex-col rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md dark:border-neutral-800 dark:bg-neutral-900">
      {/* Header */}
      <div className="mb-3 flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-100 text-xl dark:bg-blue-900">
          🏷️
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-neutral-500">{quest.brandName}</p>
          <p className="font-semibold text-neutral-900 dark:text-neutral-100">{quest.title}</p>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${STATUS_BADGE[quest.status]}`}>
          {quest.status}
        </span>
      </div>

      {/* Description */}
      <p className="mb-3 text-sm text-neutral-600 dark:text-neutral-400 line-clamp-2">{quest.description}</p>

      {/* Target action */}
      <div className="mb-3 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 dark:border-neutral-700 dark:bg-neutral-800">
        <p className="text-xs font-semibold text-neutral-500">Required Action</p>
        <p className="text-sm text-neutral-800 dark:text-neutral-200">{quest.targetAction}</p>
      </div>

      {/* Rewards */}
      <div className="mb-4 grid grid-cols-2 gap-2">
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-center dark:border-amber-800 dark:bg-amber-950/30">
          <p className="text-xs text-amber-600 dark:text-amber-400">User Reward</p>
          <p className="font-bold text-amber-700 dark:text-amber-300">🪙 {quest.rewardCoins.toLocaleString()}</p>
        </div>
        <div className="rounded-lg border border-teal-200 bg-teal-50 p-2 text-center dark:border-teal-800 dark:bg-teal-950/30">
          <p className="text-xs text-teal-600 dark:text-teal-400">Creator Payout</p>
          <p className="font-bold text-teal-700 dark:text-teal-300">{formatNgn(quest.creatorPayout)}</p>
        </div>
      </div>

      {/* Applicants */}
      {quest.maxApplicants !== null && (
        <p className="mb-3 text-xs text-neutral-500">
          {quest.applicantsCount} / {quest.maxApplicants} applicants
        </p>
      )}

      {/* Action */}
      {hasApplied ? (
        <div className="flex items-center justify-center gap-2 rounded-xl bg-teal-50 py-2.5 text-sm font-semibold text-teal-700 dark:bg-teal-900/30 dark:text-teal-400">
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
          Applied
        </div>
      ) : (
        <button
          onClick={() => canApply && onApply(quest.id)}
          disabled={!canApply || isApplying}
          className={`w-full rounded-xl py-2.5 text-sm font-semibold transition-colors ${
            canApply
              ? "bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60"
              : "cursor-not-allowed bg-neutral-100 text-neutral-400 dark:bg-neutral-800"
          }`}
        >
          {isApplying ? "Applying…" : quest.status === "full" ? "Full" : quest.status === "closed" ? "Closed" : "Apply"}
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

/**
 * Creator marketplace — sponsored quests for creators to apply to.
 */
export default function CreatorMarketplacePage() {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [quests, setQuests] = useState<SponsoredQuest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [applying, setApplying] = useState<string | null>(null);
  const [applied, setApplied] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  const showToast = useCallback((msg: string, type: "success" | "error" = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        // Check auth + creator status
        const meRes = await fetch("/api/auth/me", { credentials: "include" });
        if (meRes.status === 401) { window.location.href = "/auth/login"; return; }
        const me = (await meRes.json()) as CurrentUser;
        setUser(me);
        if (!me.isCreator) { setLoading(false); return; }

        // Fetch sponsored quests
        const res = await fetch("/api/quests/sponsored", { credentials: "include" });
        if (!res.ok) throw new Error("Failed to load quests");
        const data = (await res.json()) as { quests: SponsoredQuest[] };
        setQuests(data.quests);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function handleApply(questId: string) {
    setApplying(questId);
    try {
      const res = await fetch(`/api/quests/sponsored/${questId}/apply`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        const body = (await res.json()) as { error?: { message?: string } };
        throw new Error(body.error?.message ?? "Application failed");
      }
      setApplied((prev) => new Set(prev).add(questId));
      showToast("Application submitted successfully!");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Failed to apply", "error");
    } finally {
      setApplying(null);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6">
        <div className="mb-6 h-8 w-64 animate-pulse rounded bg-neutral-200 dark:bg-neutral-700" />
        <div className="grid gap-4 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => <QuestSkeleton key={i} />)}
        </div>
      </div>
    );
  }

  // Non-creator upgrade prompt
  if (user && !user.isCreator) {
    return (
      <div className="mx-auto max-w-lg p-4 sm:p-6">
        <div className="rounded-2xl border border-neutral-200 bg-white p-8 text-center shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
          <span className="text-5xl">🚀</span>
          <h2 className="mt-4 text-xl font-bold text-neutral-900 dark:text-neutral-50">Become a Creator</h2>
          <p className="mt-2 text-sm text-neutral-500">
            Upgrade to a creator account to access sponsored quests and earn from brand partnerships.
          </p>
          <Link
            href="/creator"
            className="mt-5 inline-block rounded-xl bg-blue-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
          >
            Get Creator Access
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-50">Creator Marketplace</h1>
        <p className="mt-1 text-sm text-neutral-500">Apply for sponsored quests and earn from brand campaigns.</p>
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

      {/* Error */}
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Quests grid */}
      {quests.length === 0 && !error ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-neutral-200 bg-white py-20 dark:border-neutral-800 dark:bg-neutral-900">
          <span className="text-5xl">📋</span>
          <p className="mt-3 text-lg font-semibold text-neutral-700 dark:text-neutral-300">No quests available</p>
          <p className="mt-1 text-sm text-neutral-500">New brand campaigns will appear here. Check back soon!</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {quests.map((quest) => (
            <QuestCard
              key={quest.id}
              quest={quest}
              onApply={handleApply}
              applying={applying}
              applied={applied}
            />
          ))}
        </div>
      )}
    </div>
  );
}
