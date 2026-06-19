"use client";

/**
 * Reaction Rush — tap as soon as the circle turns green.
 * Score = average reaction time score (lower ms = higher score).
 * 5 rounds per game. Score = 10000 - avg_ms (floored at 0).
 */

import { useEffect, useRef, useState, useCallback } from "react";
import type { GameEngineProps } from "@/components/games/types";
import { useGameSound } from "@/components/games/useGameSound";

const ROUNDS = 5;
const MIN_WAIT: Record<string, number> = { easy: 1200, medium: 800, hard: 500 };
const MAX_WAIT: Record<string, number> = { easy: 3000, medium: 2500, hard: 2000 };

type Phase = "waiting" | "ready" | "tapped" | "too_early" | "done";

export default function ReactionRushGame({ onReady, onGameOver, onScore, difficulty = "medium", paused, soundEnabled = true }: GameEngineProps) {
  const [phase, setPhase] = useState<Phase>("waiting");
  const [round, setRound] = useState(1);
  const [reactionMs, setReactionMs] = useState<number | null>(null);
  const [times, setTimes] = useState<number[]>([]);
  const [score, setScore] = useState(0);
  const greenAt = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const play = useGameSound(soundEnabled ?? true);
  const minWait = MIN_WAIT[difficulty] ?? 800;
  const maxWait = MAX_WAIT[difficulty] ?? 2500;

  useEffect(() => { onReady?.(); }, [onReady]);

  const startRound = useCallback(() => {
    setPhase("waiting");
    setReactionMs(null);
    const wait = minWait + Math.random() * (maxWait - minWait);
    timerRef.current = setTimeout(() => {
      if (paused) return;
      setPhase("ready");
      greenAt.current = Date.now();
      play("tap");
    }, wait);
  }, [minWait, maxWait, paused, play]);

  useEffect(() => {
    startRound();
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleTap = useCallback(() => {
    if (paused) return;
    if (phase === "waiting") {
      if (timerRef.current) clearTimeout(timerRef.current);
      setPhase("too_early");
      play("miss");
      setTimeout(() => {
        setTimes((t) => [...t, 999]);
        const next = round + 1;
        if (next > ROUNDS) {
          const all = [...times, 999];
          const avg = all.reduce((a, b) => a + b, 0) / all.length;
          const sc = Math.max(0, Math.round(10000 - avg));
          setScore(sc);
          onScore?.(sc);
          onGameOver(sc);
          setPhase("done");
        } else {
          setRound(next);
          startRound();
        }
      }, 1000);
    } else if (phase === "ready") {
      const ms = Date.now() - (greenAt.current ?? Date.now());
      setReactionMs(ms);
      setPhase("tapped");
      play("score");
      const newTimes = [...times, ms];
      setTimes(newTimes);
      if (round >= ROUNDS) {
        const avg = newTimes.reduce((a, b) => a + b, 0) / newTimes.length;
        const sc = Math.max(0, Math.round(10000 - avg));
        setScore(sc);
        onScore?.(sc);
        setTimeout(() => { onGameOver(sc); setPhase("done"); }, 1200);
      } else {
        setTimeout(() => { setRound((r) => r + 1); startRound(); }, 1200);
      }
    }
  }, [phase, paused, round, times, onScore, onGameOver, play, startRound]);

  const avgMs = times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : null;

  const bg =
    phase === "ready" ? "bg-emerald-500 hover:bg-emerald-400" :
    phase === "too_early" ? "bg-red-600" :
    phase === "tapped" ? "bg-sky-500" :
    "bg-neutral-700 hover:bg-neutral-600";

  const label =
    phase === "waiting" ? "Wait…" :
    phase === "ready" ? "TAP NOW!" :
    phase === "too_early" ? "Too early! 😬" :
    phase === "tapped" ? `${reactionMs} ms!` :
    "Done!";

  return (
    <div className="flex flex-col items-center gap-5 select-none">
      <div className="flex w-full max-w-xs items-center justify-between text-sm text-neutral-300 px-1">
        <span>Round {round}/{ROUNDS}</span>
        {avgMs !== null && <span>Avg: {avgMs} ms</span>}
      </div>

      <button
        type="button"
        onClick={handleTap}
        disabled={phase === "done"}
        className={`w-64 h-64 rounded-full flex items-center justify-center text-2xl font-bold text-white transition-all duration-150 shadow-lg ${bg}`}
      >
        <div className="flex flex-col items-center gap-2">
          <span className="text-5xl">{phase === "ready" ? "🟢" : phase === "too_early" ? "❌" : phase === "tapped" ? "✅" : "🔴"}</span>
          <span>{label}</span>
        </div>
      </button>

      {times.length > 0 && (
        <div className="text-xs text-neutral-400 text-center">
          {times.map((t, i) => (
            <span key={i} className="mx-1">{t >= 999 ? "❌" : `${t}ms`}</span>
          ))}
        </div>
      )}

      {phase === "done" && (
        <div className="text-center">
          <div className="text-emerald-400 font-bold text-lg">Score: {score}</div>
          <div className="text-neutral-400 text-sm">Best reaction: {Math.min(...times.filter(t => t < 999))}ms</div>
        </div>
      )}
      <p className="text-xs text-neutral-500">Tap the moment you see green!</p>
    </div>
  );
}
