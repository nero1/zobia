"use client";

/**
 * Gem Swap — Match-3 puzzle (Candy Crush lite).
 * Click a gem, then click an adjacent gem to swap.
 * 3+ in a row/column disappears → gems fall → new gems fill top.
 * Cascades multiply score. 60 second timer.
 */

import { useEffect, useState, useCallback, useRef } from "react";
import type { GameEngineProps } from "@/components/games/types";
import { useGameSound } from "@/components/games/useGameSound";

const GEM_COLORS = [
  { bg: "bg-red-500",    label: "R", id: 0 },
  { bg: "bg-blue-500",   label: "B", id: 1 },
  { bg: "bg-green-500",  label: "G", id: 2 },
  { bg: "bg-yellow-400", label: "Y", id: 3 },
  { bg: "bg-purple-500", label: "P", id: 4 },
  { bg: "bg-orange-500", label: "O", id: 5 },
];

const GRID_CFG = {
  easy:   { size: 5, types: 5, time: 60 },
  medium: { size: 7, types: 6, time: 60 },
  hard:   { size: 8, types: 6, time: 60 },
};

type Grid = number[][];

function makeGrid(size: number, types: number): Grid {
  const grid: Grid = [];
  for (let r = 0; r < size; r++) {
    const row: number[] = [];
    for (let c = 0; c < size; c++) {
      let gem: number;
      do {
        gem = Math.floor(Math.random() * types);
      } while (
        // avoid starting matches
        (c >= 2 && row[c - 1] === gem && row[c - 2] === gem) ||
        (r >= 2 && grid[r - 1][c] === gem && grid[r - 2][c] === gem)
      );
      row.push(gem);
    }
    grid.push(row);
  }
  return grid;
}

function findMatches(grid: Grid, size: number): Set<string> {
  const matched = new Set<string>();
  // horizontal
  for (let r = 0; r < size; r++) {
    let run = 1;
    for (let c = 1; c < size; c++) {
      if (grid[r][c] === grid[r][c - 1]) {
        run++;
        if (run >= 3) {
          for (let k = c - run + 1; k <= c; k++) matched.add(`${r},${k}`);
        }
      } else {
        run = 1;
      }
    }
  }
  // vertical
  for (let c = 0; c < size; c++) {
    let run = 1;
    for (let r = 1; r < size; r++) {
      if (grid[r][c] === grid[r - 1][c]) {
        run++;
        if (run >= 3) {
          for (let k = r - run + 1; k <= r; k++) matched.add(`${k},${c}`);
        }
      } else {
        run = 1;
      }
    }
  }
  return matched;
}

function applyGravity(grid: Grid, size: number, types: number): Grid {
  const next = grid.map((row) => [...row]);
  for (let c = 0; c < size; c++) {
    // collect non-null gems from bottom
    const col: number[] = [];
    for (let r = size - 1; r >= 0; r--) {
      if (next[r][c] !== -1) col.push(next[r][c]);
    }
    // fill remaining from top with new gems
    while (col.length < size) col.push(Math.floor(Math.random() * types));
    // put back (col[0] is at bottom)
    for (let r = size - 1; r >= 0; r--) {
      next[r][c] = col[size - 1 - r];
    }
  }
  return next;
}

