"use client";

/**
 * app/(app)/games/challenges/<id>
 *
 * Challenge detail with round breakdown and a "Play your round" action that
 * mounts the game engine bound to this challenge. Submitting a score advances
 * the round/series automatically.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useTranslation } from "react-i18next";
import GameRunner from "@/components/games/GameRunner";

interface RoundDetail {
  round_no: number;
  challenger_score: number | null;
  opponent_score: number | null;
  round_winner_id: string | null;
  status: string;
}
interface Detail {
  id: string;
  gameSlug: string;
  gameName: string;
  status: string;
  rounds: number;
  wagerCredits: number;
  winnerId: string | null;
  challengerUsername: string;
  opponentUsername: string;
  rounds_detail: RoundDetail[];
}

export default function ChallengeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [engineKey, setEngineKey] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);

  const reload = () => {
    fetch(`/api/games/challenges/${id}`, { credentials: "include" })
      .then((r) => r.json())
      .then((b) => {
        const d: Detail | undefined = b?.data?.challenge;
        if (d) {
          setDetail(d);
          fetch(`/api/games/${d.gameSlug}`, { credentials: "include" })
            .then((r) => r.json())
            .then((g) => setEngineKey(g?.data?.game?.engineKey ?? null))
            .catch(() => {});
        }
      })
      .catch(() => {});
  };

  useEffect(reload, [id]);

  if (!detail) return <div className="p-6 text-sm text-muted-foreground">{t("common.loading")}</div>;

  return (
    <div className="mx-auto max-w-xl px-4 py-6">
      <Link href="/games/challenges" className="text-sm text-neutral-400 hover:text-neutral-200">← {t("games.challenges")}</Link>
      <h1 className="mt-2 text-2xl font-bold">{detail.gameName}</h1>
      <p className="text-sm text-neutral-400">
        @{detail.challengerUsername} vs @{detail.opponentUsername}
        {detail.wagerCredits > 0 ? ` · ${detail.wagerCredits} ${t("games.credits")} ${t("games.wager")}` : ""}
      </p>

      <div className="my-4 space-y-1">
        {detail.rounds_detail.map((r) => (
          <div key={r.round_no} className="flex justify-between rounded-lg bg-neutral-900 px-3 py-2 text-sm">
            <span>{t("games.round")} {r.round_no}</span>
            <span className="text-neutral-300">
              {r.challenger_score ?? "—"} : {r.opponent_score ?? "—"}
            </span>
          </div>
        ))}
      </div>

      {detail.status === "active" && !playing && (
        <button
          onClick={() => setPlaying(true)}
          className="w-full rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground hover:opacity-90"
        >
          {t("games.playRound")}
        </button>
      )}

      {detail.status === "active" && playing && engineKey && (
        <div className="mt-4">
          <GameRunner
            slug={detail.gameSlug}
            engineKey={engineKey}
            challengeId={detail.id}
            onExit={() => { setPlaying(false); reload(); }}
          />
        </div>
      )}

      {detail.status === "completed" && (
        <p className="mt-4 text-center text-sm font-semibold text-emerald-400">
          {detail.winnerId ? t("games.challengeOver") : t("games.draw")}
        </p>
      )}
    </div>
  );
}
