"use client";

/**
 * Color Sort — pour coloured balls between tubes until each tube is one colour.
 * Score = 200 per solved tube + speed bonus.
 */

import { useEffect, useState, useCallback, useRef } from "react";
import type { GameEngineProps } from "@/components/games/types";
import { useGameSound } from "@/components/games/useGameSound";

const COLORS = ["#ef4444","#3b82f6","#22c55e","#fbbf24","#a855f7","#f97316","#ec4899","#14b8a6"];
const TUBE_HEIGHT = 4; // balls per tube

const CONFIGS: Record<string, { colors: number; extra_empty: number }> = {
  easy:   { colors: 4, extra_empty: 2 },
  medium: { colors: 6, extra_empty: 2 },
  hard:   { colors: 8, extra_empty: 1 },
};

type Tube = string[]; // array of color strings, bottom to top

function buildLevel(numColors: number): Tube[] {
  const pool: string[] = [];
  for (let c = 0; c < numColors; c++) {
    for (let i = 0; i < TUBE_HEIGHT; i++) pool.push(COLORS[c]);
  }
  // Shuffle
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const tubes: Tube[] = [];
  for (let c = 0; c < numColors; c++) {
    tubes.push(pool.slice(c * TUBE_HEIGHT, (c + 1) * TUBE_HEIGHT));
  }
  return tubes;
}

function isSolved(tubes: Tube[], numColors: number): boolean {
  const filled = tubes.filter((t) => t.length > 0);
  if (filled.length !== numColors) return false;
  return filled.every((t) => t.length === TUBE_HEIGHT && t.every((c) => c === t[0]));
}

export default function ColorSortGame({ onReady, onGameOver, onScore, difficulty = "medium", paused, soundEnabled = true }: GameEngineProps) {
  const { colors: numColors, extra_empty } = CONFIGS[difficulty] ?? CONFIGS.medium;
  const [tubes, setTubes] = useState<Tube[]>(() => {
    const level = buildLevel(numColors);
    for (let i = 0; i < extra_empty; i++) level.push([]);
    return level;
  });
  const [selected, setSelected] = useState<number | null>(null);
  const [moves, setMoves] = useState(0);
  const [done, setDone] = useState(false);
  const startTime = useRef(Date.now());
  const play = useGameSound(soundEnabled ?? true);
  const pausedRef = useRef(paused);

  useEffect(() => { pausedRef.current = paused; }, [paused]);
  useEffect(() => { onReady?.(); }, [onReady]);

  const pick = useCallback((idx: number) => {
    if (pausedRef.current || done) return;

    if (selected === null) {
      if (tubes[idx].length === 0) return;
      setSelected(idx);
      return;
    }

    if (selected === idx) { setSelected(null); return; }

    const from = tubes[selected];
    const to = tubes[idx];
    if (from.length === 0) { setSelected(idx); return; }
    if (to.length >= TUBE_HEIGHT) { play("miss"); setSelected(null); return; }

    const topFrom = from[from.length - 1];
    if (to.length > 0 && to[to.length - 1] !== topFrom) { play("miss"); setSelected(null); return; }

    // Pour: move all matching top balls from `from` to `to`
    play("drop");
    const newTubes = tubes.map((t) => [...t]);
    let poured = 0;
    while (newTubes[selected].length > 0 && newTubes[idx].length < TUBE_HEIGHT &&
           newTubes[selected][newTubes[selected].length - 1] === topFrom) {
      newTubes[idx].push(newTubes[selected].pop()!);
      poured++;
    }
    if (poured === 0) { setSelected(null); return; }

    setTubes(newTubes);
    setSelected(null);
    const newMoves = moves + 1;
    setMoves(newMoves);

    if (isSolved(newTubes, numColors)) {
      const elapsed = (Date.now() - startTime.current) / 1000;
      const score = Math.max(0, numColors * 200 - newMoves * 10 + Math.max(0, Math.round(300 - elapsed)));
      play("win");
      onScore?.(score);
      onGameOver(score);
      setDone(true);
    }
  }, [tubes, selected, done, moves, numColors, onScore, onGameOver, play]);

  return (
    <div className="flex flex-col items-center gap-4 select-none">
      <div className="flex w-full max-w-sm items-center justify-between text-sm px-1">
        <span className="text-muted-foreground">Moves: <span className="text-foreground font-semibold">{moves}</span></span>
        {done && <span className="text-emerald-400 font-bold">Solved! 🎉</span>}
      </div>
      <div className="flex flex-wrap justify-center gap-3">
        {tubes.map((tube, i) => (
          <button
            key={i}
            type="button"
            onClick={() => pick(i)}
            className={`flex flex-col-reverse items-center justify-start w-12 rounded-xl border-2 overflow-hidden transition-all ${
              selected === i ? "border-primary shadow-lg shadow-primary/20 scale-110" : "border-border hover:border-primary/40"
            } ${done ? "opacity-80" : ""}`}
            style={{ height: TUBE_HEIGHT * 32 + 8, background: "var(--color-card)" }}
          >
            {tube.map((color, j) => (
              <div key={j} className="w-full rounded-sm transition-all" style={{ height: 28, backgroundColor: color, margin: 2 }} />
            ))}
          </button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        {selected !== null ? "Now tap a tube to pour into" : "Tap a tube to select"}
      </p>
    </div>
  );
}
