"use client";

/**
 * components/games/GameRunner.tsx
 *
 * Generic host that runs any game engine end-to-end:
 *   1. Pre-game screen — difficulty picker + sound toggle + how-to-play
 *   2. Opens a server play session (solo or a challenge round)
 *   3. Mounts the engine and waits for the final score
 *   4. Submits the score and shows the result + rewards
 *   5. Allows replay
 *
 * Works on web/PWA directly and inside the Expo WebView (embed mode).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { getEngine } from "@/components/games/engineRegistry";
import type { GameDifficulty } from "@/components/games/types";

type Phase = "pregame" | "starting" | "playing" | "submitting" | "result" | "error";

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
  /** Optional how-to-play text shown in the How to Play modal. */
  howToPlay?: string | null;
  /** When set, each play is a round in this challenge instead of a solo run. */
  challengeId?: string | null;
  /** Bearer token for the Expo WebView (web uses cookies). */
  token?: string | null;
  /** Post lifecycle events to window.ReactNativeWebView (embed mode). */
  embed?: boolean;
  onExit?: () => void;
}

const DIFFICULTY_LABELS: Record<GameDifficulty, string> = {
  easy:   "Easy",
  medium: "Medium",
  hard:   "Hard",
};

const DIFFICULTY_COLORS: Record<GameDifficulty, string> = {
  easy:   "border-emerald-500 bg-emerald-950/40 text-emerald-300",
  medium: "border-amber-500 bg-amber-950/40 text-amber-300",
  hard:   "border-red-500 bg-red-950/40 text-red-300",
};

function getStoredDifficulty(slug: string): GameDifficulty {
  try {
    const v = localStorage.getItem(`game_diff_${slug}`);
    if (v === "easy" || v === "medium" || v === "hard") return v;
  } catch { /* */ }
  return "medium";
}
function setStoredDifficulty(slug: string, d: GameDifficulty) {
  try { localStorage.setItem(`game_diff_${slug}`, d); } catch { /* */ }
}
function getStoredSound(): boolean {
  try { return localStorage.getItem("game_sound") !== "off"; } catch { return true; }
}
function setStoredSound(on: boolean) {
  try { localStorage.setItem("game_sound", on ? "on" : "off"); } catch { /* */ }
}

