"use client";

/**
 * app/(app)/games/page.tsx
 *
 * Games directory — active games grouped by category, with quick links to the
 * gaming leaderboards and challenges, plus ad placements.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import AdSlot from "@/components/ads/AdSlot";

interface GameSummary {
  slug: string;
  name: string;
  tagline: string | null;
  coverEmoji: string;
  coverImageUrl: string | null;
  category: string | null;
  rewardCreditsPerWin: number;
  rewardXpPerWin: number;
  playCostCredits: number;
  playCostStars: number;
}

interface CategoryGroup {
  category: string;
  games: GameSummary[];
}

export default function GamesDirectoryPage() {
  const { t } = useTranslation();
  const [groups, setGroups] = useState<CategoryGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [disabled, setDisabled] = useState(false);

  useEffect(() => {
    fetch("/api/games", { credentials: "include" })
      .then(async (r) => {
        if (r.status === 403) {
          setDisabled(true);
          return null;
        }
        return r.json();
      })
      .then((b) => {
        if (b?.data?.categories) setGroups(b.data.categories);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (disabled) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center">
        <div className="mb-4 text-5xl">🎮</div>
        <h1 className="text-2xl font-bold">{t("games.unavailableTitle")}</h1>
        <p className="mt-2 text-muted-foreground">{t("games.unavailableBody")}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t("games.title")}</h1>
        <div className="flex gap-2 text-sm">
          <Link href="/games/challenges" className="rounded-lg bg-neutral-800 px-3 py-1.5 font-medium text-neutral-100 hover:bg-neutral-700">
            {t("games.challenges")}
          </Link>
          <Link href="/games/leaderboards" className="rounded-lg bg-neutral-800 px-3 py-1.5 font-medium text-neutral-100 hover:bg-neutral-700">
            {t("games.leaderboards")}
          </Link>
        </div>
      </div>

      <AdSlot placement="games-directory-top" className="mb-6" />

      {loading && <p className="text-sm text-muted-foreground">{t("common.loading")}</p>}

      {!loading && groups.length === 0 && (
        <p className="text-sm text-muted-foreground">{t("games.empty")}</p>
      )}

      {groups.map((group) => (
        <section key={group.category} className="mb-8">
          <h2 className="mb-3 text-lg font-semibold text-neutral-200">{group.category}</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {group.games.map((g) => (
              <Link
                key={g.slug}
                href={`/g/${g.slug}/play`}
                className="group flex flex-col rounded-xl border border-neutral-800 bg-neutral-900 p-4 transition hover:border-primary/60"
              >
                {g.coverImageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={g.coverImageUrl} alt={g.name} className="mb-2 h-20 w-full rounded-lg object-cover" />
                ) : (
                  <div className="mb-2 text-4xl" aria-hidden>{g.coverEmoji}</div>
                )}
                <div className="font-semibold text-neutral-100">{g.name}</div>
                {g.tagline && <div className="text-xs text-neutral-400">{g.tagline}</div>}
                <div className="mt-2 text-xs font-medium text-emerald-500">
                  {g.rewardCreditsPerWin > 0 ? `+${g.rewardCreditsPerWin} ${t("games.credits")}` : t("games.freePlay")}
                </div>
                {(g.playCostCredits > 0 || g.playCostStars > 0) && (
                  <div className="text-xs text-amber-500">
                    {t("games.costsToPlay", {
                      cost:
                        g.playCostCredits > 0
                          ? `${g.playCostCredits} ${t("games.credits")}`
                          : `${g.playCostStars} ⭐`,
                    })}
                  </div>
                )}
              </Link>
            ))}
          </div>
        </section>
      ))}

      <AdSlot placement="games-directory-bottom" className="mt-4" />
    </div>
  );
}
