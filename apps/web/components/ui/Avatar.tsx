/**
 * components/ui/Avatar.tsx
 *
 * Avatar component with rank ring.
 *
 * The rank ring uses gold/green/blue colors based on the user's rank tier.
 * Falls back to user initials when no image is available.
 *
 * NO purple colors. NO gradients.
 */

import Image from "next/image";
import { clsx } from "clsx";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AvatarSize = "xs" | "sm" | "md" | "lg" | "xl";

/** Rank tiers that affect the ring color. */
export type RankTier =
  | "bronze"
  | "silver"
  | "gold"
  | "platinum"
  | "diamond"
  | "none";

export interface AvatarProps {
  /** URL of the user's profile image. */
  src?: string | null;
  /** User's display name (used for alt text and initials fallback). */
  name: string;
  /** Avatar size preset. @default 'md' */
  size?: AvatarSize;
  /** User's rank tier – determines the ring color. @default 'none' */
  rankTier?: RankTier;
  /** Additional CSS classes. */
  className?: string;
  /** Whether to show the online indicator dot. @default false */
  isOnline?: boolean;
  /** Prestige count (0–10). Shows star indicators below the avatar. */
  prestigeCount?: number;
}

// ---------------------------------------------------------------------------
// Style maps
// ---------------------------------------------------------------------------

const sizeMap: Record<AvatarSize, { container: string; image: number; text: string }> = {
  xs: { container: "h-6 w-6", image: 24, text: "text-xs" },
  sm: { container: "h-8 w-8", image: 32, text: "text-xs" },
  md: { container: "h-10 w-10", image: 40, text: "text-sm" },
  lg: { container: "h-14 w-14", image: 56, text: "text-base" },
  xl: { container: "h-20 w-20", image: 80, text: "text-xl" },
};

const rankRingMap: Record<RankTier, string> = {
  none: "ring-2 ring-neutral-200 dark:ring-neutral-700",
  bronze: "ring-2 ring-[#CD7F32]",
  silver: "ring-2 ring-neutral-400",
  gold: "ring-2 ring-gold-400",
  platinum: "ring-2 ring-primary-300",
  diamond: "ring-2 ring-primary-500",
};

/** Generate a deterministic background color from a name string. */
function nameToColor(name: string): string {
  const colors = [
    "bg-primary-100 text-primary-700 dark:bg-primary-900 dark:text-primary-300",
    "bg-success-100 text-success-700 dark:bg-success-900 dark:text-success-300",
    "bg-gold-100 text-gold-700 dark:bg-gold-900 dark:text-gold-300",
    "bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300",
  ];
  const index =
    name.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0) %
    colors.length;
  return colors[index];
}

/** Extract up to 2 initials from a display name. */
function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return (parts[0].charAt(0) ?? "?").toUpperCase();
  return ((parts[0].charAt(0) ?? "") + (parts[parts.length - 1].charAt(0) ?? "")).toUpperCase();
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Avatar with optional rank ring and online indicator.
 *
 * @example
 * ```tsx
 * <Avatar src={user.avatarUrl} name={user.displayName} rankTier="gold" isOnline />
 * ```
 */
export function Avatar({
  src,
  name,
  size = "md",
  rankTier = "none",
  className,
  isOnline = false,
  prestigeCount = 0,
}: AvatarProps) {
  const { container, image, text } = sizeMap[size];
  const initials = getInitials(name);
  const initalsColor = nameToColor(name);

  return (
    <div className={clsx("relative inline-flex flex-shrink-0", className)}>
      {/* Avatar circle */}
      <div
        className={clsx(
          "relative overflow-hidden rounded-full",
          container,
          rankRingMap[rankTier]
        )}
        title={name}
        aria-label={`${name}'s avatar`}
      >
        {src ? (
          <Image
            src={src}
            alt={`${name}'s avatar`}
            width={image}
            height={image}
            className="h-full w-full object-cover"
            unoptimized={src.startsWith("https://t.me") || src.includes("telegram")}
          />
        ) : (
          <div
            className={clsx(
              "flex h-full w-full items-center justify-center font-semibold",
              text,
              initalsColor
            )}
            aria-hidden="true"
          >
            {initials}
          </div>
        )}
      </div>

      {/* Online indicator */}
      {isOnline && (
        <span
          className={clsx(
            "absolute bottom-0 right-0 block rounded-full bg-success-500 ring-2 ring-white dark:ring-neutral-900",
            size === "xs" || size === "sm" ? "h-2 w-2" : "h-2.5 w-2.5"
          )}
          aria-label="Online"
          title="Online"
        />
      )}
    </div>
  );
}
