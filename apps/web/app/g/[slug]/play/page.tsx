"use client";

/**
 * app/g/<slug>/play
 *
 * Authenticated play host. Guests are bounced to the public cover page (which
 * shows the login gate). Members load the engine and play via GameRunner.
 */

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth/hooks";
import GameRunner from "@/components/games/GameRunner";
import AdSlot from "@/components/ads/AdSlot";

interface GameSummary {
  slug: string;
  name: string;
  engineKey: string | null;
}

export default function PlayGamePage() {
  const { slug } = useParams<{ slug: string }>();
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const [game, setGame] = useState<GameSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isLoading) return;
    if (!user) {
      router.replace(`/g/${slug}`);
      return;
    }
    fetch(`/api/games/${slug}`, { credentials: "include" })
      .then((r) => r.json())
      .then((b) => {
        if (b?.data?.game) setGame(b.data.game);
        else setError(b?.error?.message ?? "Game unavailable.");
      })
      .catch(() => setError("Game unavailable."));
  }, [isLoading, user, slug, router]);

  return (
    <main className="min-h-screen bg-neutral-950 px-4 py-8">
      <div className="mx-auto flex max-w-xl flex-col items-center gap-6">
        <div className="flex w-full items-center justify-between">
          <a href={`/g/${slug}`} className="text-sm text-neutral-400 hover:text-neutral-200">
            ← Back
          </a>
          {game && <h1 className="text-lg font-bold text-white">{game.name}</h1>}
          <span className="w-10" />
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}

        {game?.engineKey ? (
          <GameRunner slug={game.slug} engineKey={game.engineKey} />
        ) : (
          !error && <p className="text-sm text-neutral-400">Loading…</p>
        )}

        <AdSlot placement="game-play" className="mt-4" />
      </div>
    </main>
  );
}
