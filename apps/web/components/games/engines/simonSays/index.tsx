"use client";

/**
 * Simon Says — watch the colour sequence and repeat it.
 * Score = level × 50. Each level adds one more step.
 */

import { useEffect, useState, useCallback, useRef } from "react";
import type { GameEngineProps } from "@/components/games/types";
import { useGameSound } from "@/components/games/useGameSound";

const COLOURS = [
  { id: 0, bg: "bg-red-500",    activeBg: "bg-red-300",    label: "🔴", sound: 660  as const },
  { id: 1, bg: "bg-blue-500",   activeBg: "bg-blue-300",   label: "🔵", sound: 880  as const },
  { id: 2, bg: "bg-green-500",  activeBg: "bg-green-300",  label: "🟢", sound: 550  as const },
  { id: 3, bg: "bg-yellow-400", activeBg: "bg-yellow-200", label: "🟡", sound: 440  as const },
];
const SHOW_DELAY: Record<string, number> = { easy: 800, medium: 550, hard: 380 };

export default function SimonSaysGame({ onReady, onGameOver, onScore, difficulty = "medium", paused, soundEnabled = true }: GameEngineProps) {
  const showDelay = SHOW_DELAY[difficulty] ?? 550;
  const [sequence, setSequence] = useState<number[]>([]);
  const [active, setActive] = useState<number | null>(null);
  const [phase, setPhase] = useState<"showing"|"input"|"over"|"start">("start");
  const [userIdx, setUserIdx] = useState(0);
  const [level, setLevel] = useState(0);
  const [score, setScore] = useState(0);
  const play = useGameSound(soundEnabled ?? true);
  const pausedRef = useRef(paused);
  const phaseRef = useRef(phase);

  useEffect(() => { pausedRef.current = paused; phaseRef.current = phase; }, [paused, phase]);
  useEffect(() => { onReady?.(); }, [onReady]);

  const flash = useCallback((colourId: number, ms = showDelay) => {
    return new Promise<void>((resolve) => {
      setActive(colourId);
      play("tap");
      setTimeout(() => { setActive(null); setTimeout(resolve, ms * 0.3); }, ms * 0.7);
    });
  }, [play, showDelay]);

  const showSequence = useCallback(async (seq: number[]) => {
    setPhase("showing");
    await new Promise((r) => setTimeout(r, 500));
    for (const id of seq) {
      if (pausedRef.current) await new Promise<void>((r) => { const t = setInterval(() => { if (!pausedRef.current) { clearInterval(t); r(); } }, 100); });
      await flash(id);
      await new Promise((r) => setTimeout(r, showDelay * 0.2));
    }
    setUserIdx(0);
    setPhase("input");
  }, [flash, showDelay]);

  const startGame = useCallback(() => {
    const first = Math.floor(Math.random() * 4);
    const seq = [first];
    setSequence(seq);
    setLevel(1);
    setScore(0);
    void showSequence(seq);
  }, [showSequence]);

  const handleTap = useCallback((id: number) => {
    if (phase !== "input" || pausedRef.current) return;
    void flash(id, showDelay * 0.5);
    const expected = sequence[userIdx];
    if (id !== expected) {
      play("lose");
      setPhase("over");
      onGameOver(score);
      return;
    }
    const nextIdx = userIdx + 1;
    if (nextIdx >= sequence.length) {
      // Level complete
      const newLevel = level + 1;
      const newScore = newLevel * 50;
      setLevel(newLevel);
      setScore(newScore);
      onScore?.(newScore);
      play("levelUp");
      const next = Math.floor(Math.random() * 4);
      const newSeq = [...sequence, next];
      setSequence(newSeq);
      setTimeout(() => void showSequence(newSeq), 600);
    } else {
      setUserIdx(nextIdx);
    }
  }, [phase, sequence, userIdx, level, score, flash, showDelay, onScore, onGameOver, play, showSequence]);

  return (
    <div className="flex flex-col items-center gap-5 select-none">
      <div className="flex w-full max-w-xs items-center justify-between text-sm px-1">
        <span className="text-muted-foreground">Level {level}</span>
        <span className={`font-semibold ${phase === "input" ? "text-emerald-400" : phase === "showing" ? "text-amber-400" : "text-foreground"}`}>
          {phase === "showing" ? "Watch…" : phase === "input" ? "Your turn!" : phase === "over" ? "Game over!" : ""}
        </span>
        <span className="text-emerald-400">Score: {score}</span>
      </div>

      <div className="grid grid-cols-2 gap-4 w-full max-w-xs">
        {COLOURS.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => handleTap(c.id)}
            disabled={phase !== "input"}
            className={`h-32 rounded-2xl text-4xl flex items-center justify-center border-4 border-white/10 transition-all duration-100 ${active === c.id ? c.activeBg + " scale-110 shadow-xl" : c.bg} ${phase === "input" ? "hover:scale-105 active:scale-95 cursor-pointer" : "opacity-80 cursor-default"}`}
          >
            {c.label}
          </button>
        ))}
      </div>

      {phase === "start" && (
        <button type="button" onClick={startGame}
          className="mt-2 px-8 py-3 rounded-xl bg-primary text-primary-foreground font-bold text-lg hover:opacity-90">
          Start Game
        </button>
      )}

      {phase === "over" && (
        <div className="text-center space-y-2">
          <p className="text-red-400 font-bold">Wrong colour!</p>
          <button type="button" onClick={startGame}
            className="px-6 py-2 rounded-xl bg-primary text-primary-foreground font-semibold">
            Try Again
          </button>
        </div>
      )}

      {phase === "showing" && <p className="text-xs text-amber-400 animate-pulse">Remember the sequence…</p>}
      {phase === "input" && <p className="text-xs text-muted-foreground">Repeat the {sequence.length}-step sequence</p>}
    </div>
  );
}
