"use client";

/**
 * 2048 — slide tiles with arrow keys / WASD or swipe; merge equal tiles.
 * Score accrues from each merge. The game ends when no moves remain.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { GameEngineProps } from "@/components/games/types";
import { useGameSound } from "@/components/games/useGameSound";

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
function rotateGrid(g: Grid): Grid {
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

const TILE_COLORS: Record<number, { bg: string; text: string }> = {
  0:    { bg: "#1e293b", text: "transparent" },
  2:    { bg: "#334155", text: "#e2e8f0" },
  4:    { bg: "#475569", text: "#e2e8f0" },
  8:    { bg: "#f59e0b", text: "#1c1917" },
  16:   { bg: "#f97316", text: "#fff" },
  32:   { bg: "#ef4444", text: "#fff" },
  64:   { bg: "#dc2626", text: "#fff" },
  128:  { bg: "#22c55e", text: "#fff" },
  256:  { bg: "#16a34a", text: "#fff" },
  512:  { bg: "#06b6d4", text: "#fff" },
  1024: { bg: "#3b82f6", text: "#fff" },
  2048: { bg: "#a855f7", text: "#fff" },
};

export default function Game2048({ onReady, onGameOver, onScore, paused, soundEnabled = true }: GameEngineProps) {
  const [grid, setGrid] = useState<Grid>(() => {
    const g = emptyGrid();
    addRandom(g); addRandom(g);
    return g;
  });
  const [score, setScore] = useState(0);
  const over = useRef(false);
  const pausedRef = useRef(paused);
  const play = useGameSound(soundEnabled ?? true);

  useEffect(() => { pausedRef.current = paused; }, [paused]);

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
      if (over.current || pausedRef.current) return;
      setGrid((prev) => {
        let g = prev.map((r) => [...r]);
        for (let i = 0; i < dir; i++) g = rotateGrid(g);
        const { grid: slid, gained, moved } = slideLeft(g);
        let result = slid;
        for (let i = 0; i < (4 - dir) % 4; i++) result = rotateGrid(result);
        if (!moved) return prev;
        addRandom(result);
        if (gained > 0) play("match");
        else play("tap");
        setScore((s) => {
          const ns = s + gained;
          onScore?.(ns);
          return ns;
        });
        if (!canMove(result)) {
          over.current = true;
          setScore((s) => { setTimeout(() => onGameOver(s), 0); return s; });
        }
        return result;
      });
    },
    [canMove, onGameOver, onScore, play]
  );

  useEffect(() => {
    onReady?.();
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === "arrowleft" || k === "a")      { doMove(0); e.preventDefault(); }
      else if (k === "arrowup" || k === "w")   { doMove(1); e.preventDefault(); }
      else if (k === "arrowright" || k === "d"){ doMove(2); e.preventDefault(); }
      else if (k === "arrowdown" || k === "s") { doMove(3); e.preventDefault(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [doMove, onReady]);

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
    <div className="flex flex-col items-center gap-3 select-none">
      <div className="text-sm font-semibold text-foreground">Score: {score}</div>
      <div
        className="grid grid-cols-4 gap-1.5 rounded-2xl bg-neutral-800 p-2 touch-none shadow-xl"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        {grid.flat().map((v, i) => {
          const colors = TILE_COLORS[v] ?? { bg: "#7c3aed", text: "#fff" };
          return (
            <div
              key={i}
              className="flex h-16 w-16 items-center justify-center rounded-xl text-base font-black transition-all duration-100"
              style={{ backgroundColor: colors.bg, color: colors.text }}
            >
              {v || ""}
            </div>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">Arrow keys / WASD or swipe to merge tiles.</p>
    </div>
  );
}
