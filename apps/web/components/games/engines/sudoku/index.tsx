"use client";

/**
 * Sudoku — classic 9×9 number puzzle.
 * Score = max(0, 1000 - seconds_taken) on completion.
 * Select a cell, then tap a digit 1-9 to fill it.
 * Wrong entries highlight red; correct entries highlight green briefly.
 */

import React, { useEffect, useState, useCallback, useRef } from "react";
import type { GameEngineProps } from "@/components/games/types";
import { useGameSound } from "@/components/games/useGameSound";

// ---------------------------------------------------------------------------
// Puzzle data — 3 puzzles per difficulty. 0 = empty cell.
// ---------------------------------------------------------------------------

type Puzzle = { puzzle: number[]; solution: number[] };

const PUZZLES: Record<string, Puzzle[]> = {
  easy: [
    {
      puzzle:   [5,3,0,0,7,0,0,0,0, 6,0,0,1,9,5,0,0,0, 0,9,8,0,0,0,0,6,0, 8,0,0,0,6,0,0,0,3, 4,0,0,8,0,3,0,0,1, 7,0,0,0,2,0,0,0,6, 0,6,0,0,0,0,2,8,0, 0,0,0,4,1,9,0,0,5, 0,0,0,0,8,0,0,7,9],
      solution: [5,3,4,6,7,8,9,1,2, 6,7,2,1,9,5,3,4,8, 1,9,8,3,4,2,5,6,7, 8,5,9,7,6,1,4,2,3, 4,2,6,8,5,3,7,9,1, 7,1,3,9,2,4,8,5,6, 9,6,1,5,3,7,2,8,4, 2,8,7,4,1,9,6,3,5, 3,4,5,2,8,6,1,7,9],
    },
    {
      puzzle:   [0,0,0,2,6,0,7,0,1, 6,8,0,0,7,0,0,9,0, 1,9,0,0,0,4,5,0,0, 8,2,0,1,0,0,0,4,0, 0,0,4,6,0,2,9,0,0, 0,5,0,0,0,3,0,2,8, 0,0,9,3,0,0,0,7,4, 0,4,0,0,5,0,0,3,6, 7,0,3,0,1,8,0,0,0],
      solution: [4,3,5,2,6,9,7,8,1, 6,8,2,5,7,1,4,9,3, 1,9,7,8,3,4,5,6,2, 8,2,6,1,9,5,3,4,7, 3,7,4,6,8,2,9,1,5, 9,5,1,7,4,3,6,2,8, 5,1,9,3,2,6,8,7,4, 2,4,8,9,5,7,1,3,6, 7,6,3,4,1,8,2,5,9],
    },
    {
      puzzle:   [0,0,0,0,0,0,0,0,0, 0,0,0,0,0,3,0,8,5, 0,0,1,0,2,0,0,0,0, 0,0,0,5,0,7,0,0,0, 0,0,4,0,0,0,1,0,0, 0,9,0,0,0,0,0,0,0, 5,0,0,0,0,0,0,7,3, 0,0,2,0,1,0,0,0,0, 0,0,0,0,4,0,0,0,9],
      solution: [9,8,7,6,5,4,3,2,1, 2,4,6,1,7,3,9,8,5, 3,5,1,9,2,8,7,4,6, 1,2,8,5,3,7,6,9,4, 6,3,4,8,9,2,1,5,7, 7,9,5,4,6,1,8,3,2, 5,1,9,2,8,6,4,7,3, 4,7,2,3,1,9,5,6,8, 8,6,3,7,4,5,2,1,9],
    },
  ],
  medium: [
    {
      puzzle:   [0,2,0,0,0,0,0,0,0, 0,0,0,6,0,0,0,0,3, 0,7,4,0,8,0,0,0,0, 0,0,0,0,0,3,0,0,2, 0,8,0,0,4,0,0,1,0, 6,0,0,5,0,0,0,0,0, 0,0,0,0,1,0,7,8,0, 5,0,0,0,0,9,0,0,0, 0,0,0,0,0,0,0,4,0],
      solution: [1,2,6,4,3,7,9,5,8, 8,9,5,6,2,1,4,7,3, 3,7,4,9,8,5,1,2,6, 4,5,7,1,9,3,8,6,2, 9,8,3,2,4,6,5,1,7, 6,1,2,5,7,8,3,9,4, 2,6,9,3,1,4,7,8,5, 5,4,8,7,6,9,2,3,1, 7,3,1,8,5,2,6,4,9],
    },
    {
      puzzle:   [0,0,0,0,0,0,6,8,0, 0,0,0,0,7,3,0,0,9, 3,0,9,0,0,0,0,4,5, 4,9,0,0,0,0,0,0,0, 8,0,3,0,5,0,9,0,2, 0,0,0,0,0,0,0,3,6, 9,6,0,0,0,0,3,0,8, 7,0,0,6,8,0,0,0,0, 0,2,8,0,0,0,0,0,0],
      solution: [1,7,2,5,4,9,6,8,3, 6,4,5,8,7,3,2,1,9, 3,8,9,2,6,1,7,4,5, 4,9,6,3,2,7,8,5,1, 8,1,3,4,5,6,9,7,2, 2,5,7,1,9,8,4,3,6, 9,6,4,7,1,5,3,2,8, 7,3,1,6,8,2,5,9,4, 5,2,8,9,3,4,1,6,7],
    },
    {
      puzzle:   [0,0,0,8,0,1,0,0,0, 0,0,0,0,0,0,0,4,3, 5,0,0,0,0,0,0,0,0, 0,0,0,0,7,0,8,0,0, 0,0,0,0,0,0,1,0,0, 0,2,0,0,3,0,0,0,0, 6,0,0,0,0,0,0,7,5, 0,0,3,4,0,0,0,0,0, 0,0,0,2,0,0,6,0,0],
      solution: [9,6,7,8,2,1,5,3,4, 2,8,1,7,6,5,9,4,3, 5,3,4,9,1,7,2,6,8, 3,9,6,1,7,4,8,5,2, 8,5,4,6,9,2,1,3,7, 7,2,9,5,3,8,4,1,6, 6,4,2,3,1,9,7,8,5, 1,7,3,4,5,6,2,9,8, 4,1,5,2,8,3,6,7,9],
    },
  ],
  hard: [
    {
      puzzle:   [8,0,0,0,0,0,0,0,0, 0,0,3,6,0,0,0,0,0, 0,7,0,0,9,0,2,0,0, 0,5,0,0,0,7,0,0,0, 0,0,0,0,4,5,7,0,0, 0,0,0,1,0,0,0,3,0, 0,0,1,0,0,0,0,6,8, 0,0,8,5,0,0,0,1,0, 0,9,0,0,0,0,4,0,0],
      solution: [8,1,2,7,5,3,6,4,9, 9,4,3,6,8,2,1,7,5, 6,7,5,4,9,1,2,8,3, 1,5,4,2,3,7,8,9,6, 3,6,9,8,4,5,7,2,1, 2,8,7,1,6,9,5,3,4, 5,2,1,9,7,4,3,6,8, 4,3,8,5,2,6,9,1,7, 7,9,6,3,1,8,4,5,2],
    },
    {
      puzzle:   [0,0,0,0,0,0,0,0,1, 0,0,0,0,0,2,0,0,0, 0,0,9,3,0,0,0,0,0, 0,0,0,0,0,0,0,4,7, 0,0,0,0,0,0,6,0,0, 0,0,0,0,0,0,0,0,0, 0,0,0,0,8,0,5,0,0, 0,5,0,0,0,0,0,0,0, 0,0,0,0,7,0,0,0,9],
      solution: [2,6,4,8,5,7,9,3,1, 3,1,7,4,9,2,8,6,5, 5,8,9,3,6,1,7,2,4, 9,3,5,6,2,8,1,4,7, 7,4,2,9,1,3,6,5,8, 8,7,1,5,4,6,2,9,3, 6,9,3,2,8,4,5,1,7, 1,5,8,7,3,9,4,2,6, 4,2,6,1,7,5,3,8,9],
    },
    {
      puzzle:   [0,0,0,0,0,0,0,0,2, 0,0,0,0,9,8,1,0,0, 0,0,0,7,0,0,0,5,0, 0,0,1,0,0,0,0,0,0, 0,4,0,0,0,6,0,0,0, 0,0,0,0,0,0,0,8,0, 0,0,6,0,3,0,0,0,0, 0,5,0,0,0,7,0,0,0, 3,0,0,0,0,0,0,0,0],
      solution: [6,7,3,1,4,5,8,9,2, 5,2,4,6,9,8,1,3,7, 1,8,9,7,2,3,4,5,6, 7,6,1,5,8,4,9,2,3, 9,4,5,3,7,6,2,8,1, 2,3,8,9,1,2,5,7,4, 8,1,6,4,3,9,7,2,5, 4,5,2,8,6,7,3,1,9, 3,9,7,2,5,1,6,4,8],
    },
  ],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toGrid(flat: number[]): number[][] {
  const g: number[][] = [];
  for (let r = 0; r < 9; r++) g.push(flat.slice(r * 9, r * 9 + 9));
  return g;
}

function formatTime(secs: number): string {
  const m = Math.floor(secs / 60).toString().padStart(2, "0");
  const s = (secs % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function SudokuGame({
  onReady,
  onGameOver,
  onScore,
  difficulty = "medium",
  paused,
  soundEnabled = true,
}: GameEngineProps) {
  const play = useGameSound(soundEnabled ?? true);
  const pausedRef = useRef(paused);
  const gameOverFiredRef = useRef(false);

  const [puzzleData] = useState<Puzzle>(() => {
    const list = PUZZLES[difficulty] ?? PUZZLES.medium;
    return list[Math.floor(Math.random() * list.length)];
  });

  const puzzleGrid = toGrid(puzzleData.puzzle);
  const solutionGrid = toGrid(puzzleData.solution);

  // board[r][c] = user's current value (0 = empty)
  const [board, setBoard] = useState<number[][]>(() =>
    puzzleGrid.map((row) => [...row])
  );

  const [selected, setSelected] = useState<[number, number] | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [done, setDone] = useState(false);

  useEffect(() => { pausedRef.current = paused; }, [paused]);
  useEffect(() => { onReady?.(); }, [onReady]);

  // Timer
  useEffect(() => {
    if (done) return;
    const id = setInterval(() => {
      if (!pausedRef.current) setSeconds((s) => s + 1);
    }, 1000);
    return () => clearInterval(id);
  }, [done]);

  // Check if a given (r,c) value is correct vs solution
  const isCorrect = useCallback((r: number, c: number, val: number) => {
    return val !== 0 && val === solutionGrid[r][c];
  }, [solutionGrid]);

  const isGiven = useCallback((r: number, c: number) => {
    return puzzleGrid[r][c] !== 0;
  }, [puzzleGrid]);

  // Check for win
  const checkWin = useCallback((b: number[][]) => {
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        if (b[r][c] !== solutionGrid[r][c]) return false;
      }
    }
    return true;
  }, [solutionGrid]);

  const handleCellClick = useCallback((r: number, c: number) => {
    if (pausedRef.current || done) return;
    setSelected([r, c]);
    play("tap");
  }, [done, play]);

  const handleDigit = useCallback((digit: number) => {
    if (!selected || pausedRef.current || done) return;
    const [r, c] = selected;
    if (isGiven(r, c)) return;

    const newBoard = board.map((row) => [...row]);
    newBoard[r][c] = digit;
    setBoard(newBoard);

    if (digit === 0) return; // erasing — no sound feedback needed

    if (digit === solutionGrid[r][c]) {
      play("score");
      // Count filled correct cells for live score
      let filled = 0;
      for (let row = 0; row < 9; row++) {
        for (let col = 0; col < 9; col++) {
          if (newBoard[row][col] !== 0 && newBoard[row][col] === solutionGrid[row][col]) filled++;
        }
      }
      const liveScore = Math.round((filled / 81) * 1000);
      onScore?.(liveScore);

      if (checkWin(newBoard) && !gameOverFiredRef.current) {
        gameOverFiredRef.current = true;
        setDone(true);
        play("win");
        const finalScore = Math.max(0, 1000 - seconds);
        onScore?.(finalScore);
        onGameOver(finalScore);
      }
    } else {
      play("miss");
    }
  }, [selected, done, board, isGiven, solutionGrid, checkWin, seconds, onScore, onGameOver, play]);

  // Keyboard support
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (done || pausedRef.current) return;
      const key = e.key;
      if (key >= "1" && key <= "9") { handleDigit(Number(key)); return; }
      if (key === "Backspace" || key === "Delete" || key === "0") { handleDigit(0); return; }
      if (!selected) return;
      const [r, c] = selected;
      if (key === "ArrowUp"    && r > 0) { setSelected([r - 1, c]); e.preventDefault(); }
      if (key === "ArrowDown"  && r < 8) { setSelected([r + 1, c]); e.preventDefault(); }
      if (key === "ArrowLeft"  && c > 0) { setSelected([r, c - 1]); e.preventDefault(); }
      if (key === "ArrowRight" && c < 8) { setSelected([r, c + 1]); e.preventDefault(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selected, done, handleDigit]);

  // Compute score for display
  let filledCorrect = 0;
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      if (board[r][c] !== 0 && board[r][c] === solutionGrid[r][c]) filledCorrect++;
    }
  }
  const displayScore = done ? Math.max(0, 1000 - seconds) : Math.round((filledCorrect / 81) * 1000);

  // Highlight helpers
  const isSelected = (r: number, c: number) =>
    selected ? selected[0] === r && selected[1] === c : false;

  const isHighlighted = (r: number, c: number) => {
    if (!selected) return false;
    const [sr, sc] = selected;
    // Same row, col, or 3x3 box
    const sameRow = r === sr;
    const sameCol = c === sc;
    const sameBox = Math.floor(r / 3) === Math.floor(sr / 3) && Math.floor(c / 3) === Math.floor(sc / 3);
    return sameRow || sameCol || sameBox;
  };

  const isSameDigit = (r: number, c: number) => {
    if (!selected) return false;
    const selVal = board[selected[0]][selected[1]];
    return selVal !== 0 && board[r][c] === selVal;
  };

  const getCellStyle = (r: number, c: number): string => {
    const val = board[r][c];
    const given = isGiven(r, c);
    const sel = isSelected(r, c);
    const highlight = isHighlighted(r, c);
    const sameDigit = isSameDigit(r, c);
    const wrong = val !== 0 && !given && val !== solutionGrid[r][c];
    const correct = val !== 0 && !given && val === solutionGrid[r][c];

    let base =
      "flex items-center justify-center text-sm sm:text-base font-semibold cursor-pointer transition-all duration-150 relative ";

    // Selection priority order
    if (sel) {
      base += "bg-blue-600 text-white ";
    } else if (wrong) {
      base += "bg-red-900/60 text-red-400 ";
    } else if (sameDigit) {
      base += "bg-blue-900/50 text-foreground ";
    } else if (highlight) {
      base += "bg-blue-950/40 text-foreground ";
    } else if (correct) {
      base += "bg-card text-emerald-400 ";
    } else {
      base += "bg-card text-foreground hover:bg-accent ";
    }

    if (given) base += "font-bold ";
    else if (!wrong && val !== 0) base += "font-medium ";

    return base;
  };

  // Box border styling: thicker lines between 3x3 boxes
  const getCellBorder = (r: number, c: number): React.CSSProperties => {
    const borderTop    = r % 3 === 0 ? "2px" : "0.5px";
    const borderLeft   = c % 3 === 0 ? "2px" : "0.5px";
    const borderBottom = r === 8 ? "2px" : "0.5px";
    const borderRight  = c === 8 ? "2px" : "0.5px";
    const color = "hsl(var(--border))";
    const thickColor = "hsl(var(--foreground) / 0.5)";

    return {
      borderTop:    `${borderTop} solid ${r % 3 === 0 ? thickColor : color}`,
      borderLeft:   `${borderLeft} solid ${c % 3 === 0 ? thickColor : color}`,
      borderBottom: `${borderBottom} solid ${r === 8 ? thickColor : color}`,
      borderRight:  `${borderRight} solid ${c === 8 ? thickColor : color}`,
    };
  };

  return (
    <div className="flex flex-col items-center gap-3 select-none w-full max-w-sm mx-auto">
      {/* Header */}
      <div className="flex w-full items-center justify-between text-sm px-1">
        <span className="text-muted-foreground font-mono">{formatTime(seconds)}</span>
        <span className={`font-semibold capitalize ${
          difficulty === "easy" ? "text-emerald-400" :
          difficulty === "hard" ? "text-red-400" :
          "text-amber-400"
        }`}>{difficulty}</span>
        <span className="text-muted-foreground">
          Score: <span className="text-foreground font-semibold">{displayScore}</span>
        </span>
      </div>

      {/* Sudoku Grid */}
      <div
        className="w-full rounded-lg overflow-hidden"
        style={{ display: "grid", gridTemplateColumns: "repeat(9, 1fr)", aspectRatio: "1" }}
      >
        {board.map((row, r) =>
          row.map((val, c) => (
            <div
              key={`${r}-${c}`}
              onClick={() => handleCellClick(r, c)}
              className={getCellStyle(r, c)}
              style={getCellBorder(r, c)}
            >
              {val !== 0 ? val : ""}
            </div>
          ))
        )}
      </div>

      {/* Digit input buttons */}
      {!done && (
        <div className="flex gap-1 w-full justify-center">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => handleDigit(d)}
              className="flex-1 aspect-square rounded-xl border-2 border-border bg-card hover:bg-accent text-foreground font-bold text-sm sm:text-base transition-all duration-150 active:scale-90"
            >
              {d}
            </button>
          ))}
        </div>
      )}

      {/* Erase button */}
      {!done && (
        <button
          type="button"
          onClick={() => handleDigit(0)}
          className="px-4 py-1.5 rounded-xl border-2 border-border bg-card hover:bg-accent text-muted-foreground text-xs font-medium transition-all duration-150"
        >
          Erase
        </button>
      )}

      {/* Done banner */}
      {done && (
        <div className="w-full rounded-2xl border-2 border-emerald-500/50 bg-emerald-950/30 p-4 text-center">
          <div className="text-emerald-400 font-bold text-lg">Puzzle Complete!</div>
          <div className="text-muted-foreground text-sm mt-1">
            Time: {formatTime(seconds)} · Score: {displayScore}
          </div>
        </div>
      )}

      {/* Instructions */}
      {!done && (
        <p className="text-xs text-muted-foreground text-center">
          Tap a cell, then tap a digit to fill it. Use arrow keys to navigate.
        </p>
      )}
    </div>
  );
}
