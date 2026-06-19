"use client";

/**
 * Minesweeper — reveal the grid, flag the mines.
 * Score = cells revealed × 10 (+ 500 bonus if cleared).
 */

import { useEffect, useState, useCallback, useRef } from "react";
import type { GameEngineProps } from "@/components/games/types";
import { useGameSound } from "@/components/games/useGameSound";

const CONFIG: Record<string, { rows: number; cols: number; mines: number }> = {
  easy:   { rows: 8,  cols: 8,  mines: 10 },
  medium: { rows: 10, cols: 10, mines: 18 },
  hard:   { rows: 12, cols: 12, mines: 30 },
};

interface Cell { mine: boolean; revealed: boolean; flagged: boolean; adj: number }

function buildGrid(rows: number, cols: number, mines: number, safeIdx: number): Cell[] {
  const total = rows * cols;
  const mineSet = new Set<number>();
  while (mineSet.size < mines) {
    const idx = Math.floor(Math.random() * total);
    if (idx !== safeIdx) mineSet.add(idx);
  }

  const grid: Cell[] = Array.from({ length: total }, (_, i) => ({
    mine: mineSet.has(i), revealed: false, flagged: false, adj: 0,
  }));

  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const idx = r * cols + c;
    if (grid[idx].mine) continue;
    let adj = 0;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      const nr = r + dr, nc = c + dc;
      if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && grid[nr * cols + nc].mine) adj++;
    }
    grid[idx].adj = adj;
  }
  return grid;
}

function floodReveal(grid: Cell[], idx: number, rows: number, cols: number): Cell[] {
  const next = [...grid];
  const queue = [idx];
  while (queue.length) {
    const cur = queue.shift()!;
    if (next[cur].revealed || next[cur].flagged || next[cur].mine) continue;
    next[cur] = { ...next[cur], revealed: true };
    if (next[cur].adj === 0) {
      const r = Math.floor(cur / cols), c = cur % cols;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        const nr = r + dr, nc = c + dc;
        if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) queue.push(nr * cols + nc);
      }
    }
  }
  return next;
}

export default function MinesweeperGame({ onReady, onGameOver, onScore, difficulty = "medium", paused, soundEnabled = true }: GameEngineProps) {
  const { rows, cols, mines } = CONFIG[difficulty] ?? CONFIG.medium;
  const [grid, setGrid] = useState<Cell[] | null>(null);
  const [flags, setFlags] = useState(0);
  const [over, setOver] = useState(false);
  const [won, setWon] = useState(false);
  const [firstClick, setFirstClick] = useState(true);
  const [score, setScore] = useState(0);
  const pausedRef = useRef(paused);
  const play = useGameSound(soundEnabled ?? true);

  useEffect(() => { pausedRef.current = paused; }, [paused]);
  useEffect(() => { onReady?.(); }, [onReady]);

  const reveal = useCallback((idx: number) => {
    if (pausedRef.current || over || won) return;

    if (firstClick) {
      const g = buildGrid(rows, cols, mines, idx);
      const revealed = floodReveal(g, idx, rows, cols);
      setGrid(revealed);
      setFirstClick(false);
      play("click");
      return;
    }

    if (!grid) return;
    const cell = grid[idx];
    if (cell.revealed || cell.flagged) return;

    if (cell.mine) {
      // Reveal all mines
      const exploded = grid.map((c) => c.mine ? { ...c, revealed: true } : c);
      setGrid(exploded);
      setOver(true);
      play("lose");
      const sc = grid.filter((c) => c.revealed).length * 10;
      setScore(sc);
      onGameOver(sc);
      return;
    }

    play("click");
    const next = floodReveal(grid, idx, rows, cols);
    setGrid(next);
    const revealed = next.filter((c) => c.revealed).length;
    const sc = revealed * 10;
    setScore(sc);
    onScore?.(sc);

    if (revealed === rows * cols - mines) {
      setWon(true);
      play("win");
      const finalScore = sc + 500;
      setScore(finalScore);
      onGameOver(finalScore);
    }
  }, [grid, firstClick, over, won, rows, cols, mines, onScore, onGameOver, play]);

  const flag = useCallback((e: React.MouseEvent, idx: number) => {
    e.preventDefault();
    if (pausedRef.current || over || won || !grid || firstClick) return;
    const cell = grid[idx];
    if (cell.revealed) return;
    const next = [...grid];
    next[idx] = { ...cell, flagged: !cell.flagged };
    setGrid(next);
    setFlags((f) => cell.flagged ? f - 1 : f + 1);
    play("tap");
  }, [grid, firstClick, over, won, play]);

  const ADJ_COLORS = ["","#3b82f6","#22c55e","#ef4444","#7c3aed","#dc2626","#0891b2","#1e293b","#64748b"];

  return (
    <div className="flex flex-col items-center gap-3 select-none">
      <div className="flex w-full max-w-xs items-center justify-between text-sm px-1">
        <span>💣 {mines - flags}</span>
        <span className={over ? "text-red-400" : won ? "text-emerald-400 font-bold" : "text-foreground"}>{over ? "Boom! 💥" : won ? "Cleared! 🎉" : "Reveal safely"}</span>
        <span className="text-muted-foreground">Score: {score}</span>
      </div>
      <div
        className="grid gap-0.5"
        style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}
      >
        {(grid ?? Array.from({ length: rows * cols }, () => ({ mine: false, revealed: false, flagged: false, adj: 0 }))).map((cell, i) => (
          <button
            key={i}
            type="button"
            onClick={() => reveal(i)}
            onContextMenu={(e) => flag(e, i)}
            className={`w-7 h-7 text-xs font-bold rounded border flex items-center justify-center transition-colors ${
              cell.revealed
                ? cell.mine ? "bg-red-700 border-red-500" : "bg-muted border-border text-foreground"
                : cell.flagged ? "bg-amber-700/30 border-amber-500/50 text-amber-400" : "bg-card border-border hover:bg-accent active:scale-90"
            }`}
            style={{ color: cell.revealed && !cell.mine && cell.adj > 0 ? ADJ_COLORS[cell.adj] : undefined }}
          >
            {cell.revealed ? (cell.mine ? "💣" : cell.adj > 0 ? cell.adj : "") : cell.flagged ? "🚩" : ""}
          </button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">Click to reveal · Right-click to flag</p>
    </div>
  );
}
