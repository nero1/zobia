"use client";

/**
 * components/shared/UserBadges.tsx
 *
 * The three "mini-badges" that render immediately after a user's display
 * name anywhere it appears (chat messages, moments, comments, profile
 * headers, leaderboards): an XP-level dot, a Prestige diamond, and the
 * existing blue verified checkmark (components/shared/VerifiedBadge.tsx).
 *
 * These are intentionally lightweight (small, inline, no network calls) so
 * they're cheap to drop into dense lists like a chat's message feed. Use
 * <UserBadgeRow> to render the standard set in the standard order; use the
 * individual badges directly only if a surface needs to omit one of them.
 */

import type { RankName } from "@zobia/types";
import { RANK_THRESHOLDS } from "@/lib/xp/engine";
import { VerifiedBadge } from "@/components/shared/VerifiedBadge";

// ---------------------------------------------------------------------------
// XP level badge — a small colored dot, one color per rank tier (PRD §6).
// ---------------------------------------------------------------------------

const RANK_ORDER: RankName[] = [
  "Beginner", "Rookie", "Hustler", "Baller", "Boss",
  "Legend", "Titan", "Goat", "Icon", "Zobia Icon",
];

/** One color per rank tier, low → high. No purple/gradients (matches Avatar.tsx's rank ring language). */
const RANK_COLORS: Record<RankName, string> = {
  "Beginner": "#9CA3AF",   // neutral-400 — not yet ranked up
  "Rookie": "#22C55E",     // green-500
  "Hustler": "#0EA5E9",    // sky-500
  "Baller": "#3B82F6",     // blue-500
  "Boss": "#14B8A6",       // teal-500
  "Legend": "#EAB308",     // yellow-500
  "Titan": "#F59E0B",      // amber-500
  "Goat": "#F97316",       // orange-500
  "Icon": "#EF4444",       // red-500
  "Zobia Icon": "#D4AF37", // gold
};

export function getRankNameForXP(totalXP: number): RankName {
  let rankIndex = 0;
  for (let i = RANK_ORDER.length - 1; i >= 0; i--) {
    if (totalXP >= RANK_THRESHOLDS[RANK_ORDER[i]]) {
      rankIndex = i;
      break;
    }
  }
  return RANK_ORDER[rankIndex];
}

interface XpLevelBadgeProps {
  /** Either pass a precomputed rank name, or `totalXp` and let this derive it. */
  rank?: RankName | null;
  totalXp?: number | string | bigint | null;
  size?: "sm" | "md";
  className?: string;
}

/** Small colored circle indicating the user's XP rank tier. */
export function XpLevelBadge({ rank, totalXp, size = "sm", className = "" }: XpLevelBadgeProps) {
  const resolvedRank =
    rank ?? (totalXp !== null && totalXp !== undefined ? getRankNameForXP(Number(totalXp)) : null);
  if (!resolvedRank) return null;
  const dimension = size === "md" ? "h-3 w-3" : "h-2.5 w-2.5";
  return (
    <span
      role="img"
      aria-label={`${resolvedRank} rank`}
      title={`${resolvedRank} rank`}
      className={`inline-block shrink-0 align-middle rounded-full ring-1 ring-black/10 dark:ring-white/20 ${dimension} ${className}`}
      style={{ backgroundColor: RANK_COLORS[resolvedRank] }}
    />
  );
}

// ---------------------------------------------------------------------------
// Prestige badge — a colored diamond (card-suit rhombus, not the fixed-color
// Unicode 💎/🔷 emoji, so each tier can have its own exact color and render
// identically across web, PWA, and the Capacitor app instead of depending on
// the platform's emoji font).
// ---------------------------------------------------------------------------

export const MAX_PRESTIGE = 10;

