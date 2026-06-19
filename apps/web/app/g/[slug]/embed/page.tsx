"use client";

/**
 * app/g/<slug>/embed
 *
 * Chromeless runner loaded by the Expo WebView (GameWebView). Authenticates
 * with a bearer token passed by the native shell (?t= or window.__ZOBIA_TOKEN__)
 * and posts lifecycle messages back to React Native. Also usable standalone on
 * web with cookie auth. Optional ?c=<challengeId> plays a challenge round.
 */

import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import GameRunner from "@/components/games/GameRunner";

interface GameSummary {
  slug: string;
  name: string;
  engineKey: string | null;
}

export default function EmbedGamePage() {
  const { slug } = useParams<{ slug: string }>();
  const sp = useSearchParams();
  const t = sp.get("t") ?? undefined;
  const c = sp.get("c") ?? undefined;
  const [token, setToken] = useState<string | null>(t ?? null);
  const [game, setGame] = useState<GameSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const injected = (window as unknown as { __ZOBIA_TOKEN__?: string }).__ZOBIA_TOKEN__;
    const tok = t ?? injected ?? null;
    setToken(tok);

    fetch(`/api/games/${slug}`, {
      credentials: "include",
      headers: tok ? { Authorization: `Bearer ${tok}` } : {},
    })
      .then((r) => r.json())
      .then((b) => {
        if (b?.data?.game) setGame(b.data.game);
        else setError(b?.error?.message ?? "Game unavailable.");
      })
      .catch(() => setError("Game unavailable."));
  }, [slug, t]);

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-neutral-950 p-3">
      {error && <p className="text-sm text-red-400">{error}</p>}
      {game?.engineKey ? (
        <GameRunner
          slug={game.slug}
          engineKey={game.engineKey}
          challengeId={c ?? null}
          token={token}
          embed
        />
      ) : (
        !error && <p className="text-sm text-neutral-400">Loading…</p>
      )}
    </div>
  );
}
