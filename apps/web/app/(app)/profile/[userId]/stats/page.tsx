"use client";

/**
 * app/(app)/profile/[userId]/stats/page.tsx
 *
 * User Profile Stats page (PRD §15).
 *
 * A central hub for a user's badges, levels, achievements, created rooms,
 * leaderboard positions, and social counts (friends/followers/referrals).
 * Visible only to the profile owner and to moderators/admins — loaded only
 * when the user navigates here (never eagerly fetched from the profile page).
 *
 * Free users get the "Basic" view; plans/prestige tiers configured at
 * Admin > Profile Stats get the "Full" view (all leaderboard scopes +
 * season history). Gated by the feature_profile_stats admin toggle.
 */

import { useState, useEffect, useRef } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import { translateApiError } from "@/lib/i18n/apiErrors";
import { RANK_COLORS } from "@/lib/xp/rankColors";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TrackStat {
  track: string;
  label: string;
  emoji: string;
  level: number;
  xp: number;
}

interface BadgeStat {
  key: string;
  type: string;
  label: string;
  grantedAt: string;
}

interface CreatedRoom {
  id: string;
  name: string;
  coverEmoji: string;
  memberCount: number;
}

interface LeaderboardRow {
  track: string;
  globalRank: number | null;
  cityRank: number | null;
  guildRank: number | null;
  seasonRank: number | null;
}

interface SeasonStat {
  id: string;
  name: string;
  themeEmoji: string;
  year: number;
  finalRank: number | null;
}

