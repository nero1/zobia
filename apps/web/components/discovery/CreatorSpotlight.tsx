"use client";

/**
 * components/discovery/CreatorSpotlight.tsx
 *
 * "Creator of the Month" spotlight widget for the Discover feed (PRD §25).
 *
 * Fetches GET /api/creator-spotlight and renders:
 *  - Creator avatar (with fallback initials)
 *  - Creator display name and @username
 *  - "Creator of the Month" badge with month label
 *  - Optional admin-written blurb
 *
 * Renders nothing when no active spotlight is set.
 * Suitable for embedding at the top of any discovery / explore page.
 *
 * @example
 * ```tsx
 * import { CreatorSpotlight } from "@/components/discovery/CreatorSpotlight";
 *
 * export default function DiscoverPage() {
 *   return (
 *     <main>
 *       <CreatorSpotlight />
 *       {/* rest of discover content *\/}
 *     </main>
 *   );
 * }
 * ```
 */

import { useState, useEffect } from "react";
import Link from "next/link";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SpotlightCreator {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
}

interface SpotlightData {
  id: string;
  month_year: string;
  blurb: string | null;
  creator: SpotlightCreator;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format YYYY-MM into e.g. "June 2026". */
function formatMonthYear(my: string): string {
  const [year, month] = my.split("-");
  const date = new Date(Number(year), Number(month) - 1, 1);
  return date.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
}

/** Derive initials from a display name or username. */
function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return (parts[0].charAt(0) ?? "?").toUpperCase();
  return (
    (parts[0].charAt(0) ?? "") + (parts[parts.length - 1].charAt(0) ?? "")
  ).toUpperCase();
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** Star badge icon + label */
function Badge({ monthYear }: { monthYear: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-bold text-amber-700 dark:bg-amber-900 dark:text-amber-300">
      <svg
        className="h-3 w-3 flex-shrink-0"
        fill="currentColor"
        viewBox="0 0 20 20"
        aria-hidden="true"
      >
        <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
      </svg>
      Creator of the Month &mdash; {formatMonthYear(monthYear)}
    </span>
  );
}

/** Loading skeleton */
function SpotlightSkeleton() {
  return (
    <div className="animate-pulse rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex items-center gap-4">
        <div className="h-16 w-16 rounded-full bg-neutral-200 dark:bg-neutral-700" />
        <div className="flex-1 space-y-2">
          <div className="h-4 w-32 rounded bg-neutral-200 dark:bg-neutral-700" />
          <div className="h-3 w-24 rounded bg-neutral-200 dark:bg-neutral-700" />
          <div className="h-3 w-40 rounded bg-neutral-200 dark:bg-neutral-700" />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

/**
 * Creator of the Month spotlight widget.
 *
 * Silently renders nothing when there is no active spotlight or on fetch error.
 */
export function CreatorSpotlight() {
  const [spotlight, setSpotlight] = useState<SpotlightData | null | undefined>(
    undefined // undefined = loading, null = no active spotlight
  );

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch("/api/creator-spotlight");
        if (!res.ok) {
          if (!cancelled) setSpotlight(null);
          return;
        }
        const data = (await res.json()) as { spotlight: SpotlightData | null };
        if (!cancelled) setSpotlight(data.spotlight);
      } catch {
        if (!cancelled) setSpotlight(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // Loading state
  if (spotlight === undefined) {
    return <SpotlightSkeleton />;
  }

  // No active spotlight — render nothing
  if (spotlight === null) {
    return null;
  }

  const { creator } = spotlight;
  const displayName = creator.display_name ?? creator.username;
  const initials = getInitials(displayName);

  return (
    <section
      aria-label="Creator of the Month"
      className="rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50 to-white p-5 shadow-sm dark:border-amber-800 dark:from-amber-950/30 dark:to-neutral-900"
    >
      <div className="mb-3">
        <Badge monthYear={spotlight.month_year} />
      </div>

      <Link
        href={`/profile/${creator.username}`}
        className="group flex items-center gap-4"
      >
        {/* Avatar */}
        {creator.avatar_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={creator.avatar_url}
            alt={`${displayName}'s avatar`}
            className="h-16 w-16 rounded-full object-cover ring-2 ring-amber-300 transition-shadow group-hover:ring-amber-400 dark:ring-amber-700"
          />
        ) : (
          <div
            className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-full bg-amber-100 text-lg font-bold text-amber-700 ring-2 ring-amber-300 dark:bg-amber-900 dark:text-amber-300 dark:ring-amber-700"
            aria-hidden="true"
          >
            {initials}
          </div>
        )}

        {/* Info */}
        <div className="min-w-0">
          <p className="truncate text-base font-bold text-neutral-900 group-hover:underline dark:text-neutral-50">
            {displayName}
          </p>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            @{creator.username}
          </p>
          {spotlight.blurb && (
            <p className="mt-1 line-clamp-2 text-sm text-neutral-600 dark:text-neutral-300">
              {spotlight.blurb}
            </p>
          )}
        </div>
      </Link>
    </section>
  );
}
