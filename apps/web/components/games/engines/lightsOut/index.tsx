"use client";

/**
 * Lights Out — classic puzzle. Toggle a cell and its orthogonal neighbors.
 * Goal: turn ALL lights OFF. Start from a guaranteed-solvable scramble.
 * Score = max(0, 500 - moves_taken * 10).
 */

import { useEffect, useState, useCallback, useRef } from "react";
import type { GameEngineProps } from "@/components/games/types";
import { useGameSound } from "@/components/games/useGameSound";

const GRID_MAP: Record<string, { size: number; scrambleMoves: number }> = {
  easy:   { size: 4, scrambleMoves: 8  },
  medium: { size: 5, scrambleMoves: 12 },
  hard:   { size: 6, scrambleMoves: 16 },
};

/** Apply one toggle operation to a grid (mutates a copy). */
function applyToggle(grid: boolean[], size: number, r: number, c: number): boolean[] {
  const next = [...grid];
  const neighbors: [number, number][] = [
    [r, c],
    [r - 1, c],
    [r + 1, c],
    [r, c - 1],
    [r, c + 1],
  ];
  for (const [nr, nc] of neighbors) {
    if (nr >= 0 && nr < size && nc >= 0 && nc < size) {
      next[nr * size + nc] = !next[nr * size + nc];
    }
  }
  return next;
}

/** Build a solvable puzzle by starting from all-OFF then applying N random toggles. */
function buildGrid(size: number, scrambleMoves: number): boolean[] {
  let grid = Array(size * size).fill(false);
  for (let i = 0; i < scrambleMoves; i++) {
    const r = Math.floor(Math.random() * size);
    const c = Math.floor(Math.random() * size);
    grid = applyToggle(grid, size, r, c);
  }
  // Edge case: if scramble left us with all-OFF (already solved), do one guaranteed toggle
  if (grid.every((cell) => !cell)) {
    grid = applyToggle(grid, size, 0, 0);
  }
  return grid;
}

function isSolved(grid: boolean[]): boolean {
  return grid.every((cell) => !cell);
}

export default function LightsOutGame({
  onReady,
  onGameOver,
  onScore,
  difficulty = "medium",
  paused,
  soundEnabled = true,
}: GameEngineProps) {
  const { size, scrambleMoves } = GRID_MAP[difficulty] ?? GRID_MAP.medium;
  const [grid, setGrid] = useState<boolean[]>(() => buildGrid(size, scrambleMoves));
  const [moves, setMoves] = useState(0);
  const [done, setDone] = useState(false);

  const play = useGameSound(soundEnabled ?? true);
  const pausedRef = useRef(paused);
  const doneRef = useRef(false);

  useEffect(() => { pausedRef.current = paused; }, [paused]);
  useEffect(() => { onReady?.(); }, [onReady]);

  const handleToggle = useCallback(
    (r: number, c: number) => {
      if (pausedRef.current || doneRef.current) return;

      play("click");
      setGrid((prev) => {
        const next = applyToggle(prev, size, r, c);
        return next;
      });
      setMoves((m) => {
        const newMoves = m + 1;
        return newMoves;
      });
    },
    [play, size]
  );

  // Check win after each grid/moves update
  useEffect(() => {
    if (doneRef.current) return;
    if (isSolved(grid) && moves > 0) {
      const score = Math.max(0, 500 - moves * 10);
      doneRef.current = true;
      setDone(true);
      play("win");
      onScore?.(score);
      onGameOver(score);
    }
  }, [grid, moves, play, onScore, onGameOver]);

  const litCount = grid.filter(Boolean).length;
  const score = Math.max(0, 500 - moves * 10);

  return (
    <div className="flex flex-col items-center gap-3 select-none w-full max-w-sm mx-auto">
      {/* Header */}
      <div className="flex w-full items-center justify-between text-sm px-1">
        <span className="text-muted-foreground">
          Moves: <span className="text-foreground font-semibold">{moves}</span>
        </span>
        <span className="text-muted-foreground">
          Lit:{" "}
          <span className={litCount === 0 ? "text-emerald-400 font-bold" : "text-yellow-400 font-semibold"}>
            {litCount}
          </span>
        </span>
        <span className="text-muted-foreground">
          Score: <span className="text-foreground font-semibold">{score}</span>
        </span>
      </div>

      {/* Win banner */}
      {done && (
        <div className="w-full rounded-xl bg-emerald-950/40 border border-emerald-500/40 px-4 py-3 text-center">
          <p className="text-emerald-400 font-bold text-lg">All lights out!</p>
          <p className="text-muted-foreground text-sm mt-0.5">
            Solved in {moves} move{moves !== 1 ? "s" : ""} — Score: {score}
          </p>
        </div>
      )}

      {/* Grid */}
      <div
        className="grid gap-1.5 w-full"
        style={{ gridTemplateColumns: `repeat(${size}, 1fr)` }}
      >
        {grid.map((lit, idx) => {
          const r = Math.floor(idx / size);
          const c = idx % size;
          return (
            <button
              key={idx}
              type="button"
              onClick={() => handleToggle(r, c)}
              disabled={done}
              aria-label={`Cell ${r + 1}-${c + 1} ${lit ? "lit" : "dark"}`}
              className={[
                "aspect-square rounded-lg border-2 transition-all duration-150",
                "flex items-center justify-center",
                lit
                  ? "bg-yellow-400 shadow-lg shadow-yellow-400/50 border-yellow-300 scale-105"
                  : "bg-slate-800 border-slate-600 hover:border-slate-500 hover:bg-slate-700",
                done ? "cursor-default" : "cursor-pointer active:scale-95",
              ].join(" ")}
            />
          );
        })}
      </div>

      {/* Instructions */}
      {!done && (
        <p className="text-xs text-muted-foreground text-center">
          Tap a cell to toggle it and its neighbors — turn all lights off.
        </p>
      )}
    </div>
  );
}
