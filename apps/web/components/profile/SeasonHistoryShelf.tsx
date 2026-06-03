"use client";

/**
 * components/profile/SeasonHistoryShelf.tsx
 *
 * Horizontal scrollable timeline of seasons a user participated in.
 * Displays season name, theme, rank achieved, top-10 badge, and retired cosmetic badges.
 */

import { useState, useEffect } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SeasonRecord {
  id: string;
  name: string;
  theme: string;
  year: number;
  rank: number | null;
  tier: string | null;
  isTop10: boolean;
  hasRetiredCosmetic: boolean;
  cosmeticName?: string;
}

interface SeasonHistoryShelfProps {
  userId: string;
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function ShelfSkeleton() {
  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="h-32 w-40 shrink-0 animate-pulse rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900"
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Season shelf card
// ---------------------------------------------------------------------------

function SeasonShelfCard({ season }: { season: SeasonRecord }) {
  return (
    <div className="relative w-40 shrink-0 rounded-xl border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
      {/* Top-10 badge */}
      {season.isTop10 && (
        <span className="absolute -right-1.5 -top-1.5 rounded-full bg-amber-400 px-1.5 py-0.5 text-xs font-bold text-white shadow">
          Top 10
        </span>
      )}

      <p className="text-xs text-neutral-400">{season.year}</p>
      <p className="mt-0.5 truncate text-sm font-bold text-neutral-900 dark:text-neutral-100">
        {season.name}
      </p>
      <p className="truncate text-xs text-neutral-500">{season.theme}</p>

      {season.rank !== null ? (
        <div className="mt-2 flex items-center gap-1">
          <span className="text-base font-bold text-amber-600">#{season.rank}</span>
          {season.tier && (
            <span className="text-xs text-neutral-500">{season.tier}</span>
          )}
        </div>
      ) : (
        <p className="mt-2 text-xs text-neutral-400">Unranked</p>
      )}

      {/* Retired cosmetic badge */}
      {season.hasRetiredCosmetic && (
        <div className="mt-2">
          <span className="inline-flex items-center gap-0.5 rounded-full bg-teal-100 px-2 py-0.5 text-xs font-semibold text-teal-700 dark:bg-teal-900 dark:text-teal-300">
            Retired{season.cosmeticName ? `: ${season.cosmeticName}` : ""}
          </span>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Horizontal scrollable season history shelf for a user profile.
 * Fetches from /api/seasons?userId=X
 */
export function SeasonHistoryShelf({ userId }: SeasonHistoryShelfProps) {
  const [seasons, setSeasons] = useState<SeasonRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/seasons?userId=${userId}`, {
          credentials: "include",
        });
        if (!res.ok) throw new Error("Failed to load season history");
        const data = (await res.json()) as { pastSeasons: SeasonRecord[] };
        setSeasons(data.pastSeasons ?? []);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    })();
  }, [userId]);

  if (loading) return <ShelfSkeleton />;

  if (error) {
    return (
      <p className="text-xs text-neutral-400">Could not load season history.</p>
    );
  }

  if (seasons.length === 0) {
    return (
      <p className="text-sm text-neutral-400">No season history yet.</p>
    );
  }

  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {seasons.map((s) => (
        <SeasonShelfCard key={s.id} season={s} />
      ))}
    </div>
  );
}