interface StatsResponse {
  tier: "basic" | "full";
  isOwnStats: boolean;
  profile: {
    id: string;
    username: string | null;
    displayName: string;
    avatarEmoji: string;
    city: string | null;
    joinedAt: string;
    plan: string;
    isCreator: boolean;
    rankName: string;
    rankSublevel: number;
    xpTotal: number;
    xpForNextRank: number;
    legacyScore: number;
    prestigeCount: number;
  };
  tracks: TrackStat[];
  badges: BadgeStat[];
  guild: { id: string | null; name: string; crestEmoji: string; tier: string } | null;
  social: {
    friendsCount: number;
    followersCount: number;
    followingCount: number;
    referralsCount: number;
    qualifiedReferralsCount: number;
  };
  createdRooms: CreatedRoom[];
  leaderboard: LeaderboardRow[];
  seasonHistory: SeasonStat[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TRACK_LABELS: Record<string, string> = {
  main: "Overall",
  social: "Social",
  creator: "Creator",
  competitor: "Competitor",
  generosity: "Generosity",
  gaming: "Gaming",
  knowledge: "Knowledge",
  explorer: "Explorer",
};

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function StatsSkeleton() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="h-28 rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900" />
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="h-24 rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900" />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Track bar
// ---------------------------------------------------------------------------

function TrackBar({ track }: { track: TrackStat }) {
  const xpPerLevel = 1000;
  const pct = Math.min(100, Math.round(((track.xp % xpPerLevel) / xpPerLevel) * 100));
  return (
    <div className="flex items-center gap-3">
      <span className="w-5 text-center text-base">{track.emoji}</span>
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-xs font-medium text-neutral-700 dark:text-neutral-300">{track.label}</span>
          <span className="text-xs font-semibold tabular-nums text-neutral-500">Lv {track.level}</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-700">
          <div className="h-full rounded-full bg-blue-500 transition-all" style={{ width: `${pct}%` }} />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Social count tile
// ---------------------------------------------------------------------------

function CountTile({ label, value, emoji }: { label: string; value: number; emoji: string }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4 text-center shadow-card dark:border-neutral-800 dark:bg-neutral-900">
      <p className="text-xl">{emoji}</p>
      <p className="mt-1 text-lg font-bold text-neutral-900 dark:text-neutral-50">{value.toLocaleString()}</p>
      <p className="text-xs text-neutral-500">{label}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function ProfileStatsPage() {
  const params = useParams();
  const { t } = useTranslation();
  const tRef = useRef(t);
  useEffect(() => { tRef.current = t; }, [t]);
  const userId = params.userId as string;

  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  useEffect(() => {
    if (!userId || userId === "undefined") {
      setError("Stats not found");
      setLoading(false);
      return;
    }
    (async () => {
      try {
        const res = await fetch(`/api/users/${userId}/stats`, { credentials: "include" });
        if (!res.ok) {
          const body = await res.json().catch(() => ({})) as { error?: { code?: string; message?: string } };
          const err = new Error(body.error?.message ?? "Could not load stats") as Error & { code?: string | null };
          err.code = body.error?.code ?? null;
          throw err;
        }
        setStats(await res.json());
      } catch (e) {
        const err = e as Error & { code?: string | null };
        setErrorCode(err.code ?? null);
        setError(e instanceof Error ? translateApiError(tRef.current, err.code, err.message || "Unknown error") : "Unknown error");
      } finally {
        setLoading(false);
      }
    })();
  }, [userId]);

  if (loading) return <div className="mx-auto max-w-2xl p-4 sm:p-6"><StatsSkeleton /></div>;

  if (error || !stats) {
    const icon = errorCode === "FORBIDDEN" ? "🔒" : errorCode === "FEATURE_DISABLED" ? "🚧" : "😕";
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <span className="mb-3 text-5xl">{icon}</span>
        <p className="text-base font-semibold text-neutral-700 dark:text-neutral-300">
          {errorCode === "FORBIDDEN" ? t("profile.stats.private") : t("profile.stats.notFound")}
        </p>
        <p className="mt-1 max-w-xs text-sm text-neutral-500">{error ?? t("profile.stats.notAvailable")}</p>
        <Link href={`/profile/${userId}`} className="mt-4 text-sm text-blue-600 hover:underline">{t("profile.stats.backToProfile")}</Link>
      </div>
    );
  }

  const { profile } = stats;
  const ringColor = RANK_COLORS[profile.rankName] ?? "#6b7280";
  const subLabel = `${profile.rankName} ${["I", "II", "III"][profile.rankSublevel - 1] ?? "I"}`;
  const mainRank = stats.leaderboard.find((r) => r.track === "main");

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4 sm:p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-50">{t("profile.stats.title")}</h1>
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
          stats.tier === "full"
            ? "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300"
            : "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400"
        }`}>
          {stats.tier === "full" ? t("profile.stats.tierFull") : t("profile.stats.tierBasic")}
        </span>
      </div>

      {/* Profile summary */}
      <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-card dark:border-neutral-800 dark:bg-neutral-900">
        <div className="flex items-center gap-4">
          <div
            className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-3xl dark:bg-neutral-800"
            style={{ boxShadow: `0 0 0 3px ${ringColor}` }}
          >
            {profile.avatarEmoji}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-bold text-neutral-900 dark:text-neutral-50">{profile.displayName}</h2>
              {profile.prestigeCount > 0 && (
                <span className="text-amber-500" title={`Prestige ${profile.prestigeCount}`}>
                  {"★".repeat(Math.min(profile.prestigeCount, 10))}
                </span>
              )}
            </div>
            <p className="text-sm text-neutral-500">@{profile.username ?? "—"}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="rounded-full px-2.5 py-0.5 text-xs font-bold text-white" style={{ backgroundColor: ringColor }}>
                {subLabel}
              </span>
              <span className="text-xs text-neutral-500">{profile.xpTotal.toLocaleString()} XP</span>
              {profile.legacyScore > 0 && (
                <span className="text-xs text-amber-600">⚜️ {profile.legacyScore.toLocaleString()} Legacy</span>
              )}
              {mainRank?.globalRank && (
                <span className="text-xs text-blue-600 dark:text-blue-400">🌍 Global #{mainRank.globalRank}</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Basic-tier upsell */}
      {stats.tier === "basic" && stats.isOwnStats && (
        <Link
          href="/settings/subscription"
          className="flex items-center gap-3 rounded-xl border border-dashed border-amber-300 bg-amber-50 p-4 shadow-card transition-colors hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/30 dark:hover:bg-amber-950/50"
        >
          <span className="text-2xl">⚡</span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">{t("profile.stats.unlockFull")}</p>
            <p className="text-xs text-amber-700 dark:text-amber-400">{t("profile.stats.unlockFullDesc")}</p>
          </div>
          <span className="text-xs text-amber-600 dark:text-amber-400">→</span>
        </Link>
      )}

      {/* Progression Tracks */}
      <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-card dark:border-neutral-800 dark:bg-neutral-900">
        <h2 className="mb-4 text-sm font-semibold text-neutral-700 dark:text-neutral-300">{t("profile.progressionTracks")}</h2>
        <div className="space-y-3">
          {stats.tracks.map((tr) => <TrackBar key={tr.track} track={tr} />)}
        </div>
      </div>

      {/* Social counts */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <CountTile label={t("profile.stats.friends")} value={stats.social.friendsCount} emoji="🤝" />
        <CountTile label={t("profile.followers")} value={stats.social.followersCount} emoji="👥" />
        <CountTile label={t("profile.following")} value={stats.social.followingCount} emoji="➡️" />
        <CountTile label={t("profile.stats.referrals")} value={stats.social.referralsCount} emoji="🔗" />
      </div>

      {/* Guild */}
      {stats.guild && (
        <Link
          href={`/guilds/${stats.guild.id}`}
          className="flex items-center gap-3 rounded-xl border border-neutral-200 bg-white p-4 shadow-card transition-colors hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900 dark:hover:bg-neutral-800"
        >
          <span className="text-2xl">{stats.guild.crestEmoji}</span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-neutral-900 dark:text-neutral-50">{stats.guild.name}</p>
            <p className="text-xs capitalize text-neutral-500">{stats.guild.tier.replace(/_/g, " ")} Guild</p>
          </div>
          <span className="text-xs text-neutral-400">→</span>
        </Link>
      )}

      {/* Badges / Achievements */}
      <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-card dark:border-neutral-800 dark:bg-neutral-900">
        <h2 className="mb-3 text-sm font-semibold text-neutral-700 dark:text-neutral-300">🏆 {t("profile.stats.badgesAchievements")} ({stats.badges.length})</h2>
        {stats.badges.length === 0 ? (
          <p className="text-sm text-neutral-500">{t("profile.stats.noBadges")}</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {stats.badges.map((b) => (
              <span
                key={b.key}
                title={`Earned ${new Date(b.grantedAt).toLocaleDateString()}`}
                className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold capitalize text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300"
              >
                {b.label}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Created rooms */}
      {profile.isCreator && stats.createdRooms.length > 0 && (
        <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-card dark:border-neutral-800 dark:bg-neutral-900">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">🎨 {t("profile.stats.createdRooms")} ({stats.createdRooms.length})</h2>
            <Link href={`/rooms?creator_id=${userId}`} className="text-xs text-blue-600 hover:underline dark:text-blue-400">
              {t("profile.stats.viewAllRooms")} →
            </Link>
          </div>
          <div className="space-y-2">
            {stats.createdRooms.map((room) => (
              <Link
                key={room.id}
                href={`/rooms/${room.id}`}
                className="flex items-center gap-3 rounded-lg border border-neutral-100 p-3 transition-colors hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-800"
              >
                <span className="text-xl">{room.coverEmoji}</span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-neutral-800 dark:text-neutral-200">{room.name}</span>
                <span className="shrink-0 text-xs text-neutral-500">👥 {room.memberCount.toLocaleString()}</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Leaderboard positions — full tier only shows the detailed grid */}
      {stats.tier === "full" && (
        <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-card dark:border-neutral-800 dark:bg-neutral-900">
          <h2 className="mb-3 text-sm font-semibold text-neutral-700 dark:text-neutral-300">🏅 {t("profile.stats.leaderboardPositions")}</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-neutral-500">
                  <th className="pb-2 pr-3">{t("profile.stats.trackColumn")}</th>
                  <th className="pb-2 pr-3">{t("profile.stats.globalColumn")}</th>
                  <th className="pb-2 pr-3">{t("profile.stats.cityColumn")}</th>
                  <th className="pb-2 pr-3">{t("profile.stats.guildColumn")}</th>
                  <th className="pb-2">{t("profile.stats.seasonColumn")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                {stats.leaderboard.map((row) => (
                  <tr key={row.track}>
                    <td className="py-2 pr-3 font-medium text-neutral-800 dark:text-neutral-200">{TRACK_LABELS[row.track] ?? row.track}</td>
                    <td className="py-2 pr-3 tabular-nums text-neutral-600 dark:text-neutral-400">{row.globalRank ? `#${row.globalRank}` : "—"}</td>
                    <td className="py-2 pr-3 tabular-nums text-neutral-600 dark:text-neutral-400">{row.cityRank ? `#${row.cityRank}` : "—"}</td>
                    <td className="py-2 pr-3 tabular-nums text-neutral-600 dark:text-neutral-400">{row.guildRank ? `#${row.guildRank}` : "—"}</td>
                    <td className="py-2 tabular-nums text-neutral-600 dark:text-neutral-400">{row.seasonRank ? `#${row.seasonRank}` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Season history — full tier only */}
      {stats.tier === "full" && stats.seasonHistory.length > 0 && (
        <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-card dark:border-neutral-800 dark:bg-neutral-900">
          <h2 className="mb-3 text-sm font-semibold text-neutral-700 dark:text-neutral-300">{t("profile.seasonHistory")}</h2>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {stats.seasonHistory.map((s) => (
              <div key={s.id} className="rounded-lg border border-neutral-100 bg-neutral-50 p-2 text-center dark:border-neutral-800 dark:bg-neutral-800">
                <p className="text-xs text-neutral-500">{s.year}</p>
                <p className="mt-0.5 truncate text-xs font-bold text-neutral-900 dark:text-neutral-100">{s.name}</p>
                {s.finalRank && <p className="text-sm font-bold text-amber-600">#{s.finalRank}</p>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
