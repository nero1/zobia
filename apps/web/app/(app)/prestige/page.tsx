"use client";

/**
 * app/(app)/prestige/page.tsx
 *
 * Prestige confirmation flow.
 * - Checks eligibility via GET /api/prestige
 * - Shows lock screen if not eligible
 * - Shows dramatic confirmation screen if eligible
 * - POST /api/prestige to confirm prestige
 */

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useCurrency } from "@/lib/hooks/useCurrency";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PrestigeEligibility {
  eligible: boolean;
  currentRankName: string;
  currentRankLevel: number;
  currentPrestige: number;
  requiredRankLevel: number;
  rewardsFrame: string;
  rewardsTitle: string;
  rewardsCoins: number;
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function PageSkeleton() {
  return (
    <div className="animate-pulse space-y-5">
      <div className="h-8 w-48 rounded bg-neutral-200 dark:bg-neutral-700" />
      <div className="h-64 rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Prestige explanation card
// ---------------------------------------------------------------------------

function PrestigeExplainer() {
  const currency = useCurrency();
  return (
    <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-950/30">
      <h3 className="mb-2 text-sm font-bold text-blue-800 dark:text-blue-200">What is Prestige?</h3>
      <p className="text-sm text-blue-700 dark:text-blue-300">
        Prestige is a special milestone for the most dedicated Zobia players. When you reach the highest rank
        (<strong>Zobia Icon III</strong>), you can choose to <em>Prestige</em> — resetting your main rank back
        to Beginner in exchange for exclusive rewards and a permanent star on your profile that shows
        everyone how many times you have mastered the game.
      </p>
      <ul className="mt-3 space-y-1 text-xs text-blue-600 dark:text-blue-400">
        <li>⭐ Each prestige adds a star to your profile badge</li>
        <li>🪙 Earn {currency.softPlural.toLowerCase()} and exclusive frames with each prestige</li>
        <li>🔥 3× XP boost for 7 days after prestige (from your 3rd prestige)</li>
        <li>🏆 Reach Prestige 10 to be inducted into the Hall of Fame</li>
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Lock screen
// ---------------------------------------------------------------------------

const RANK_ORDER = ["Beginner", "Rookie", "Hustler", "Baller", "Boss", "Legend", "Titan", "Goat", "Icon", "Zobia Icon"];

function LockScreen({ data }: { data: PrestigeEligibility }) {
  const currentLevel = data.currentRankLevel > 0 ? data.currentRankLevel : 1;
  const requiredLevel = data.requiredRankLevel > 0 ? data.requiredRankLevel : RANK_ORDER.length;
  const progressPct = Math.min(100, Math.round((currentLevel / requiredLevel) * 100));

  return (
    <div className="flex flex-col items-center py-12 text-center">
      <span className="text-6xl">🔒</span>
      <h2 className="mt-4 text-2xl font-bold text-neutral-900 dark:text-neutral-50">
        Not Yet
      </h2>
      <p className="mt-2 text-neutral-500">
        You are currently{" "}
        <span className="font-semibold text-neutral-900 dark:text-neutral-100">
          {data.currentRankName || "Beginner"}
        </span>{" "}
        (Level {currentLevel}).
      </p>
      <p className="mt-1 text-sm text-neutral-500">
        Prestige requires reaching Level{" "}
        <span className="font-semibold">{requiredLevel}</span>{" "}
        (<strong>Zobia Icon III</strong>).
      </p>

      <div className="mt-6 w-full max-w-xs">
        <div className="mb-1 flex justify-between text-xs text-neutral-400">
          <span>Level {currentLevel}</span>
          <span>Level {requiredLevel} required</span>
        </div>
        <div className="h-3 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-700">
          <div
            className="h-full rounded-full bg-blue-500 transition-all"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      <Link
        href="/profile"
        className="mt-8 rounded-xl border border-neutral-300 px-6 py-2.5 text-sm font-semibold text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
      >
        Back to Profile
      </Link>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Confirmation screen
// ---------------------------------------------------------------------------

interface ConfirmScreenProps {
  data: PrestigeEligibility;
  onConfirm: () => Promise<void>;
  confirming: boolean;
  done: boolean;
}

function ConfirmScreen({ data, onConfirm, confirming, done }: ConfirmScreenProps) {
  const currency = useCurrency();
  if (done) {
    return (
      <div className="flex flex-col items-center py-16 text-center">
        <span className="text-6xl">🌟</span>
        <h2 className="mt-4 text-3xl font-bold text-neutral-900 dark:text-neutral-50">
          Prestige Achieved!
        </h2>
        <p className="mt-2 text-neutral-500">
          You have begun again — with honour. Your legacy grows.
        </p>
        <p className="mt-4 text-sm font-semibold text-amber-600">
          +{data.rewardsCoins.toLocaleString()} {currency.softPlural.toLowerCase()} awarded
        </p>
        <Link
          href="/profile"
          className="mt-8 rounded-xl bg-blue-600 px-8 py-3 font-semibold text-white hover:bg-blue-700"
        >
          Return to Profile
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Hero */}
      <div className="rounded-xl border border-neutral-200 bg-white p-6 text-center shadow-card dark:border-neutral-800 dark:bg-neutral-900">
        <span className="text-5xl">⭐</span>
        <h2 className="mt-3 text-2xl font-bold text-neutral-900 dark:text-neutral-50">
          You have mastered Zobia.
        </h2>
        <p className="mt-1 text-neutral-600 dark:text-neutral-400">
          You are a{" "}
          <span className="font-bold text-neutral-900 dark:text-neutral-100">
            {data.currentRankName}
          </span>
          . Do you want to Prestige and begin again — with honour?
        </p>
        {data.currentPrestige > 0 && (
          <p className="mt-2 text-sm text-amber-600">
            Current Prestige: {"⭐".repeat(Math.min(data.currentPrestige, 5))} ({data.currentPrestige})
          </p>
        )}
      </div>

      {/* What resets vs what stays */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-950/30">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-red-700 dark:text-red-300">
            <span>⚠</span> Resets
          </h3>
          <ul className="space-y-1.5 text-sm text-red-600 dark:text-red-400">
            <li>Main rank (back to Bronze I)</li>
          </ul>
        </div>

        <div className="rounded-xl border border-teal-200 bg-teal-50 p-4 dark:border-teal-800 dark:bg-teal-950/30">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-teal-700 dark:text-teal-300">
            <span>✓</span> Stays Forever
          </h3>
          <ul className="space-y-1.5 text-sm text-teal-600 dark:text-teal-400">
            <li>Track levels</li>
            <li>{currency.softPlural} balance</li>
            <li>Guild membership</li>
            <li>Legacy score</li>
            <li>Season history</li>
            <li>Friends &amp; followers</li>
          </ul>
        </div>
      </div>

      {/* Rewards */}
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/30">
        <h3 className="mb-3 text-sm font-semibold text-amber-700 dark:text-amber-300">
          Prestige Rewards
        </h3>
        <ul className="space-y-1.5 text-sm text-amber-700 dark:text-amber-400">
          <li>Prestige star on your profile</li>
          {data.rewardsFrame && <li>Exclusive frame: {data.rewardsFrame}</li>}
          {data.rewardsTitle && <li>Title: &quot;{data.rewardsTitle}&quot;</li>}
          <li>{data.rewardsCoins.toLocaleString()} {currency.softPlural.toLowerCase()}</li>
        </ul>
      </div>

      {/* Buttons */}
      <div className="flex flex-wrap gap-3">
        <button
          onClick={onConfirm}
          disabled={confirming}
          className="rounded-xl bg-blue-600 px-6 py-3 font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
        >
          {confirming ? "Processing…" : "Yes, Prestige"}
        </button>
        <Link
          href="/profile"
          className="rounded-xl border border-neutral-300 px-6 py-3 font-semibold text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
        >
          Not yet
        </Link>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

/**
 * Prestige flow page.
 */
export default function PrestigePage() {
  const router = useRouter();
  const [data, setData] = useState<PrestigeEligibility | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/prestige", { credentials: "include" });
        if (res.status === 401) { window.location.href = "/auth/login"; return; }
        if (!res.ok) throw new Error("Failed to load prestige info");

        const rawJson = await res.json() as Record<string, unknown>;
        // API returns { success, data: { eligible, prestigeCount, currentRank, requirements, rewards }, error }
        const d = (rawJson.data ?? rawJson) as {
          eligible?: boolean;
          prestigeCount?: number;
          currentRank?: { rankName?: string; level?: number; sublevel?: number };
          requirements?: { rank?: string; sublevel?: number };
          rewards?: { coins?: number; stars?: number; frame?: string; title?: string };
          // Direct fields (if already flat)
          currentRankName?: string;
          currentRankLevel?: number;
          currentPrestige?: number;
          requiredRankLevel?: number;
          rewardsFrame?: string;
          rewardsTitle?: string;
          rewardsCoins?: number;
        };

        const currentRankName = d.currentRankName ?? d.currentRank?.rankName ?? "Beginner";
        const rankIdx = RANK_ORDER.indexOf(currentRankName) + 1;

        setData({
          eligible: d.eligible ?? false,
          currentRankName,
          currentRankLevel: d.currentRankLevel ?? (rankIdx > 0 ? rankIdx : 1),
          currentPrestige: d.currentPrestige ?? d.prestigeCount ?? 0,
          requiredRankLevel: d.requiredRankLevel ?? RANK_ORDER.length,
          rewardsFrame: d.rewardsFrame ?? d.rewards?.frame ?? "",
          rewardsTitle: d.rewardsTitle ?? d.rewards?.title ?? "",
          rewardsCoins: d.rewardsCoins ?? d.rewards?.coins ?? 500,
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function handleConfirm() {
    setConfirming(true);
    try {
      const res = await fetch("/api/prestige", {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to prestige");
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to prestige");
    } finally {
      setConfirming(false);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-2xl p-4 sm:p-6">
        <PageSkeleton />
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-2xl p-4 sm:p-6">
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
        <Link
          href="/profile"
          className="mt-3 inline-block text-sm text-blue-600 hover:underline"
        >
          Back to Profile
        </Link>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="mx-auto max-w-2xl space-y-5 p-4 sm:p-6">
      <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-50">
        Prestige
      </h1>

      <PrestigeExplainer />

      {data.eligible ? (
        <ConfirmScreen
          data={data}
          onConfirm={handleConfirm}
          confirming={confirming}
          done={done}
        />
      ) : (
        <LockScreen data={data} />
      )}
    </div>
  );
}
