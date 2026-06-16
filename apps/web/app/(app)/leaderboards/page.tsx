"use client";

/**
 * app/(app)/leaderboards/page.tsx
 *
 * Leaderboards page with scope tabs (Global/City/Guild/Season)
 * and track filters. Current user's position is shown in a fixed footer.
 * Paginated results.
 */

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import Image from "next/image";
import { useTranslation } from "react-i18next";
import { translateApiError } from "@/lib/i18n/apiErrors";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Scope = "global" | "city" | "guild" | "season";
type Track = "main" | "social" | "creator" | "competitor" | "generosity" | "knowledge" | "explorer";
type Plan = "free" | "basic" | "pro" | "vip";

interface LeaderboardEntry {
  rank: number;
  userId: string;
  username: string;
  displayName: string;
  avatarEmoji: string;
  city: string;
  xp: number;
  plan: Plan;
  isCurrentUser: boolean;
  /** Positive = moved up in rank (improved), negative = dropped. */
  rankChange?: number;
  rank_change?: number;
  rankDelta?: number;
}

interface LeaderboardResponse {
  entries: LeaderboardEntry[];
  total: number;
  currentUserEntry: LeaderboardEntry | null;
  currentUserPage: number;
  userRank?: number | null;
}

interface SponsoredBanner {
  id: string;
  sponsorName: string;
  sponsorLogoUrl: string | null;
  ctaText: string;
  ctaUrl: string;
  startsAt: string;
  endsAt: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SCOPE_LABELS: Record<Scope, string> = {
  global: "Global",
  city: "City",
  guild: "Guild",
  season: "Season",
};

const TRACK_LABELS: Record<Track, string> = {
  main: "Main",
  social: "Social",
  creator: "Creator",
  competitor: "Competitor",
  generosity: "Generosity",
  knowledge: "Knowledge",
  explorer: "Explorer",
};

const PLAN_BADGE: Record<Plan, string> = {
  free: "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400",
  basic: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  pro: "bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-300",
  vip: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getRankChange(entry: LeaderboardEntry): number {
  return entry.rankChange ?? entry.rank_change ?? entry.rankDelta ?? 0;
}

const RANK_ANIMATION_STYLE = `
@keyframes ripple-up {
  0%   { box-shadow: 0 0 0 0 rgba(16,185,129,0.55); background-color: rgba(16,185,129,0.12); }
  50%  { box-shadow: 0 0 0 6px rgba(16,185,129,0.15); background-color: rgba(16,185,129,0.06); }
  100% { box-shadow: 0 0 0 0 rgba(16,185,129,0); background-color: transparent; }
}
@keyframes ripple-down {
  0%   { box-shadow: 0 0 0 0 rgba(239,68,68,0.55); background-color: rgba(239,68,68,0.12); }
  50%  { box-shadow: 0 0 0 6px rgba(239,68,68,0.15); background-color: rgba(239,68,68,0.06); }
  100% { box-shadow: 0 0 0 0 rgba(239,68,68,0); background-color: transparent; }
}
.rank-ripple-up   { animation: ripple-up   1.6s ease-out forwards; }
.rank-ripple-down { animation: ripple-down 1.6s ease-out forwards; }
`;

function RankAnimationStyles() {
  return <style dangerouslySetInnerHTML={{ __html: RANK_ANIMATION_STYLE }} />;
}

function rankMedal(rank: number): string {
  if (rank === 1) return "🥇";
  if (rank === 2) return "🥈";
  if (rank === 3) return "🥉";
  return "";
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function LeaderboardSkeleton() {
  return (
    <>
      {Array.from({ length: 10 }).map((_, i) => (
        <tr key={i}>
          <td className="px-4 py-3"><div className="h-4 w-8 animate-pulse rounded bg-neutral-200 dark:bg-neutral-700" /></td>
          <td className="px-4 py-3">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 animate-pulse rounded-full bg-neutral-200 dark:bg-neutral-700" />
              <div className="h-4 w-28 animate-pulse rounded bg-neutral-200 dark:bg-neutral-700" />
            </div>
          </td>
          <td className="px-4 py-3"><div className="h-4 w-20 animate-pulse rounded bg-neutral-200 dark:bg-neutral-700" /></td>
          <td className="px-4 py-3"><div className="h-4 w-16 animate-pulse rounded bg-neutral-200 dark:bg-neutral-700" /></td>
          <td className="px-4 py-3"><div className="h-4 w-12 animate-pulse rounded bg-neutral-200 dark:bg-neutral-700" /></td>
        </tr>
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// Entry row
// ---------------------------------------------------------------------------

function EntryRow({
  entry,
  highlight,
  ripple,
}: {
  entry: LeaderboardEntry;
  highlight?: boolean;
  ripple?: "up" | "down" | null;
}) {
  const rankChange = getRankChange(entry);
  const hasRankUp = rankChange > 0;
  const hasRankDown = rankChange < 0;
  const rippleClass = ripple === "up" || hasRankUp
    ? "rank-ripple-up"
    : ripple === "down" || hasRankDown
    ? "rank-ripple-down"
    : "";

  return (
    <tr
      className={`transition-colors ${rippleClass} ${
        highlight ? "bg-blue-50 dark:bg-blue-950/30" : "hover:bg-neutral-50 dark:hover:bg-neutral-800/50"
      }`}
    >
      <td className="px-4 py-3 text-sm font-bold tabular-nums text-neutral-700 dark:text-neutral-300">
        <div className="flex items-center gap-1">
          <span>{rankMedal(entry.rank)}</span>
          <span className={rankMedal(entry.rank) ? "ml-1" : ""}>{entry.rank}</span>
          {(ripple === "up" || hasRankUp) && (
            <span className="ml-1 text-xs font-semibold text-teal-600 dark:text-teal-400"
                  title={`Moved up ${rankChange} place${rankChange !== 1 ? "s" : ""}`}>
              ▲{rankChange > 0 ? rankChange : ""}
            </span>
          )}
          {(ripple === "down" || hasRankDown) && (
            <span className="ml-1 text-xs font-semibold text-red-500 dark:text-red-400"
                  title={`Dropped ${Math.abs(rankChange)} place${Math.abs(rankChange) !== 1 ? "s" : ""}`}>
              ▼{Math.abs(rankChange) > 0 ? Math.abs(rankChange) : ""}
            </span>
          )}
        </div>
      </td>
      <td className="px-4 py-3">
        <Link href={`/profile/${entry.userId}`} className="flex items-center gap-2 hover:underline">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-neutral-100 text-lg dark:bg-neutral-800">
            {entry.avatarEmoji}
          </span>
          <div>
            <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{entry.displayName}</p>
            <p className="text-xs text-neutral-400">@{entry.username}</p>
          </div>
        </Link>
      </td>
      <td className="px-4 py-3 text-sm text-neutral-500">{entry.city || "—"}</td>
      <td className="px-4 py-3 text-sm font-semibold tabular-nums text-neutral-800 dark:text-neutral-200">
        {entry.xp.toLocaleString()}
      </td>
      <td className="px-4 py-3">
        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${PLAN_BADGE[entry.plan]}`}>
          {entry.plan}
        </span>
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

/**
 * Leaderboards page with scope and track filtering.
 */
export default function LeaderboardsPage() {
  const { t: translate } = useTranslation();
  const [scope, setScope] = useState<Scope>("global");
  const [track, setTrack] = useState<Track>("main");
  const [data, setData] = useState<LeaderboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [banner, setBanner] = useState<SponsoredBanner | null>(null);
  const [rankRipple, setRankRipple] = useState<"up" | "down" | null>(null);
  const perPage = 20;

  const fetchData = useCallback(async (s: Scope, t: Track, p: number) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ scope: s, track: t, page: String(p), limit: String(perPage) });
      const res = await fetch(`/api/leaderboards?${params}`, { credentials: "include" });
      if (res.status === 401) { window.location.href = "/auth/login"; return; }
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: { code?: string; message?: string } };
        const err = new Error(body.error?.message ?? "Failed to load leaderboard") as Error & { code?: string | null };
        err.code = body.error?.code ?? null;
        throw err;
      }
      const json = await res.json();
      // API wraps response under `data`; normalise to LeaderboardResponse
      const apiData = json.data ?? json;
      const rawEntries: Record<string, unknown>[] = apiData.entries ?? [];
      const entries: LeaderboardEntry[] = rawEntries.map((e) => ({
        rank: (e.rank as number) ?? 0,
        userId: ((e.user_id ?? e.userId) as string) ?? "",
        username: (e.username as string) ?? "",
        displayName: ((e.display_name ?? e.displayName) as string) ?? "",
        avatarEmoji: ((e.avatar_emoji ?? e.avatarEmoji) as string) ?? "😊",
        city: (e.city as string) ?? "",
        xp: ((e.xp_value ?? e.xp) as number) ?? 0,
        plan: ((e.plan as Plan) ?? "free"),
        isCurrentUser: false,
        rankChange: (e.rankChange as number) ?? (e.rank_change as number) ?? 0,
      }));
      setData({
        entries,
        total: (apiData.total as number) ?? 0,
        currentUserEntry: null,
        currentUserPage: 1,
        userRank: (apiData.userRank as number) ?? null,
      });
    } catch (e) {
      const err = e as Error & { code?: string | null };
      setError(e instanceof Error ? translateApiError(translate, err.code, err.message || "Unknown error") : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch sponsored banner (once on mount, public endpoint)
  useEffect(() => {
    fetch("/api/leaderboards/banner")
      .then((r) => r.ok ? r.json() : null)
      .then((json) => {
        if (json?.data?.banner) setBanner(json.data.banner as SponsoredBanner);
      })
      .catch(() => {/* non-fatal */});
  }, []);

  // Check for rank-change ripple notification (PRD §5)
  useEffect(() => {
    fetch("/api/notifications?type=leaderboard_rank_change&limit=1&unread=true", { credentials: "include" })
      .then((r) => r.ok ? r.json() : null)
      .then((json: { items?: Array<{ payload?: { direction?: string } }> } | null) => {
        const notif = json?.items?.[0];
        if (notif?.payload?.direction === "up") setRankRipple("up");
        else if (notif?.payload?.direction === "down") setRankRipple("down");
        else if (notif) setRankRipple("up");
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    setPage(1);
    void fetchData(scope, track, 1);
  }, [scope, track, fetchData]);

  function handlePageChange(p: number) {
    setPage(p);
    void fetchData(scope, track, p);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const totalPages = data ? Math.ceil(data.total / perPage) : 0;
  const currentUser = data?.currentUserEntry;
  const isCurrentUserVisible = currentUser == null || (data?.entries ?? []).some((e) => e.isCurrentUser);

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4 sm:p-6">
      <RankAnimationStyles />
      <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-50">Leaderboards</h1>

      {/* Scope tabs */}
      <div className="flex flex-wrap gap-1 rounded-xl border border-neutral-200 bg-neutral-100 p-1 dark:border-neutral-800 dark:bg-neutral-800/50">
        {(Object.keys(SCOPE_LABELS) as Scope[]).map((s) => (
          <button
            key={s}
            onClick={() => setScope(s)}
            className={`flex-1 rounded-lg py-2 text-sm font-semibold transition-colors ${scope === s ? "bg-white text-neutral-900 shadow-card dark:bg-neutral-900 dark:text-neutral-50" : "text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"}`}
          >
            {SCOPE_LABELS[s]}
          </button>
        ))}
      </div>

      {/* Track filter */}
      <div className="flex flex-wrap gap-1.5">
        {(Object.keys(TRACK_LABELS) as Track[]).map((t) => (
          <button
            key={t}
            onClick={() => setTrack(t)}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${track === t ? "bg-blue-600 text-white" : "bg-neutral-100 text-neutral-700 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-300"}`}
          >
            {TRACK_LABELS[t]}
          </button>
        ))}
      </div>

      {/* Sponsored banner */}
      {banner && (
        <a
          href={banner.ctaUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 transition-colors hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-950/40 dark:hover:bg-amber-900/40"
        >
          <div className="flex items-center gap-3 min-w-0">
            {banner.sponsorLogoUrl && (
              <Image
                src={banner.sponsorLogoUrl}
                alt={banner.sponsorName}
                width={32}
                height={32}
                unoptimized
                className="h-8 w-8 flex-shrink-0 rounded-md object-contain"
              />
            )}
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400">
                Sponsored
              </p>
              <p className="truncate text-sm font-semibold text-neutral-800 dark:text-neutral-100">
                {banner.sponsorName}
              </p>
            </div>
          </div>
          <span className="flex-shrink-0 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-bold text-white">
            {banner.ctaText}
          </span>
        </a>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">{error}</div>
      )}

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white shadow-card dark:border-neutral-800 dark:bg-neutral-900">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-200 text-xs uppercase tracking-wider text-neutral-500 dark:border-neutral-800">
              {["Rank", "Player", "City", "XP", "Plan"].map((h) => (
                <th key={h} className="px-4 py-3 text-left font-semibold">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {loading ? (
              <LeaderboardSkeleton />
            ) : !data || data.entries.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-12 text-center text-neutral-500">No entries yet</td>
              </tr>
            ) : (
              data.entries.map((e) => (
                <EntryRow key={e.userId} entry={e} highlight={e.isCurrentUser} ripple={e.isCurrentUser ? rankRipple : null} />
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-neutral-500">
          <span>{data?.total.toLocaleString()} players</span>
          <div className="flex items-center gap-2">
            <button
              disabled={page === 1}
              onClick={() => handlePageChange(page - 1)}
              className="rounded-lg border border-neutral-200 px-3 py-1.5 disabled:opacity-40 hover:bg-neutral-50 dark:border-neutral-700"
            >
              ← Prev
            </button>
            <span className="tabular-nums">Page {page} of {totalPages}</span>
            <button
              disabled={page >= totalPages}
              onClick={() => handlePageChange(page + 1)}
              className="rounded-lg border border-neutral-200 px-3 py-1.5 disabled:opacity-40 hover:bg-neutral-50 dark:border-neutral-700"
            >
              Next →
            </button>
          </div>
        </div>
      )}

      {/* Current user sticky footer (when not in visible range) */}
      {currentUser && !isCurrentUserVisible && (
        <div className="sticky bottom-4 rounded-xl border border-blue-300 bg-blue-50 px-3 py-2 shadow-modal dark:border-blue-700 dark:bg-blue-950/50">
          <p className="mb-1.5 text-xs font-semibold text-blue-600 dark:text-blue-400">Your Position</p>
          <table className="w-full">
            <tbody>
              <EntryRow entry={currentUser} highlight ripple={rankRipple} />
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
