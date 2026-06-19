"use client";

/**
 * Color Tap — a colour name is shown in a random colour. Tap the tile whose
 * background matches the *name* (not the text colour). Classic Stroop test.
 * Score +10 per correct, -5 per wrong, 30 seconds on Medium.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import type { GameEngineProps } from "@/components/games/types";
import { useGameSound } from "@/components/games/useGameSound";

const COLORS = [
  { name: "Red",    hex: "#ef4444" },
  { name: "Blue",   hex: "#3b82f6" },
  { name: "Green",  hex: "#22c55e" },
  { name: "Yellow", hex: "#eab308" },
  { name: "Purple", hex: "#a855f7" },
  { name: "Orange", hex: "#f97316" },
];
const DURATIONS: Record<string, number> = { easy: 45, medium: 30, hard: 20 };
const TILE_COUNT = 4;

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

interface Round {
  targetName: string;
  tiles: typeof COLORS;
  displayColor: string; // the colour the word is printed in (distractor)
}

function newRound(): Round {
  const target = COLORS[Math.floor(Math.random() * COLORS.length)];
  const others = shuffle(COLORS.filter((c) => c.name !== target.name));
  const tiles = shuffle([target, ...others.slice(0, TILE_COUNT - 1)]);
  const displayColor = COLORS.filter((c) => c.name !== target.name)[Math.floor(Math.random() * (COLORS.length - 1))].hex;
  return { targetName: target.name, tiles, displayColor };
}

export default function ColorTapGame({ onReady, onGameOver, onScore, difficulty = "medium", paused, soundEnabled = true }: GameEngineProps) {
  const dur = DURATIONS[difficulty] ?? 30;
  const [round, setRound] = useState<Round>(newRound);
  const [score, setScore] = useState(0);
  const [timeLeft, setTimeLeft] = useState(dur);
  const [flash, setFlash] = useState<"correct" | "wrong" | null>(null);
  const scoreRef = useRef(0);
  const overRef = useRef(false);
  const pausedRef = useRef(paused);
  const play = useGameSound(soundEnabled ?? true);

  useEffect(() => { pausedRef.current = paused; }, [paused]);
  useEffect(() => { onReady?.(); }, [onReady]);

  useEffect(() => {
    const id = setInterval(() => {
      if (pausedRef.current || overRef.current) return;
      setTimeLeft((t) => {
        if (t <= 1) {
          clearInterval(id);
          overRef.current = true;
          onGameOver(scoreRef.current);
          return 0;
        }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [onGameOver]);

  const handleTap = useCallback((colorName: string) => {
    if (overRef.current || pausedRef.current) return;
    const correct = colorName === round.targetName;
    if (correct) {
      scoreRef.current += 10;
      play("score");
    } else {
      scoreRef.current = Math.max(0, scoreRef.current - 5);
      play("miss");
    }
    setScore(scoreRef.current);
    onScore?.(scoreRef.current);
    setFlash(correct ? "correct" : "wrong");
    setTimeout(() => { setFlash(null); setRound(newRound()); }, 350);
  }, [round, onScore, play]);

  const urgency = timeLeft <= 5;

  return (
    <div className="flex flex-col items-center gap-4 select-none w-full max-w-sm mx-auto">
      <div className="flex w-full items-center justify-between text-sm font-semibold px-1">
        <span className="text-emerald-400">Score: {score}</span>
        <span className={urgency ? "text-red-400 animate-pulse" : "text-neutral-300"}>{timeLeft}s</span>
      </div>
      <div className="w-full h-1.5 bg-neutral-800 rounded-full">
        <div className="h-full bg-emerald-500 rounded-full transition-all duration-1000" style={{ width: `${(timeLeft / dur) * 100}%` }} />
      </div>

      {/* The prompt — word is shown in a distracting colour */}
      <div
        className={`w-full rounded-xl py-6 text-center text-4xl font-black transition-all duration-150 ${flash === "correct" ? "bg-emerald-900/60" : flash === "wrong" ? "bg-red-900/60" : "bg-neutral-900"}`}
      >
        <span style={{ color: round.displayColor }}>{round.targetName}</span>
        <p className="text-sm font-normal text-neutral-400 mt-2">Tap the tile that matches the word</p>
      </div>

      {/* Colour tiles */}
      <div className="grid grid-cols-2 gap-3 w-full">
        {round.tiles.map((c) => (
          <button
            key={c.name}
            type="button"
            onClick={() => handleTap(c.name)}
            className="h-20 rounded-xl font-bold text-white text-lg shadow-md active:scale-95 transition-transform"
            style={{ backgroundColor: c.hex }}
          >
            {c.name}
          </button>
        ))}
      </div>
    </div>
  );
}
