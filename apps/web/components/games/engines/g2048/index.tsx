"use client";

/**
 * 2048 — slide tiles with arrow keys / WASD or swipe; merge equal tiles. Score
 * accrues from each merge. The game ends when no moves remain.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { GameEngineProps } from "@/components/games/types";

type Grid = number[][];
const N = 4;

function emptyGrid(): Grid {
  return Array.from({ length: N }, () => Array(N).fill(0));
}
function addRandom(g: Grid) {
  const empties: [number, number][] = [];
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (g[r][c] === 0) empties.push([r, c]);
  if (!empties.length) return;
  const [r, c] = empties[Math.floor(Math.random() * empties.length)];
  g[r][c] = Math.random() < 0.9 ? 2 : 4;
}
function rotate(g: Grid): Grid {
  const n = emptyGrid();
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) n[c][N - 1 - r] = g[r][c];
  return n;
}
function slideLeft(g: Grid): { grid: Grid; gained: number; moved: boolean } {
  let gained = 0;
  let moved = false;
  const out = g.map((row) => {
    const vals = row.filter((v) => v !== 0);
    for (let i = 0; i < vals.length - 1; i++) {
      if (vals[i] === vals[i + 1]) {
        vals[i] *= 2;
        gained += vals[i];
        vals.splice(i + 1, 1);
      }
    }
    while (vals.length < N) vals.push(0);
    if (vals.some((v, i) => v !== row[i])) moved = true;
    return vals;
  });
  return { grid: out, gained, moved };
}

const COLORS: Record<number, string> = {
  0: "#1e293b", 2: "#334155", 4: "#475569", 8: "#f59e0b", 16: "#f97316",
  32: "#ef4444", 64: "#dc2626", 128: "#22c55e", 256: "#16a34a",
  512: "#06b6d4", 1024: "#3b82f6", 2048: "#a855f7",
};

export default function Game2048({ onReady, onGameOver, onScore }: GameEngineProps) {
  const [grid, setGrid] = useState<Grid>(() => {
    const g = emptyGrid();
    addRandom(g); addRandom(g);
    return g;
  });
  const [score, setScore] = useState(0);
  const over = useRef(false);

  const canMove = useCallback((g: Grid): boolean => {
    for (let r = 0; r < N; r++)
      for (let c = 0; c < N; c++) {
        if (g[r][c] === 0) return true;
        if (c < N - 1 && g[r][c] === g[r][c + 1]) return true;
        if (r < N - 1 && g[r][c] === g[r + 1][c]) return true;
      }
    return false;
  }, []);

  const doMove = useCallback(
    (dir: 0 | 1 | 2 | 3) => {
      if (over.current) return;
      setGrid((prev) => {
        let g = prev.map((r) => [...r]);
        for (let i = 0; i < dir; i++) g = rotate(g);
        const { grid: slid, gained, moved } = slideLeft(g);
        let result = slid;
        for (let i = 0; i < (4 - dir) % 4; i++) result = rotate(result);
        if (!moved) return prev;
        addRandom(result);
        setScore((s) => {
          const ns = s + gained;
          onScore?.(ns);
          return ns;
        });
        if (!canMove(result)) {
          over.current = true;
          // Defer to let final score state settle.
          setScore((s) => { setTimeout(() => onGameOver(s), 0); return s; });
        }
        return result;
      });
    },
    [canMove, onGameOver, onScore]
  );

  useEffect(() => {
    onReady?.();
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === "arrowleft" || k === "a") doMove(0);
      else if (k === "arrowup" || k === "w") doMove(1);
      else if (k === "arrowright" || k === "d") doMove(2);
      else if (k === "arrowdown" || k === "s") doMove(3);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [doMove, onReady]);

  // touch swipe
  const touch = useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (!touch.current) return;
    const dx = e.changedTouches[0].clientX - touch.current.x;
    const dy = e.changedTouches[0].clientY - touch.current.y;
    if (Math.abs(dx) < 24 && Math.abs(dy) < 24) return;
    if (Math.abs(dx) > Math.abs(dy)) doMove(dx > 0 ? 2 : 0);
    else doMove(dy > 0 ? 3 : 1);
    touch.current = null;
  };

  return (
    <div className="flex flex-col items-center gap-2 select-none">
      <div className="text-sm font-semibold text-neutral-200">Score: {score}</div>
      <div
        className="grid grid-cols-4 gap-1.5 rounded-lg bg-neutral-800 p-1.5 touch-none"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        {grid.flat().map((v, i) => (
          <div
            key={i}
            className="flex h-16 w-16 items-center justify-center rounded-md text-lg font-bold text-white"
            style={{ backgroundColor: COLORS[v] ?? "#7c3aed" }}
          >
            {v || ""}
          </div>
        ))}
      </div>
      <p className="text-xs text-neutral-400">Arrow keys / WASD or swipe to merge tiles.</p>
    </div>
  );
}
