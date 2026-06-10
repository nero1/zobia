"use client";

/**
 * app/(app)/profile/page.tsx
 *
 * Authenticated user's own profile page (PRD §15).
 *
 * Fetches the current user's data from GET /api/users/me and renders the
 * full profile: rank ring, XP bar, all six track level bars, prestige badge,
 * guild, season history shelf, legacy score, creator card, and edit controls.
 *
 * All data is real — no hardcoded placeholders.
 */

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { OnlineRing } from "@/components/ui/OnlineRing";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TrackDisplay {
  label: string;
  emoji: string;
  level: number;
  xp: number;
}

interface SeasonRecord {
  id: string;
  name: string;
  theme: string;
  rank: number | null;
  tier: string | null;
  year: number;
}

interface MeData {
  id: string;
  username: string | null;
  display_name: string | null;
  avatar_emoji: string | null;
  city: string | null;
  plan: string;
  coin_balance: number;
  star_balance: number;
  xp_total: number;
  legacy_score: number;
  rank_name: string;
  rank_level: number;
  rank_sublevel: number;
  prestige_count: number;
  is_creator: boolean;
  is_verified: boolean;
  created_at: string;
  // Track XP
  xp_social: number;
  xp_creator: number;
  xp_competitor: number;
  xp_generosity: number;
  xp_knowledge: number;
  xp_explorer: number;
  // Track levels
  level_social: number;
  level_creator: number;
  level_competitor: number;
  level_generosity: number;
  level_knowledge: number;
  level_explorer: number;
  // Guild
  guild_id: string | null;
  guild_name: string | null;
  guild_tier: string | null;
}