/** One color per prestige tier, 1-indexed (index 0 = Prestige 1). */
export const PRESTIGE_COLORS: readonly string[] = [
  "#22C55E", // 1 — green
  "#F97316", // 2 — orange
  "#EC4899", // 3 — pink
  "#0EA5E9", // 4 — sky blue
  "#EAB308", // 5 — yellow
  "#EF4444", // 6 — red
  "#14B8A6", // 7 — teal
  "#6366F1", // 8 — indigo
  "#F43F5E", // 9 — rose
  "#D4AF37", // 10 — gold
];

function prestigeColor(prestige: number): string {
  const index = Math.min(Math.max(prestige, 1), MAX_PRESTIGE) - 1;
  return PRESTIGE_COLORS[index] ?? PRESTIGE_COLORS[PRESTIGE_COLORS.length - 1];
}

interface PrestigeBadgeProps {
  /** Prestige count (0-10). Renders nothing at 0. */
  prestige: number | null | undefined;
  size?: "sm" | "md";
  className?: string;
}

/** Colored diamond shown after a user's name once they've Prestiged at least once. */
export function PrestigeBadge({ prestige, size = "sm", className = "" }: PrestigeBadgeProps) {
  const count = Number(prestige ?? 0);
  if (!count || count < 1) return null;
  const dimension = size === "md" ? "h-4 w-4" : "h-3.5 w-3.5";
  const color = prestigeColor(count);
  const label = `Prestige ${Math.min(count, MAX_PRESTIGE)}`;
  return (
    <svg
      viewBox="0 0 16 16"
      role="img"
      aria-label={label}
      className={`inline-block shrink-0 align-middle ${dimension} ${className}`}
    >
      <title>{label}</title>
      {/* Playing-card diamond: a square rotated 45deg. */}
      <rect x="3" y="3" width="10" height="10" rx="1" fill={color} transform="rotate(45 8 8)" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Composite — the standard order these badges appear in after a name:
// XP level dot, Prestige diamond, then the verified checkmark.
// ---------------------------------------------------------------------------

interface UserBadgeRowProps {
  rank?: RankName | null;
  totalXp?: number | string | bigint | null;
  prestige?: number | null;
  verified?: boolean | null;
  size?: "sm" | "md";
  className?: string;
}

export function UserBadgeRow({ rank, totalXp, prestige, verified, size = "sm", className = "" }: UserBadgeRowProps) {
  return (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      <XpLevelBadge rank={rank} totalXp={totalXp} size={size} />
      <PrestigeBadge prestige={prestige} size={size} />
      <VerifiedBadge show={verified} size={size} />
    </span>
  );
}

// ---------------------------------------------------------------------------
// Rewarded Gifts sender badge (migration 0026) — shown next to a user's name
// wherever they hold an active gift_reward_grants row for the current room
// or blog. Visually and semantically distinct from the per-blog VIP badge in
// components/blogs/CommentsSection.tsx (that badge marks a blog_gift_tiers
// "vip_badge" purchase, an unrelated, owner-defined feature) — this one uses
// a sparkle/pill shape in amber-gold rather than that badge's plain amber
// pill, and always shows the admin-defined label text rather than a fixed
// "VIP" string, so the two never look like the same feature or collide in
// the DOM (different component, different class names, different label).
// ---------------------------------------------------------------------------

interface RewardBadgeProps {
  /** The reward grant's admin-defined label (e.g. "Top Supporter"). Renders nothing when null/empty. */
  label?: string | null;
  className?: string;
}

export function RewardBadge({ label, className = "" }: RewardBadgeProps) {
  if (!label) return null;
  return (
    <span
      role="img"
      aria-label={`Reward unlocked: ${label}`}
      title={`Reward unlocked: ${label}`}
      className={`inline-flex items-center gap-0.5 rounded-full border border-amber-400/60 bg-gradient-to-r from-amber-400/20 to-yellow-300/20 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-600 dark:text-amber-400 ${className}`}
    >
      <span aria-hidden="true">✨</span>
      {label}
    </span>
  );
}
