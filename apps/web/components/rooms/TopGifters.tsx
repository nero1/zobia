"use client";

/**
 * TopGifters
 *
 * Top gifters leaderboard for the room sidebar (web version).
 * Fetches the top gifters for a given room and displays a ranked list.
 * Shows a skeleton loader while fetching and handles errors gracefully.
 *
 * @example
 * <TopGifters roomId="abc123" />
 */

import { useState, useEffect } from "react";
import Link from "next/link";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Gifter {
  rank: number;
  userId: string;
  username: string;
  avatarEmoji: string;
  totalCoins: number;
}

interface TopGiftersProps {
  /** The room ID to fetch gifters for. */
  roomId: string;
  /** Number of gifters to display (default: 5). */
  limit?: number;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Sidebar top-gifters leaderboard for a room.
 * Automatically fetches data on mount.
 */
export function TopGifters({ roomId, limit = 5 }: TopGiftersProps) {
  const [gifters, setGifters] = useState<Gifter[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/rooms/${roomId}/gifts`, {
          credentials: "include",
        });
        if (!res.ok) throw new Error("Failed to load");
        const data = (await res.json()) as {
          topGifters: Array<{
            rank: number;
            user_id: string;
            username: string;
            avatar_emoji: string;
            total_coins: number;
          }>;
        };
        setGifters(
          (data.topGifters ?? []).slice(0, limit).map((g) => ({
            rank: g.rank,
            userId: g.user_id,
            username: g.username,
            avatarEmoji: g.avatar_emoji,
            totalCoins: g.total_coins,
          }))
        );
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error");
      } finally {
        setLoading(false);
      }
    })();
  }, [roomId, limit]);

  const MEDALS = ["🥇", "🥈", "🥉"];

  return (
    <div className="rounded-xl border border-neutral-200 dark:border-neutral-800">
      <div className="border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">Top Gifters</h3>
      </div>

      <div className="p-2">
        {loading ? (
          <div className="space-y-2 p-1">
            {Array.from({ length: limit }).map((_, i) => (
              <div key={i} className="flex animate-pulse items-center gap-2 rounded-lg p-2">
                <div className="h-8 w-8 rounded-full bg-neutral-200 dark:bg-neutral-700" />
                <div className="flex-1 space-y-1">
                  <div className="h-3 w-20 rounded bg-neutral-200 dark:bg-neutral-700" />
                  <div className="h-2 w-12 rounded bg-neutral-200 dark:bg-neutral-700" />
                </div>
              </div>
            ))}
          </div>
        ) : error ? (
          <p className="p-3 text-center text-xs text-neutral-400">{error}</p>
        ) : gifters.length === 0 ? (
          <p className="p-3 text-center text-xs text-neutral-400">No gifts yet. Be the first! 🎁</p>
        ) : (
          <div className="space-y-0.5">
            {gifters.map((g) => (
              <Link
                key={g.userId}
                href={`/profile/${g.userId}`}
                className="flex items-center gap-2.5 rounded-lg px-2 py-2 transition-colors hover:bg-neutral-50 dark:hover:bg-neutral-800/50"
              >
                <span className="w-5 text-center text-sm">
                  {MEDALS[g.rank - 1] ?? (
                    <span className="text-xs font-bold text-neutral-400">#{g.rank}</span>
                  )}
                </span>
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-neutral-100 text-base dark:bg-neutral-800">
                  {g.avatarEmoji}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold text-neutral-900 dark:text-neutral-100">
                    @{g.username}
                  </p>
                </div>
                <span className="shrink-0 text-xs font-bold tabular-nums text-amber-600">
                  {g.totalCoins.toLocaleString()} 🪙
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
