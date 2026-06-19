"use client";

/**
 * components/games/GameRunner.tsx
 *
 * Generic host that runs any game engine end-to-end:
 *   1. opens a server play session (solo or a challenge round),
 *   2. mounts the engine and waits for the final score,
 *   3. submits the score and shows the result + rewards,
 *   4. allows replay.
 *
 * Works on web/PWA directly and inside the Expo WebView (embed mode), where it
 * also posts lifecycle messages to the React Native bridge and authenticates
 * with a token instead of a cookie.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { getEngine } from "@/components/games/engineRegistry";

type Phase = "idle" | "starting" | "playing" | "submitting" | "result" | "error";

interface FinalizeResult {
  score: number;
  isWin: boolean;
  isNewBest: boolean;
  reward: { credits: number; xp: number; stars: number };
  challengeRoundId: string | null;
}

export interface GameRunnerProps {
  slug: string;
  engineKey: string;
  /** When set, each play is a round in this challenge instead of a solo run. */
  challengeId?: string | null;
  /** Bearer token for the Expo WebView (web uses cookies). */
  token?: string | null;
  /** Post lifecycle events to window.ReactNativeWebView (embed mode). */
  embed?: boolean;
  onExit?: () => void;
}

export default function GameRunner({
  slug,
  engineKey,
  challengeId,
  token,
  embed,
  onExit,
}: GameRunnerProps) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<FinalizeResult | null>(null);
  const nonceRef = useRef<string | null>(null);
  const Engine = getEngine(engineKey);

  const bridge = useCallback(
    (type: string, payload: Record<string, unknown> = {}) => {
      if (!embed) return;
      const w = window as unknown as { ReactNativeWebView?: { postMessage: (m: string) => void } };
      w.ReactNativeWebView?.postMessage(JSON.stringify({ type, ...payload }));
    },
    [embed]
  );

  const authFetch = useCallback(
    (url: string, init?: RequestInit) =>
      fetch(url, {
        ...init,
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(init?.headers ?? {}),
        },
      }),
    [token]
  );

  const start = useCallback(async () => {
    setPhase("starting");
    setError(null);
    setResult(null);
    try {
      const url = challengeId
        ? `/api/games/challenges/${challengeId}/play`
        : `/api/games/${slug}/start`;
      const res = await authFetch(url, { method: "POST", body: "{}" });
      const json = await res.json();
      if (!res.ok || !json?.data?.nonce) {
        throw new Error(json?.error?.message ?? "Could not start the game.");
      }
      nonceRef.current = json.data.nonce;
      setPhase("playing");
      bridge("game_started", { slug });
    } catch (e) {
      setError((e as Error).message);
      setPhase("error");
    }
  }, [authFetch, bridge, challengeId, slug]);

  const handleGameOver = useCallback(
    async (score: number) => {
      const nonce = nonceRef.current;
      if (!nonce) return;
      setPhase("submitting");
      try {
        const res = await authFetch(`/api/games/${slug}/score`, {
          method: "POST",
          body: JSON.stringify({ nonce, score }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error?.message ?? "Could not submit score.");
        const data = json.data as FinalizeResult;
        setResult(data);
        setPhase("result");
        bridge("game_over", { score, reward: data.reward, isWin: data.isWin });
      } catch (e) {
        setError((e as Error).message);
        setPhase("error");
      } finally {
        nonceRef.current = null;
      }
    },
    [authFetch, bridge, slug]
  );

  // Auto-start on mount for a snappier feel.
  useEffect(() => {
    if (phase === "idle") void start();
  }, [phase, start]);

  if (!Engine) {
    return <p className="p-6 text-center text-sm text-red-400">This game is unavailable.</p>;
  }

  return (
    <div className="flex w-full flex-col items-center gap-4">
      {phase === "starting" && <p className="text-sm text-neutral-300">Starting…</p>}

      {phase === "playing" && <Engine onGameOver={handleGameOver} />}

      {phase === "submitting" && <p className="text-sm text-neutral-300">Saving your score…</p>}

      {phase === "result" && result && (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-neutral-700 bg-neutral-900 p-6 text-center">
          <div className="text-2xl font-bold text-white">Score: {result.score}</div>
          {result.isNewBest && <div className="text-sm font-semibold text-amber-400">🏆 New personal best!</div>}
          {(result.reward.credits > 0 || result.reward.xp > 0 || result.reward.stars > 0) && (
            <div className="text-sm text-emerald-400">
              +{result.reward.credits} credits · +{result.reward.xp} XP
              {result.reward.stars > 0 ? ` · +${result.reward.stars} ⭐` : ""}
            </div>
          )}
          {result.challengeRoundId && (
            <div className="text-xs text-neutral-400">Round submitted. Check the challenge for results.</div>
          )}
          <div className="flex gap-2">
            {!challengeId && (
              <button
                type="button"
                onClick={() => void start()}
                className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-500"
              >
                Play again
              </button>
            )}
            {onExit && (
              <button
                type="button"
                onClick={onExit}
                className="rounded-lg border border-neutral-600 px-4 py-2 text-sm font-semibold text-neutral-200"
              >
                Done
              </button>
            )}
          </div>
        </div>
      )}

      {phase === "error" && (
        <div className="flex flex-col items-center gap-3 p-6 text-center">
          <p className="text-sm text-red-400">{error}</p>
          <button
            type="button"
            onClick={() => void start()}
            className="rounded-lg bg-neutral-700 px-4 py-2 text-sm font-semibold text-white"
          >
            Try again
          </button>
        </div>
      )}
    </div>
  );
}
