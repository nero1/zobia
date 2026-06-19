"use client";

/**
 * app/(app)/games/leaderboards/page.tsx
 *
 * Per-game high-score leaderboards. Pick a game to see its top players. Links to
 * the overall gaming-track leaderboard (XP) served by /leaderboards?track=gaming.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslation } from "react-i18next";

interface GameSummary {
  slug: string;
  name: string;
}
interface Row {
  rank: number;
  username: string;
  displayName: string;
  avatarEmoji: string;
  bestScore: number;
  plays: number;
  wins: number;
}

export default function GamesLeaderboardsPage() {
  const { t } = useTranslation();
  const [games, setGames] = useState<GameSummary[]>([]);
  const [slug, setSlug] = useState<string>("");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch("/api/games", { credentials: "include" })
      .then((r) => r.json())
      .then((b) => {
        const list: GameSummary[] = b?.data?.games ?? [];
        setGames(list);
        if (list[0]) setSlug(list[0].slug);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!slug) return;
    setLoading(true);
    fetch(`/api/games/${slug}/leaderboard`, { credentials: "include" })
      .then((r) => r.json())
      .then((b) => setRows(b?.data?.rows ?? []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [slug]);

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t("games.leaderboards")}</h1>
        <Link href="/leaderboards?track=gaming" className="text-sm text-primary underline-offset-2 hover:underline">
          {t("games.trackLeaderboard")}
        </Link>
      </div>

      <select
        value={slug}
        onChange={(e) => setSlug(e.target.value)}
        className="mb-4 w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100"
      >
        {games.map((g) => (
          <option key={g.slug} value={g.slug}>{g.name}</option>
        ))}
      </select>

      {loading && <p className="text-sm text-muted-foreground">{t("common.loading")}</p>}

      {!loading && rows.length === 0 && (
        <p className="text-sm text-muted-foreground">{t("games.noScores")}</p>
      )}

      <ol className="divide-y divide-neutral-800 overflow-hidden rounded-xl border border-neutral-800">
        {rows.map((r) => (
          <li key={r.username} className="flex items-center gap-3 bg-neutral-900 px-4 py-3">
            <span className="w-6 text-sm font-bold text-neutral-400">{r.rank}</span>
            <span className="text-xl" aria-hidden>{r.avatarEmoji}</span>
            <span className="flex-1 truncate text-sm font-medium text-neutral-100">{r.displayName || r.username}</span>
            <span className="text-sm font-semibold text-emerald-400">{r.bestScore}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
