"use client";

/**
 * Slide Puzzle — classic 4×4 (15-puzzle). Score = max(0, 1000 - moves).
 */

import { useEffect, useState, useCallback, useRef } from "react";
import type { GameEngineProps } from "@/components/games/types";
import { useGameSound } from "@/components/games/useGameSound";

const SIZE_MAP: Record<string, number> = { easy: 3, medium: 4, hard: 5 };

function buildBoard(n: number): number[] {
  const total = n * n;
  // Create solved board then shuffle with solvable swaps
  const board = Array.from({ length: total }, (_, i) => (i + 1) % total);
  // Fisher-Yates with even number of swaps to ensure solvability
  let swaps = 0;
  for (let i = total - 1; i > 1; i--) {
    const j = 1 + Math.floor(Math.random() * (i - 1));
    [board[i], board[j]] = [board[j], board[i]];
    swaps++;
  }
  // If odd swaps, do one more swap to keep parity
  if (swaps % 2 !== 0 && total > 2) {
    [board[0], board[1]] = [board[1], board[0]];
  }
  return board;
}

function isSolved(board: number[], n: number): boolean {
  for (let i = 0; i < n * n - 1; i++) if (board[i] !== i + 1) return false;
  return board[n * n - 1] === 0;
}

export default function SlidePuzzleGame({ onReady, onGameOver, onScore, difficulty = "medium", paused, soundEnabled = true }: GameEngineProps) {
  const n = SIZE_MAP[difficulty] ?? 4;
  const [board, setBoard] = useState<number[]>(() => buildBoard(n));
  const [moves, setMoves] = useState(0);
  const [done, setDone] = useState(false);
  const pausedRef = useRef(paused);
  const play = useGameSound(soundEnabled ?? true);

  useEffect(() => { pausedRef.current = paused; }, [paused]);
  useEffect(() => { onReady?.(); }, [onReady]);

  const slide = useCallback((idx: number) => {
    if (pausedRef.current || done) return;
    const blankIdx = board.indexOf(0);
    const row = Math.floor(idx / n), col = idx % n;
    const bRow = Math.floor(blankIdx / n), bCol = blankIdx % n;
    const adjacent = (Math.abs(row - bRow) === 1 && col === bCol) || (Math.abs(col - bCol) === 1 && row === bRow);
    if (!adjacent) return;

    play("move");
    const newBoard = [...board];
    [newBoard[idx], newBoard[blankIdx]] = [newBoard[blankIdx], newBoard[idx]];
    setBoard(newBoard);
    const newMoves = moves + 1;
    setMoves(newMoves);

    if (isSolved(newBoard, n)) {
      const score = Math.max(0, 1000 - newMoves * (difficulty === "easy" ? 3 : difficulty === "hard" ? 8 : 5));
      play("win");
      onScore?.(score);
      onGameOver(score);
      setDone(true);
    }
  }, [board, done, moves, n, difficulty, onScore, onGameOver, play]);

  // Keyboard support
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (done || pausedRef.current) return;
      const blankIdx = board.indexOf(0);
      const bRow = Math.floor(blankIdx / n), bCol = blankIdx % n;
      let target = -1;
      if (e.key === "ArrowLeft" && bCol < n - 1) target = blankIdx + 1;
      if (e.key === "ArrowRight" && bCol > 0) target = blankIdx - 1;
      if (e.key === "ArrowUp" && bRow < n - 1) target = blankIdx + n;
      if (e.key === "ArrowDown" && bRow > 0) target = blankIdx - n;
      if (target >= 0) { slide(target); e.preventDefault(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [board, done, n, slide]);

  return (
    <div className="flex flex-col items-center gap-3 select-none">
      <div className="flex w-full max-w-xs items-center justify-between text-sm px-1">
        <span className="text-muted-foreground">Moves: <span className="text-foreground font-semibold">{moves}</span></span>
        {done && <span className="text-emerald-400 font-bold">Solved! 🎉</span>}
      </div>
      <div
        className="grid gap-1.5 w-full max-w-xs"
        style={{ gridTemplateColumns: `repeat(${n}, 1fr)` }}
      >
        {board.map((val, i) => (
          <button
            key={i}
            type="button"
            onClick={() => slide(i)}
            disabled={val === 0 || done}
            className={`aspect-square rounded-lg text-lg font-bold flex items-center justify-center border transition-all ${
              val === 0 ? "bg-transparent border-dashed border-border/30" :
              "bg-primary/10 border-primary/30 text-foreground hover:bg-primary/20 active:scale-95"
            }`}
          >
            {val !== 0 && val}
          </button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">Click adjacent tile or use arrow keys to slide.</p>
    </div>
  );
}