export default function GameRunner({
  slug,
  engineKey,
  howToPlay,
  challengeId,
  token,
  embed,
  onExit,
}: GameRunnerProps) {
  const [phase, setPhase] = useState<Phase>("pregame");
  const [difficulty, setDifficulty] = useState<GameDifficulty>(() => getStoredDifficulty(slug));
  const [soundEnabled, setSoundEnabled] = useState<boolean>(() => getStoredSound());
  const [paused, setPaused] = useState(false);
  const [showHowTo, setShowHowTo] = useState(false);
  const [liveScore, setLiveScore] = useState(0);
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
    setLiveScore(0);
    setPaused(false);
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

  const handleScore = useCallback((score: number) => {
    setLiveScore(score);
  }, []);

  const toggleSound = () => {
    setSoundEnabled(prev => {
      const next = !prev;
      setStoredSound(next);
      return next;
    });
  };

  const changeDifficulty = (d: GameDifficulty) => {
    setDifficulty(d);
    setStoredDifficulty(slug, d);
  };

  // Close how-to modal on Escape
  useEffect(() => {
    if (!showHowTo) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") setShowHowTo(false); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [showHowTo]);

  if (!Engine) {
    return <p className="p-6 text-center text-sm text-red-400">This game is unavailable.</p>;
  }

  return (
    <div className="flex w-full flex-col items-center gap-4">

      {/* ── Pre-game setup screen ── */}
      {phase === "pregame" && (
        <div className="w-full max-w-sm mx-auto flex flex-col gap-4">
          {/* Difficulty */}
          <div>
            <p className="text-xs text-muted-foreground mb-2 font-medium uppercase tracking-wide">Difficulty</p>
            <div className="flex gap-2">
              {(["easy", "medium", "hard"] as GameDifficulty[]).map(d => (
                <button
                  key={d}
                  type="button"
                  onClick={() => changeDifficulty(d)}
                  className={`flex-1 py-2.5 rounded-xl border-2 text-sm font-bold transition-all ${
                    difficulty === d
                      ? DIFFICULTY_COLORS[d]
                      : "border-border bg-card text-muted-foreground hover:border-border/80"
                  }`}
                >
                  {DIFFICULTY_LABELS[d]}
                </button>
              ))}
            </div>
          </div>

          {/* Sound */}
          <div className="flex items-center justify-between rounded-xl border border-border bg-card px-4 py-3">
            <span className="text-sm font-medium text-foreground">Sound effects</span>
            <button
              type="button"
              onClick={toggleSound}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${soundEnabled ? "bg-primary" : "bg-neutral-700"}`}
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${soundEnabled ? "translate-x-6" : "translate-x-1"}`} />
            </button>
          </div>

          {/* How to Play */}
          {howToPlay && (
            <button
              type="button"
              onClick={() => setShowHowTo(true)}
              className="flex items-center justify-center gap-2 rounded-xl border border-border bg-card py-3 text-sm font-medium text-foreground hover:bg-accent transition-colors"
            >
              <span>❓</span> How to Play
            </button>
          )}

          {/* Start */}
          <button
            type="button"
            onClick={() => void start()}
            className="w-full py-4 rounded-2xl bg-primary text-primary-foreground font-bold text-lg hover:opacity-90 active:scale-95 transition-all"
          >
            Play →
          </button>
        </div>
      )}

      {/* ── Starting ── */}
      {phase === "starting" && (
        <p className="text-sm text-muted-foreground animate-pulse">Starting…</p>
      )}

      {/* ── Playing ── */}
      {phase === "playing" && (
        <div className="w-full flex flex-col items-center gap-3">
          {/* In-game HUD */}
          <div className="flex w-full max-w-sm items-center justify-between px-1">
            {/* Pause */}
            <button
              type="button"
              onClick={() => setPaused(p => !p)}
              className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-accent transition-colors"
            >
              {paused ? "▶ Resume" : "⏸ Pause"}
            </button>

            {/* Live score */}
            <span className="text-sm font-bold text-emerald-400">
              {liveScore > 0 ? `Score: ${liveScore}` : ""}
            </span>

            {/* Sound toggle */}
            <button
              type="button"
              onClick={toggleSound}
              className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-accent transition-colors"
              title={soundEnabled ? "Mute sounds" : "Unmute sounds"}
            >
              {soundEnabled ? "🔊" : "🔇"}
            </button>
          </div>

          {/* Pause overlay */}
          {paused && (
            <div className="w-full max-w-sm rounded-2xl border border-border bg-card/95 backdrop-blur p-6 text-center flex flex-col gap-3">
              <p className="text-lg font-bold text-foreground">Game Paused</p>
              <button
                type="button"
                onClick={() => setPaused(false)}
                className="py-3 rounded-xl bg-primary text-primary-foreground font-bold text-base hover:opacity-90"
              >
                ▶ Resume
              </button>
              {howToPlay && (
                <button
                  type="button"
                  onClick={() => setShowHowTo(true)}
                  className="py-2 rounded-xl border border-border text-sm font-medium text-foreground hover:bg-accent"
                >
                  ❓ How to Play
                </button>
              )}
            </div>
          )}

          <Engine
            onGameOver={handleGameOver}
            onScore={handleScore}
            difficulty={difficulty}
            paused={paused}
            soundEnabled={soundEnabled}
          />
        </div>
      )}

      {/* ── Submitting ── */}
      {phase === "submitting" && (
        <p className="text-sm text-muted-foreground animate-pulse">Saving your score…</p>
      )}

      {/* ── Result ── */}
      {phase === "result" && result && (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-card p-6 text-center w-full max-w-sm mx-auto">
          <div className="text-3xl font-black text-foreground">Score: {result.score}</div>
          {result.isNewBest && (
            <div className="text-sm font-semibold text-amber-400">🏆 New personal best!</div>
          )}
          {(result.reward.credits > 0 || result.reward.xp > 0 || result.reward.stars > 0) && (
            <div className="text-sm text-emerald-400 font-medium">
              {result.reward.credits > 0 ? `+${result.reward.credits} credits ` : ""}
              {result.reward.xp > 0 ? `+${result.reward.xp} XP ` : ""}
              {result.reward.stars > 0 ? `+${result.reward.stars} ⭐` : ""}
            </div>
          )}
          {result.challengeRoundId && (
            <div className="text-xs text-muted-foreground">Round submitted. Check the challenge for results.</div>
          )}
          <div className="flex gap-2 w-full mt-1">
            {!challengeId && (
              <button
                type="button"
                onClick={() => setPhase("pregame")}
                className="flex-1 rounded-xl bg-primary px-4 py-3 text-sm font-bold text-primary-foreground hover:opacity-90"
              >
                Play again
              </button>
            )}
            {onExit && (
              <button
                type="button"
                onClick={onExit}
                className="flex-1 rounded-xl border border-border px-4 py-3 text-sm font-semibold text-foreground hover:bg-accent"
              >
                Done
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Error ── */}
      {phase === "error" && (
        <div className="flex flex-col items-center gap-3 p-6 text-center">
          <p className="text-sm text-red-400">{error}</p>
          <button
            type="button"
            onClick={() => setPhase("pregame")}
            className="rounded-xl bg-card border border-border px-4 py-2 text-sm font-semibold text-foreground hover:bg-accent"
          >
            Try again
          </button>
        </div>
      )}

      {/* ── How to Play modal ── */}
      {showHowTo && howToPlay && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4"
          onClick={() => setShowHowTo(false)}
        >
          <div
            className="relative w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setShowHowTo(false)}
              className="absolute right-4 top-4 text-muted-foreground hover:text-foreground text-xl leading-none"
            >
              ✕
            </button>
            <h2 className="text-lg font-bold text-foreground mb-4">How to Play</h2>
            <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">{howToPlay}</p>
          </div>
        </div>
      )}
    </div>
  );
}
