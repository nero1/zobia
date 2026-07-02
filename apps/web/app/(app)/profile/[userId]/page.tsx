"use client";

/**
 * app/(app)/profile/[userId]/page.tsx
 *
 * Public profile page.
 * Shows avatar, rank ring, XP progress, track level bars,
 * prestige stars, guild badge, season history, and action buttons.
 */

import { useState, useEffect, useRef } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import { OnlineRing } from "@/components/ui/OnlineRing";
import { translateApiError } from "@/lib/i18n/apiErrors";
import { VerifiedBadge } from "@/components/shared/VerifiedBadge";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TrackLevel {
  track: string;
  label: string;
  level: number;
  maxLevel: number;
  xp: number;
  xpForNext: number;
  emoji: string;
}

interface SeasonSummary {
  id: string;
  name: string;
  rank: number;
  tier: string;
  year: number;
}

interface Achievement {
  key: string;
  type: string;
  label: string;
  grantedAt: string;
}

interface CreatorRoom {
  id: string;
  name: string;
  coverEmoji: string;
  memberCount?: number;
}

interface UserProfile {
  id: string;
  username: string;
  displayName: string;
  avatarEmoji: string;
  city: string;
  joinedAt: string;
  rankName: string;
  rankColor: string; // hex color for ring
  rankLevel: number;
  xp: number;
  xpForNextRank: number;
  prestige: number; // number of prestige stars, 0 if none
  plan: string;
  isModerator: boolean;
  isVerified?: boolean;
  isCreator: boolean;
  creatorBio: string | null;
  creatorCategory: string | null;
  creatorRooms: CreatorRoom[];
  creatorRoomCount: number;
  subscriberCount: number | null;
  totalEarningsKobo: number | null;
  canViewStats: boolean;
  guildId: string | null;
  guildName: string | null;
  guildEmblem: string | null;
  tracks: TrackLevel[];
  seasonHistory: SeasonSummary[];
  achievements: Achievement[];
  isOwnProfile: boolean;
  isFriend: boolean;
  isFollowing: boolean;
  legacyScore: number;
  connectionBadge: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatYear(iso: string): string {
  return new Date(iso).toLocaleDateString("en-NG", { month: "long", year: "numeric" });
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function ProfileSkeleton() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="rounded-xl border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900">
        <div className="flex gap-4">
          <div className="h-20 w-20 rounded-full bg-neutral-200 dark:bg-neutral-700" />
          <div className="flex-1 space-y-3">
            <div className="h-6 w-40 rounded bg-neutral-200 dark:bg-neutral-700" />
            <div className="h-4 w-24 rounded bg-neutral-200 dark:bg-neutral-700" />
            <div className="h-3 w-full rounded bg-neutral-200 dark:bg-neutral-700" />
          </div>
        </div>
      </div>
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="h-16 animate-pulse rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900" />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Track level bar
// ---------------------------------------------------------------------------

function TrackBar({ track }: { track: TrackLevel }) {
  const pct = track.xpForNext > 0 ? Math.min(100, Math.round((track.xp / track.xpForNext) * 100)) : 100;
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
// Season card
// ---------------------------------------------------------------------------

function SeasonCard({ season }: { season: SeasonSummary }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-3 text-center dark:border-neutral-800 dark:bg-neutral-900">
      <p className="text-xs font-semibold text-neutral-500">{season.year}</p>
      <p className="mt-0.5 truncate text-sm font-bold text-neutral-900 dark:text-neutral-100">{season.name}</p>
      <p className="mt-1 text-xs text-neutral-500">{season.tier}</p>
      <p className="text-lg font-bold text-amber-600">#{season.rank}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

/**
 * Public user profile page.
 */
export default function ProfilePage() {
  const params = useParams();
  const { t } = useTranslation();
  const tRef = useRef(t);
  useEffect(() => { tRef.current = t; }, [t]);
  const userId = params.userId as string;
  type PrivacyError = "PROFILE_PRIVATE" | "ACCOUNT_RESTRICTED" | "ACCOUNT_SUSPENDED" | null;
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [privacyCode, setPrivacyCode] = useState<PrivacyError>(null);
  const [friendBusy, setFriendBusy] = useState(false);
  const [followBusy, setFollowBusy] = useState(false);
  const [isFriend, setIsFriend] = useState(false);
  const [isFollowing, setIsFollowing] = useState(false);

  useEffect(() => {
    if (!userId || userId === "undefined") {
      setError("Profile not found");
      setLoading(false);
      return;
    }
    (async () => {
      try {
        const res = await fetch(`/api/users/${userId}/profile`, { credentials: "include" });
        if (res.status === 403) {
          const body = await res.json().catch(() => ({})) as { code?: string; error?: string };
          setPrivacyCode((body.code ?? "PROFILE_PRIVATE") as PrivacyError);
          setError(body.error ?? "This profile is not available.");
          return;
        }
        if (!res.ok) {
          const body = await res.json().catch(() => ({})) as { error?: { code?: string; message?: string } };
          const err = new Error(body.error?.message ?? "Profile not found") as Error & { code?: string | null };
          err.code = body.error?.code ?? null;
          throw err;
        }
        const { profile: p } = await res.json() as { profile: UserProfile & { legacy_score?: number; connection_badge?: string | null } };
        setProfile({
          ...p,
          legacyScore: p.legacyScore ?? p.legacy_score ?? 0,
          connectionBadge: p.connectionBadge ?? p.connection_badge ?? null,
        });
        setIsFriend(p.isFriend);
        setIsFollowing(p.isFollowing);
      } catch (e) {
        const err = e as Error & { code?: string | null };
        setError(e instanceof Error ? translateApiError(tRef.current, err.code, err.message || "Unknown error") : "Unknown error");
      } finally {
        setLoading(false);
      }
    })();
  }, [userId]);

  async function handleFriend() {
    if (!profile) return;
    setFriendBusy(true);
    try {
      await fetch(`/api/users/${userId}/${isFriend ? "unfriend" : "friend"}`, { method: "POST", credentials: "include" });
      setIsFriend((f) => !f);
    } catch { /* ignore */ }
    setFriendBusy(false);
  }

  async function handleFollow() {
    if (!profile) return;
    setFollowBusy(true);
    try {
      await fetch(`/api/users/${userId}/${isFollowing ? "unfollow" : "follow"}`, { method: "POST", credentials: "include" });
      setIsFollowing((f) => !f);
    } catch { /* ignore */ }
    setFollowBusy(false);
  }

  if (loading) return <div className="p-4 sm:p-6"><ProfileSkeleton /></div>;

  if (error || !profile) {
    const icon = privacyCode === "PROFILE_PRIVATE" ? "🔒"
      : privacyCode === "ACCOUNT_RESTRICTED" || privacyCode === "ACCOUNT_SUSPENDED" ? "🚫"
      : "😕";
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <span className="mb-3 text-5xl">{icon}</span>
        <p className="text-base font-semibold text-neutral-700 dark:text-neutral-300">
          {privacyCode === "PROFILE_PRIVATE" ? "This profile is private"
            : privacyCode === "ACCOUNT_RESTRICTED" ? "This account has been restricted"
            : privacyCode === "ACCOUNT_SUSPENDED" ? "This account is temporarily suspended"
            : "Profile not found"}
        </p>
        <p className="mt-1 max-w-xs text-sm text-neutral-500">{error ?? "The profile you're looking for doesn't exist or isn't available."}</p>
        <Link href="/" className="mt-4 text-sm text-blue-600 hover:underline">← Back to Home</Link>
      </div>
    );
  }

  const rankXpPct = profile.xpForNextRank > 0 ? Math.min(100, Math.round((profile.xp / profile.xpForNextRank) * 100)) : 100;

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4 sm:p-6">
      {/* Profile card */}
      <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-card dark:border-neutral-800 dark:bg-neutral-900">
        <div className="flex flex-wrap gap-4">
          {/* Avatar with rank ring + presence indicator */}
          <OnlineRing userId={profile.id} size="lg">
            <div
              className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-5xl dark:bg-neutral-800"
              style={{ boxShadow: `0 0 0 3px ${profile.rankColor}` }}
              title={profile.rankName}
            >
              {profile.avatarEmoji}
            </div>
          </OnlineRing>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="flex items-center gap-1.5 text-xl font-bold text-neutral-900 dark:text-neutral-50">
                {profile.displayName}
                <VerifiedBadge show={profile.isVerified} size="md" />
              </h1>
              {profile.prestige > 0 && (
                <span className="text-base" title={`Prestige ${profile.prestige}`}>
                  {"⭐".repeat(Math.min(profile.prestige, 5))}
                </span>
              )}
            </div>
            <p className="text-sm text-neutral-500">@{profile.username}</p>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-neutral-500">
              {profile.city && <span>📍 {profile.city}</span>}
              <span>Playing since {formatYear(profile.joinedAt)}</span>
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              {profile.legacyScore > 0 && (
                <div className="flex items-center gap-1.5 text-sm text-neutral-500 dark:text-neutral-400">
                  <span>⚜️</span>
                  <span>Legacy Score: <span className="font-semibold text-neutral-700 dark:text-neutral-300">{profile.legacyScore.toLocaleString()}</span></span>
                </div>
              )}
              {profile.connectionBadge && (
                <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-700 dark:bg-blue-900 dark:text-blue-300">
                  🔗 {profile.connectionBadge}
                </span>
              )}
            </div>

            {/* Rank badge */}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span
                className="rounded-full px-2.5 py-0.5 text-xs font-bold text-white"
                style={{ backgroundColor: profile.rankColor }}
              >
                {profile.rankName}
              </span>
              {profile.guildId && profile.guildName && (
                <Link
                  href={`/guilds/${profile.guildId}`}
                  className="flex items-center gap-1 rounded-full border border-neutral-200 px-2 py-0.5 text-xs font-semibold text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
                >
                  {profile.guildEmblem} {profile.guildName}
                </Link>
              )}
            </div>
          </div>
        </div>

        {/* XP progress */}
        <div className="mt-4">
          <div className="mb-1 flex items-center justify-between text-xs text-neutral-500">
            <span>Rank XP — Level {profile.rankLevel}</span>
            <span className="tabular-nums">{profile.xp.toLocaleString()} / {profile.xpForNextRank.toLocaleString()}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-700">
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${rankXpPct}%`, backgroundColor: profile.rankColor }}
            />
          </div>
        </div>

        {/* Action buttons */}
        {(!profile.isOwnProfile || profile.canViewStats) && (
          <div className="mt-4 flex flex-wrap gap-2">
            {!profile.isOwnProfile && (
              <>
                <button
                  onClick={handleFriend}
                  disabled={friendBusy}
                  className={`rounded-xl px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-60 ${isFriend ? "border border-neutral-300 text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300" : "bg-blue-600 text-white hover:bg-blue-700"}`}
                >
                  {friendBusy ? "…" : isFriend ? "Unfriend" : "Add Friend"}
                </button>
                <button
                  onClick={handleFollow}
                  disabled={followBusy}
                  className={`rounded-xl px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-60 ${isFollowing ? "border border-neutral-300 text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300" : "border border-blue-600 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/30"}`}
                >
                  {followBusy ? "…" : isFollowing ? "Unfollow" : "Follow"}
                </button>
                <Link
                  href={`/gifts?recipientId=${encodeURIComponent(userId)}&username=${encodeURIComponent(profile.username)}`}
                  className="rounded-xl border border-amber-300 px-4 py-2 text-sm font-semibold text-amber-600 hover:bg-amber-50 dark:border-amber-700 dark:text-amber-400 dark:hover:bg-amber-950/30"
                >
                  🎁 Gift
                </Link>
              </>
            )}
            {profile.canViewStats && (
              <Link
                href={`/profile/${userId}/stats`}
                className="rounded-xl border border-neutral-300 px-4 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
              >
                📊 Stats
              </Link>
            )}
          </div>
        )}
      </div>

      {/* Track levels */}
      <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-card dark:border-neutral-800 dark:bg-neutral-900">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-neutral-500">Track Levels</h2>
        <div className="space-y-3">
          {profile.tracks.map((t) => (
            <TrackBar key={t.track} track={t} />
          ))}
        </div>
      </div>

      {/* Creator card (PRD §15) */}
      {profile.isCreator && (
        <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-card dark:border-neutral-800 dark:bg-neutral-900">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-neutral-500">
            🎨 Creator
            {profile.creatorCategory && (
              <span className="ml-2 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-700 dark:bg-blue-900 dark:text-blue-300 capitalize">
                {profile.creatorCategory}
              </span>
            )}
          </h2>
          {profile.creatorBio && (
            <p className="mb-3 text-sm text-neutral-600 dark:text-neutral-400">{profile.creatorBio}</p>
          )}
          {profile.creatorRooms.length > 0 && (
            <div className="mb-3 space-y-1.5">
              {profile.creatorRooms.map((room) => (
                <Link
                  key={room.id}
                  href={`/rooms/${room.id}`}
                  className="flex items-center gap-2 rounded-xl border border-neutral-200 px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
                >
                  <span>{room.coverEmoji}</span>
                  <span className="min-w-0 flex-1 truncate">{room.name}</span>
                  {room.memberCount !== undefined && (
                    <span className="shrink-0 text-xs text-neutral-500">👥 {room.memberCount.toLocaleString()}</span>
                  )}
                </Link>
              ))}
              {profile.creatorRoomCount > profile.creatorRooms.length && (
                <Link
                  href={`/rooms?creator_id=${userId}`}
                  className="block text-center text-xs font-semibold text-blue-600 hover:underline dark:text-blue-400"
                >
                  See all {profile.creatorRoomCount} rooms by {profile.displayName} →
                </Link>
              )}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-3">
            {profile.subscriberCount !== null && (
              <span className="text-sm text-neutral-500">
                👥 <span className="font-semibold text-neutral-700 dark:text-neutral-300">{profile.subscriberCount.toLocaleString()}</span> members
              </span>
            )}
            {profile.totalEarningsKobo !== null && profile.totalEarningsKobo > 0 && (
              <span className="text-sm text-neutral-500">
                💰 ₦{(profile.totalEarningsKobo / 100).toLocaleString()} earned
              </span>
            )}
          </div>
        </div>
      )}

      {/* Season history */}
      {profile.seasonHistory.length > 0 && (
        <div>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-neutral-500">Season History</h2>
          <div className="grid grid-cols-3 gap-3">
            {profile.seasonHistory.map((s) => (
              <SeasonCard key={s.id} season={s} />
            ))}
          </div>
        </div>
      )}

      {/* Public Achievements Wall (PRD §15) */}
      {profile.achievements && profile.achievements.length > 0 && (
        <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-card dark:border-neutral-800 dark:bg-neutral-900">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-neutral-500">🏆 Achievements</h2>
          <div className="flex flex-wrap gap-2">
            {profile.achievements.map((a) => (
              <span
                key={a.key}
                title={`Earned ${new Date(a.grantedAt).toLocaleDateString()}`}
                className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold capitalize text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300"
              >
                {a.label}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
