"use client";

/**
 * Number Match — click pairs of numbers that sum to 10 OR are equal.
 * Two cells are connectable when:
 *   1. Adjacent (including diagonal or wrapped row end→next row start), OR
 *   2. Same row with no non-zero values between them, OR
 *   3. Same column with no non-zero values between them.
 * Score = pairs_cleared × 25. Win = board fully cleared.
 */

import { useEffect, useState, useCallback, useRef } from "react";
import type { GameEngineProps } from "@/components/games/types";
import { useGameSound } from "@/components/games/useGameSound";

const COLS = 9;

const ROW_MAP: Record<string, number> = {
  easy:   3,
  medium: 5,
  hard:   7,
};

// ─── Board helpers ────────────────────────────────────────────────────────────

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** One row of values 1–9 in shuffled order. */
function makeRow(): number[] {
  return shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9]);
}

function buildBoard(rows: number): number[] {
  const board: number[] = [];
  for (let r = 0; r < rows; r++) board.push(...makeRow());
  return board;
}

// ─── Connectability ───────────────────────────────────────────────────────────

/**
 * Returns true when the two values form a valid match pair
 * (equal, or sum to 10).
 */
function valuesMatch(a: number, b: number): boolean {
  return a === b || a + b === 10;
}

/**
 * Returns true when indices i and j are "connectable" on the board.
 * Rules (cells must both be non-zero, checked externally):
 *  1. True adjacency: |dr| ≤ 1 AND |dc| ≤ 1 (includes diagonals)
 *  2. Wrapped adjacency: col=8 at row R and col=0 at row R+1 (or vice-versa)
 *  3. Same row, no non-zero cells between col_i and col_j
 *  4. Same col, no non-zero cells between row_i and row_j
 */
function areConnectable(board: number[], i: number, j: number): boolean {
  if (i === j) return false;
  const totalCols = COLS;
  const ri = Math.floor(i / totalCols);
  const ci = i % totalCols;
  const rj = Math.floor(j / totalCols);
  const cj = j % totalCols;

  const dr = Math.abs(ri - rj);
  const dc = Math.abs(ci - cj);

  // Rule 1: true adjacency (8-directional)
  if (dr <= 1 && dc <= 1) return true;

  // Rule 2: wrapped adjacency — end of one row to start of next (or prev)
  //   (row R, col 8) ↔ (row R±1, col 0)
  if (
    (ci === totalCols - 1 && cj === 0 && dr === 1) ||
    (cj === totalCols - 1 && ci === 0 && dr === 1)
  ) return true;

  // Rule 3: same row, no non-zero cells between them
  if (ri === rj) {
    const minC = Math.min(ci, cj);
    const maxC = Math.max(ci, cj);
    for (let c = minC + 1; c < maxC; c++) {
      if (board[ri * totalCols + c] !== 0) return false;
    }
    return true;
  }

  // Rule 4: same column, no non-zero cells between them
  if (ci === cj) {
    const minR = Math.min(ri, rj);
    const maxR = Math.max(ri, rj);
    for (let r = minR + 1; r < maxR; r++) {
      if (board[r * totalCols + ci] !== 0) return false;
    }
    return true;
  }

  return false;
}

/** Remove fully-empty rows and return the trimmed board. */
function removeEmptyRows(board: number[]): number[] {
  const totalCols = COLS;
  const rows = Math.ceil(board.length / totalCols);
  const result: number[] = [];
  for (let r = 0; r < rows; r++) {
    const row = board.slice(r * totalCols, (r + 1) * totalCols);
    if (row.some((v) => v !== 0)) result.push(...row);
  }
  return result;
}