interface GuildData {
  id: string;
  name: string;
  crest_emoji: string;
  tier: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TRACK_META: Array<{ key: keyof MeData; levelKey: keyof MeData; label: string; emoji: string }> = [
  { key: "xp_social",      levelKey: "level_social",      label: "Social",     emoji: "💬" },
  { key: "xp_creator",     levelKey: "level_creator",     label: "Creator",    emoji: "🎨" },
  { key: "xp_competitor",  levelKey: "level_competitor",  label: "Competitor", emoji: "⚔️" },
  { key: "xp_generosity",  levelKey: "level_generosity",  label: "Generosity", emoji: "🎁" },
  { key: "xp_knowledge",   levelKey: "level_knowledge",   label: "Knowledge",  emoji: "📚" },
  { key: "xp_explorer",    levelKey: "level_explorer",    label: "Explorer",   emoji: "🧭" },
];

const RANK_COLORS: Record<string, string> = {
  Beginner:     "#6b7280",
  Rookie:       "#10b981",
  Hustler:      "#3b82f6",
  Baller:       "#8b5cf6",
  Boss:         "#f59e0b",
  Legend:       "#ef4444",
  Titan:        "#ec4899",
  Goat:         "#06b6d4",
  Icon:         "#f97316",
  "Zobia Icon": "#eab308",
};

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function Skeleton() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="rounded-xl border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900">
        <div className="flex gap-4">
          <div className="h-20 w-20 rounded-full bg-neutral-200 dark:bg-neutral-700" />
          <div className="flex-1 space-y-3">
            <div className="h-6 w-40 rounded bg-neutral-200 dark:bg-neutral-700" />
            <div className="h-4 w-24 rounded bg-neutral-200 dark:bg-neutral-700" />
            <div className="h-2 w-full rounded bg-neutral-200 dark:bg-neutral-700" />
          </div>
        </div>
      </div>
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="h-16 rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900" />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Track level bar
// ---------------------------------------------------------------------------

function TrackBar({ label, emoji, level, xp }: TrackDisplay) {
  const xpPerLevel = 1000;
  const pct = Math.min(100, Math.round(((xp % xpPerLevel) / xpPerLevel) * 100));
  return (
    <div className="flex items-center gap-3">
      <span className="w-5 text-center text-base">{emoji}</span>
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-xs font-medium text-neutral-700 dark:text-neutral-300">{label}</span>
          <span className="text-xs font-semibold tabular-nums text-neutral-500">Lv {level}</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-700">
          <div className="h-full rounded-full bg-blue-500 transition-all" style={{ width: `${pct}%` }} />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function MyProfilePage() {
  const [me, setMe] = useState<MeData | null>(null);
  const [guild, setGuild] = useState<GuildData | null>(null);
  const [seasons, setSeasons] = useState<SeasonRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/users/me", { credentials: "include" });
      if (!res.ok) throw new Error("Could not load profile");
      const json = await res.json();
      const data: MeData = json.user ?? json;
      setMe(data);

      // Load guild info if user is in one
      if (data.guild_id) {
        const gRes = await fetch(`/api/guilds/${data.guild_id}`, { credentials: "include" });
        if (gRes.ok) setGuild(await gRes.json());
      }

      // Load season history
      const sRes = await fetch("/api/seasons?history=true&limit=10", { credentials: "include" });
      if (sRes.ok) {
        const sData = await sRes.json();
        setSeasons(sData.seasons ?? []);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="p-4 sm:p-6"><Skeleton /></div>;

  if (error || !me) {
    return (
      <div className="flex flex-col items-center justify-center py-24">
        <p className="text-neutral-500">{error ?? "Profile not found"}</p>
        <Link href="/" className="mt-3 text-sm text-blue-600 hover:underline">← Home</Link>
      </div>
    );
  }

  const ringColor = RANK_COLORS[me.rank_name] ?? "#6b7280";
  const joinedYear = me.created_at
    ? new Date(me.created_at).toLocaleDateString("en-NG", { month: "long", year: "numeric" })
    : "—";
  const subLabel = `${me.rank_name} ${["I", "II", "III"][me.rank_sublevel - 1] ?? "I"}`;

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4 sm:p-6">
      {/* ── Header card ─────────────────────────────────────────────── */}
      <div className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        <div className="flex items-start gap-4">
          {/* Avatar with rank ring + presence indicator */}
          <OnlineRing userId={me.id} size="lg">
            <div
              className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full text-4xl"
              style={{ boxShadow: `0 0 0 3px ${ringColor}` }}
            >
              {me.avatar_emoji ?? "🙂"}
            </div>
          </OnlineRing>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-bold text-neutral-900 dark:text-neutral-50">
                {me.display_name ?? me.username ?? "Anonymous"}
              </h1>
              {me.is_verified && (
                <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-700 dark:bg-blue-900 dark:text-blue-300">
                  ✓ Verified
                </span>
              )}
              {me.is_creator && (
                <span className="rounded-full bg-teal-100 px-2 py-0.5 text-xs font-semibold text-teal-700 dark:bg-teal-900 dark:text-teal-300">
                  Creator
                </span>
              )}
              {me.prestige_count > 0 && (
                <span className="text-amber-500" title={`Prestige ${me.prestige_count}`}>
                  {"★".repeat(Math.min(me.prestige_count, 10))}
                </span>
              )}
            </div>

            <p className="mt-0.5 text-sm text-neutral-500">
              @{me.username ?? "—"}
              {me.city && <span> · {me.city}</span>}
              <span> · Playing since {joinedYear}</span>
            </p>

            {/* Rank + sublevel */}
            <div className="mt-2 flex items-center gap-2">
              <span
                className="rounded-full px-2.5 py-0.5 text-xs font-bold text-white"
                style={{ backgroundColor: ringColor }}
              >
                {subLabel}
              </span>
              <span className="text-xs text-neutral-500">
                {me.xp_total.toLocaleString()} XP
              </span>
              {me.legacy_score > 0 && (
                <span className="text-xs text-amber-600">
                  ⚜️ {me.legacy_score.toLocaleString()} Legacy
                </span>
              )}
            </div>

            {/* Plan badge */}
            <div className="mt-2">
              <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${
                me.plan === "max"  ? "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300" :
                me.plan === "pro"  ? "bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-300" :
                me.plan === "plus" ? "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300" :
                "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400"
              }`}>
                {me.plan === "free" ? "Free" : me.plan.charAt(0).toUpperCase() + me.plan.slice(1)} Plan
              </span>
            </div>
          </div>

          {/* Edit button */}
          <Link
            href="/settings"
            className="shrink-0 rounded-lg border border-neutral-300 px-4 py-1.5 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            Edit profile
          </Link>
        </div>

        {/* Wallet summary */}
        <div className="mt-4 flex gap-6 border-t border-neutral-100 pt-4 dark:border-neutral-800">
          <div className="text-center">
            <p className="text-lg font-bold text-neutral-900 dark:text-neutral-50">{me.coin_balance.toLocaleString()}</p>
            <p className="text-xs text-neutral-500">Coins</p>
          </div>
          <div className="text-center">
            <p className="text-lg font-bold text-neutral-900 dark:text-neutral-50">{me.star_balance.toLocaleString()}</p>
            <p className="text-xs text-neutral-500">Stars</p>
          </div>
          <Link href="/wallet" className="ml-auto flex items-center rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700">
            Wallet →
          </Link>
        </div>
      </div>

      {/* ── Guild ────────────────────────────────────────────────────── */}
      {guild ? (
        <Link
          href={`/guilds/${guild.id}`}
          className="flex items-center gap-3 rounded-xl border border-neutral-200 bg-white p-4 shadow-sm transition-colors hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900 dark:hover:bg-neutral-800"
        >
          <span className="text-2xl">{guild.crest_emoji ?? "🛡️"}</span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-neutral-900 dark:text-neutral-50">{guild.name}</p>
            <p className="text-xs capitalize text-neutral-500">{guild.tier?.replace(/_/g, " ")} Guild</p>
          </div>
          <span className="text-xs text-neutral-400">→</span>
        </Link>
      ) : (
        <Link
          href="/guild-discovery"
          className="flex items-center gap-3 rounded-xl border border-dashed border-neutral-300 bg-white p-4 shadow-sm transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:hover:bg-neutral-800"
        >
          <span className="text-2xl">🛡️</span>
          <div className="min-w-0 flex-1">
            <p className="font-medium text-neutral-700 dark:text-neutral-300">Join a Guild</p>
            <p className="text-xs text-neutral-500">Earn XP boosts and compete in wars</p>
          </div>
          <span className="text-xs text-neutral-400">→</span>
        </Link>
      )}

      {/* ── Find Rooms ───────────────────────────────────────────────── */}
      <Link
        href="/rooms"
        className="flex items-center gap-3 rounded-xl border border-dashed border-neutral-300 bg-white p-4 shadow-sm transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:hover:bg-neutral-800"
      >
        <span className="text-2xl">🚪</span>
        <div className="min-w-0 flex-1">
          <p className="font-medium text-neutral-700 dark:text-neutral-300">Find Rooms</p>
          <p className="text-xs text-neutral-500">Discover audio rooms to join</p>
        </div>
        <span className="text-xs text-neutral-400">→</span>
      </Link>

      {/* ── Six track bars ───────────────────────────────────────────── */}
      <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        <h2 className="mb-4 text-sm font-semibold text-neutral-700 dark:text-neutral-300">Progression Tracks</h2>
        <div className="space-y-3">
          {TRACK_META.map((t) => (
            <TrackBar
              key={t.key}
              label={t.label}
              emoji={t.emoji}
              level={(me[t.levelKey] as number) ?? 0}
              xp={(me[t.key] as number) ?? 0}
            />
          ))}
        </div>
      </div>

      {/* ── Season history ───────────────────────────────────────────── */}
      {seasons.length > 0 && (
        <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
          <h2 className="mb-3 text-sm font-semibold text-neutral-700 dark:text-neutral-300">Season History</h2>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {seasons.map((s) => (
              <div key={s.id} className="rounded-lg border border-neutral-100 bg-neutral-50 p-2 text-center dark:border-neutral-800 dark:bg-neutral-800">
                <p className="text-xs text-neutral-500">{s.year}</p>
                <p className="mt-0.5 truncate text-xs font-bold text-neutral-900 dark:text-neutral-100">{s.name}</p>
                {s.rank && <p className="text-sm font-bold text-amber-600">#{s.rank}</p>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Quick actions ────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { href: "/quests", label: "Daily Quests", emoji: "📋" },
          { href: "/seasons", label: "Season Pass", emoji: "🏆" },
          { href: "/prestige", label: "Prestige", emoji: "🔥" },
          { href: "/settings/subscription", label: "Upgrade Plan", emoji: "⚡" },
        ].map((action) => (
          <Link
            key={action.href}
            href={action.href}
            className="flex flex-col items-center gap-1.5 rounded-xl border border-neutral-200 bg-white p-3 text-center shadow-sm transition-colors hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900 dark:hover:bg-neutral-800"
          >
            <span className="text-2xl">{action.emoji}</span>
            <span className="text-xs font-medium text-neutral-700 dark:text-neutral-300">{action.label}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