export default function GemSwapGame({
  onReady, onGameOver, onScore, difficulty = "medium", paused, soundEnabled = true,
}: GameEngineProps) {
  const cfg = GRID_CFG[difficulty] ?? GRID_CFG.medium;
  const { size, types, time } = cfg;

  const [grid, setGrid] = useState<Grid>(() => makeGrid(size, types));
  const [selected, setSelected] = useState<[number, number] | null>(null);
  const [removing, setRemoving] = useState<Set<string>>(new Set());
  const [score, setScore] = useState(0);
  const [timeLeft, setTimeLeft] = useState(time);
  const [combo, setCombo] = useState(0);
  const [busy, setBusy] = useState(false);
  const [gameOver, setGameOver] = useState(false);

  const play = useGameSound(soundEnabled ?? true);
  const pausedRef = useRef(paused);
  const scoreRef = useRef(0);
  const overRef = useRef(false);
  const gridRef = useRef(grid);

  useEffect(() => { pausedRef.current = paused; }, [paused]);
  useEffect(() => { onReady?.(); }, [onReady]);
  useEffect(() => { gridRef.current = grid; }, [grid]);

  // Timer
  useEffect(() => {
    const id = setInterval(() => {
      if (pausedRef.current || overRef.current) return;
      setTimeLeft((t) => {
        if (t <= 1) {
          overRef.current = true;
          clearInterval(id);
          play("win");
          setGameOver(true);
          onGameOver(scoreRef.current);
          return 0;
        }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [onGameOver, play]);

  // Cascade resolution: find matches, remove, fall, repeat
  const resolveGrid = useCallback(
    async (g: Grid, cascadeCount: number) => {
      let current = g;
      let cascade = cascadeCount;

      while (true) {
        const matches = findMatches(current, size);
        if (matches.size === 0) break;

        setRemoving(matches);
        play(cascade === 0 ? "match" : "score");
        await new Promise<void>((r) => setTimeout(r, 300));

        // remove matched
        const next = current.map((row, r) =>
          row.map((gem, c) => (matches.has(`${r},${c}`) ? -1 : gem))
        );
        setRemoving(new Set());

        // gravity
        const fallen = applyGravity(next, size, types);
        setGrid(fallen);
        current = fallen;

        const pts = matches.size * 10 * (cascade + 1);
        scoreRef.current += pts;
        setScore(scoreRef.current);
        onScore?.(scoreRef.current);
        setCombo(cascade + 1);
        cascade++;
        await new Promise<void>((r) => setTimeout(r, 200));
      }

      setCombo(0);
      setBusy(false);
    },
    [size, types, onScore, play]
  );

  const handleGemClick = useCallback(
    (r: number, c: number) => {
      if (pausedRef.current || busy || overRef.current) return;

      if (!selected) {
        setSelected([r, c]);
        play("tap");
        return;
      }

      const [sr, sc] = selected;
      setSelected(null);

      // Must be adjacent
      const dr = Math.abs(r - sr);
      const dc = Math.abs(c - sc);
      if ((dr === 1 && dc === 0) || (dr === 0 && dc === 1)) {
        // Swap
        const g = gridRef.current.map((row) => [...row]);
        [g[sr][sc], g[r][c]] = [g[r][c], g[sr][sc]];

        // Check if swap creates a match
        const matches = findMatches(g, size);
        if (matches.size > 0) {
          setBusy(true);
          setGrid(g);
          play("tap");
          setTimeout(() => resolveGrid(g, 0), 100);
        }
        // If no match, swap back silently
      }
    },
    [selected, busy, size, play, resolveGrid]
  );

  const urgency = timeLeft <= 10;

  return (
    <div className="flex flex-col items-center gap-3 select-none w-full max-w-sm mx-auto">
      {/* Header */}
      <div className="flex w-full items-center justify-between text-sm font-semibold px-1">
        <span className="text-emerald-400 font-bold text-lg">{score}</span>
        {combo > 1 && (
          <span className="text-yellow-400 font-bold animate-bounce">x{combo} Combo!</span>
        )}
        <span className={urgency ? "text-red-400 animate-pulse font-bold" : "text-muted-foreground"}>
          {timeLeft}s
        </span>
      </div>

      {/* Timer bar */}
      <div className="w-full h-1.5 bg-neutral-800 rounded-full">
        <div
          className={`h-full rounded-full transition-all duration-1000 ${urgency ? "bg-red-500" : "bg-emerald-500"}`}
          style={{ width: `${(timeLeft / time) * 100}%` }}
        />
      </div>

      {/* Grid */}
      <div
        className="grid gap-1 w-full"
        style={{ gridTemplateColumns: `repeat(${size}, 1fr)` }}
      >
        {grid.map((row, r) =>
          row.map((gem, c) => {
            const color = GEM_COLORS[gem] ?? GEM_COLORS[0];
            const key = `${r},${c}`;
            const isSelected = selected?.[0] === r && selected?.[1] === c;
            const isRemoving = removing.has(key);
            return (
              <button
                key={key}
                type="button"
                onClick={() => handleGemClick(r, c)}
                className={`
                  aspect-square rounded-md flex items-center justify-center
                  text-white font-bold text-xs transition-all duration-150
                  ${color.bg}
                  ${isSelected ? "ring-2 ring-white scale-110" : ""}
                  ${isRemoving ? "opacity-0 scale-50" : "opacity-100 scale-100"}
                  active:scale-90
                `}
              >
                {color.label}
              </button>
            );
          })
        )}
      </div>

      {gameOver && (
        <div className="flex flex-col items-center gap-1 mt-2">
          <span className="text-4xl animate-bounce">🎉</span>
          <span className="text-emerald-400 font-bold text-xl">Time&apos;s Up!</span>
          <span className="text-muted-foreground text-sm">Final Score: {score}</span>
        </div>
      )}
    </div>
  );
}