/** Append the current non-zero values as new rows (same way the original game works). */
function addRows(board: number[]): number[] {
  const nonZero = board.filter((v) => v !== 0);
  // Pad nonZero to a multiple of COLS with 0s at the end
  const padded = [...nonZero];
  while (padded.length % COLS !== 0) padded.push(0);
  return [...board, ...padded];
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function NumberMatchGame({
  onReady,
  onGameOver,
  onScore,
  difficulty = "medium",
  paused,
  soundEnabled = true,
}: GameEngineProps) {
  const initialRows = ROW_MAP[difficulty] ?? ROW_MAP.medium;
  const [board, setBoard] = useState<number[]>(() => buildBoard(initialRows));
  const [selected, setSelected] = useState<number | null>(null);
  const [pairs, setPairs] = useState(0);
  const [done, setDone] = useState(false);
  // Flash state: index → "match" | "miss" for brief highlight animation
  const [flash, setFlash] = useState<Record<number, "match" | "miss">>({});

  const play = useGameSound(soundEnabled ?? true);
  const pausedRef = useRef(paused);
  const doneRef = useRef(false);
  const boardLen = board.length;
  const numRows = Math.ceil(boardLen / COLS);

  useEffect(() => { pausedRef.current = paused; }, [paused]);
  useEffect(() => { onReady?.(); }, [onReady]);

  const score = pairs * 25;

  // Sync live score
  useEffect(() => {
    onScore?.(score);
  }, [score, onScore]);

  const flashCells = useCallback(
    (indices: number[], kind: "match" | "miss") => {
      setFlash((prev) => {
        const next = { ...prev };
        for (const idx of indices) next[idx] = kind;
        return next;
      });
      setTimeout(() => {
        setFlash((prev) => {
          const next = { ...prev };
          for (const idx of indices) delete next[idx];
          return next;
        });
      }, 350);
    },
    []
  );

  const handleCellClick = useCallback(
    (idx: number) => {
      if (pausedRef.current || doneRef.current) return;
      if (board[idx] === 0) return; // empty cell

      if (selected === null) {
        // First selection
        setSelected(idx);
        return;
      }

      if (selected === idx) {
        // Deselect
        setSelected(null);
        return;
      }

      const aVal = board[selected];
      const bVal = board[idx];

      const matchable = valuesMatch(aVal, bVal) && areConnectable(board, selected, idx);

      if (matchable) {
        play("match");
        // Clear the two cells
        const newBoard = [...board];
        newBoard[selected] = 0;
        newBoard[idx] = 0;
        const trimmed = removeEmptyRows(newBoard);

        const newPairs = pairs + 1;
        setPairs(newPairs);
        flashCells([selected, idx], "match");
        setSelected(null);
        setBoard(trimmed);

        // Check win: all cells empty
        if (trimmed.every((v) => v === 0)) {
          doneRef.current = true;
          setDone(true);
          play("win");
          const finalScore = newPairs * 25;
          onScore?.(finalScore);
          onGameOver(finalScore);
        }
      } else {
        // Invalid — play miss, flash, deselect
        play("miss");
        flashCells([selected, idx], "miss");
        setSelected(null);
      }
    },
    [board, selected, pairs, play, flashCells, onScore, onGameOver]
  );

  const handleAddRow = useCallback(() => {
    if (doneRef.current) return;
    setBoard((prev) => addRows(prev));
  }, []);

  return (
    <div className="flex flex-col items-center gap-3 select-none w-full max-w-sm mx-auto">
      {/* Header */}
      <div className="flex w-full items-center justify-between text-sm px-1">
        <span className="text-muted-foreground">
          Pairs: <span className="text-foreground font-semibold">{pairs}</span>
        </span>
        {done ? (
          <span className="text-emerald-400 font-bold">Board cleared!</span>
        ) : (
          <span className="text-muted-foreground text-xs">
            Equal or sum to 10 · Connected path
          </span>
        )}
        <span className="text-muted-foreground">
          Score: <span className="text-emerald-400 font-semibold">{score}</span>
        </span>
      </div>

      {/* Win banner */}
      {done && (
        <div className="w-full rounded-xl bg-emerald-950/40 border border-emerald-500/40 px-4 py-3 text-center">
          <p className="text-emerald-400 font-bold text-lg">Board cleared!</p>
          <p className="text-muted-foreground text-sm mt-0.5">
            {pairs} pair{pairs !== 1 ? "s" : ""} matched — Final score: {score}
          </p>
        </div>
      )}

      {/* Grid */}
      <div
        className="grid gap-1 w-full"
        style={{ gridTemplateColumns: `repeat(${COLS}, 1fr)` }}
      >
        {Array.from({ length: numRows * COLS }).map((_, idx) => {
          const val = board[idx] ?? 0;
          const isSelected = selected === idx;
          const flashKind = flash[idx];
          const isEmpty = val === 0;

          let cellClass =
            "aspect-square rounded-md text-xs font-bold flex items-center justify-center border transition-all duration-150 ";

          if (isEmpty) {
            cellClass += "bg-transparent border-transparent cursor-default";
          } else if (flashKind === "match") {
            cellClass += "bg-emerald-500/50 border-emerald-400 text-emerald-100 scale-110";
          } else if (flashKind === "miss") {
            cellClass += "bg-red-500/40 border-red-400 text-red-100 scale-90";
          } else if (isSelected) {
            cellClass +=
              "bg-blue-500/30 border-blue-400 text-blue-200 scale-105 shadow-md shadow-blue-500/30";
          } else {
            cellClass +=
              "bg-card border-border text-foreground hover:border-primary/50 hover:bg-accent cursor-pointer active:scale-95";
          }

          return (
            <button
              key={idx}
              type="button"
              onClick={() => !isEmpty && handleCellClick(idx)}
              disabled={isEmpty || done}
              className={cellClass}
              aria-label={isEmpty ? "empty" : `${val}`}
            >
              {isEmpty ? "" : val}
            </button>
          );
        })}
      </div>

      {/* Add Row button + hint */}
      {!done && (
        <div className="flex w-full items-center justify-between gap-2 px-1">
          <p className="text-xs text-muted-foreground flex-1">
            {selected !== null
              ? `Selected ${board[selected]} — pick a matching cell`
              : "Select two matching numbers"}
          </p>
          <button
            type="button"
            onClick={handleAddRow}
            className="shrink-0 rounded-lg border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground hover:border-primary/40 hover:text-foreground transition-all duration-150 active:scale-95"
          >
            + Add Row
          </button>
        </div>
      )}
    </div>
  );
}
