/**
 * apps/android/src/components/shared/UserBadges.tsx
 *
 * Ported from apps/web/components/shared/UserBadges.tsx — kept in exact sync
 * (same rank/prestige colors, same rules) so a user's badges look identical
 * whether viewed on web, PWA, or here in the Capacitor app. See the web
 * file's doc comment for the full rationale.
 */

import type { RankName } from '@zobia/shared/types';

const RANK_ORDER: RankName[] = [
  'Beginner', 'Rookie', 'Hustler', 'Baller', 'Boss',
  'Legend', 'Titan', 'Goat', 'Icon', 'Zobia Icon',
];

const RANK_THRESHOLDS: Record<RankName, number> = {
  'Beginner': 0,
  'Rookie': 2_000,
  'Hustler': 6_000,
  'Baller': 15_000,
  'Boss': 35_000,
  'Legend': 75_000,
  'Titan': 150_000,
  'Goat': 280_000,
  'Icon': 500_000,
  'Zobia Icon': 1_000_000,
};

const RANK_COLORS: Record<RankName, string> = {
  'Beginner': '#9CA3AF',
  'Rookie': '#22C55E',
  'Hustler': '#0EA5E9',
  'Baller': '#3B82F6',
  'Boss': '#14B8A6',
  'Legend': '#EAB308',
  'Titan': '#F59E0B',
  'Goat': '#F97316',
  'Icon': '#EF4444',
  'Zobia Icon': '#D4AF37',
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
  rank?: RankName | null;
  totalXp?: number | string | null;
  size?: 'sm' | 'md';
  className?: string;
}

export function XpLevelBadge({ rank, totalXp, size = 'sm', className = '' }: XpLevelBadgeProps) {
  const resolvedRank =
    rank ?? (totalXp !== null && totalXp !== undefined ? getRankNameForXP(Number(totalXp)) : null);
  if (!resolvedRank) return null;
  const dimension = size === 'md' ? 'h-3 w-3' : 'h-2.5 w-2.5';
  return (
    <span
      role="img"
      aria-label={`${resolvedRank} rank`}
      title={`${resolvedRank} rank`}
      className={`inline-block shrink-0 align-middle rounded-full ring-1 ring-black/10 ${dimension} ${className}`}
      style={{ backgroundColor: RANK_COLORS[resolvedRank] }}
    />
  );
}

export const MAX_PRESTIGE = 10;

export const PRESTIGE_COLORS: readonly string[] = [
  '#22C55E', '#F97316', '#EC4899', '#0EA5E9', '#EAB308',
  '#EF4444', '#14B8A6', '#6366F1', '#F43F5E', '#D4AF37',
];

function prestigeColor(prestige: number): string {
  const index = Math.min(Math.max(prestige, 1), MAX_PRESTIGE) - 1;
  return PRESTIGE_COLORS[index] ?? PRESTIGE_COLORS[PRESTIGE_COLORS.length - 1];
}

interface PrestigeBadgeProps {
  prestige: number | null | undefined;
  size?: 'sm' | 'md';
  className?: string;
}

export function PrestigeBadge({ prestige, size = 'sm', className = '' }: PrestigeBadgeProps) {
  const count = Number(prestige ?? 0);
  if (!count || count < 1) return null;
  const dimension = size === 'md' ? 'h-4 w-4' : 'h-3.5 w-3.5';
  const color = prestigeColor(count);
  const label = `Prestige ${Math.min(count, MAX_PRESTIGE)}`;
  return (
    <svg viewBox="0 0 16 16" role="img" aria-label={label} className={`inline-block shrink-0 align-middle ${dimension} ${className}`}>
      <title>{label}</title>
      <rect x="3" y="3" width="10" height="10" rx="1" fill={color} transform="rotate(45 8 8)" />
    </svg>
  );
}

interface VerifiedBadgeProps {
  show: boolean | null | undefined;
  size?: 'sm' | 'md';
  className?: string;
}

/** Blue checkmark — same SVG/color as apps/web/components/shared/VerifiedBadge.tsx. */
export function VerifiedBadge({ show, size = 'sm', className = '' }: VerifiedBadgeProps) {
  if (!show) return null;
  const dimension = size === 'md' ? 'h-5 w-5' : 'h-4 w-4';
  return (
    <svg viewBox="0 0 22 22" aria-label="Verified account" role="img" className={`inline-block shrink-0 align-middle ${dimension} ${className}`}>
      <title>Verified account</title>
      <path
        fill="#1d9bf0"
        d="M20.396 11c-.018-.646-.215-1.275-.57-1.816-.354-.54-.852-.972-1.438-1.246.223-.607.27-1.264.14-1.897-.131-.634-.437-1.218-.882-1.687-.47-.445-1.053-.75-1.687-.882-.633-.13-1.29-.083-1.897.14-.273-.587-.704-1.084-1.245-1.439C12.275.215 11.646.017 11 0c-.646.017-1.275.215-1.816.57-.54.354-.972.852-1.246 1.438-.607-.223-1.264-.27-1.897-.14-.634.131-1.218.437-1.687.882-.445.47-.75 1.053-.882 1.687-.13.633-.083 1.29.14 1.897-.587.274-1.084.706-1.439 1.246C.215 8.725.017 9.354 0 10c.017.646.215 1.275.57 1.816.354.54.852.972 1.438 1.245-.223.607-.27 1.264-.14 1.897.131.634.437 1.217.882 1.687.47.445 1.053.75 1.687.882.633.13 1.29.083 1.897-.14.274.586.706 1.084 1.246 1.438.54.355 1.17.552 1.816.57.646-.018 1.275-.215 1.816-.57.54-.354.972-.852 1.245-1.438.607.223 1.264.27 1.897.14.634-.131 1.218-.437 1.687-.882.445-.47.75-1.053.882-1.687.13-.633.083-1.29-.14-1.897.586-.273 1.084-.705 1.438-1.245.355-.54.552-1.17.57-1.816zm-11.454 4.586-2.968-2.968 1.414-1.414 1.554 1.554 4.294-4.294 1.414 1.414-5.708 5.708z"
        transform="translate(0 1)"
      />
    </svg>
  );
}

interface UserBadgeRowProps {
  rank?: RankName | null;
  totalXp?: number | string | null;
  prestige?: number | null;
  verified?: boolean | null;
  size?: 'sm' | 'md';
  className?: string;
}

export function UserBadgeRow({ rank, totalXp, prestige, verified, size = 'sm', className = '' }: UserBadgeRowProps) {
  return (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      <XpLevelBadge rank={rank} totalXp={totalXp} size={size} />
      <PrestigeBadge prestige={prestige} size={size} />
      <VerifiedBadge show={verified} size={size} />
    </span>
  );
}
