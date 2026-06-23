"use client";

/**
 * Nonogram (Picross) — fill the correct cells based on row and column number clues.
 * Score = 500 + max(0, 300 - seconds_elapsed) when solved.
 */

import { useEffect, useState, useCallback, useRef } from "react";
import type { GameEngineProps } from "@/components/games/types";
import { useGameSound } from "@/components/games/useGameSound";

// ─── Puzzle definitions ───────────────────────────────────────────────────────

type Grid = number[][]; // 0=empty, 1=filled

interface Puzzle {
  solution: Grid;
  rowClues: number[][];
  colClues: number[][];
}

// Compute run-length clues from a 1D row/column of 0s and 1s
function computeClues(line: number[]): number[] {
  const clues: number[] = [];
  let count = 0;
  for (const cell of line) {
    if (cell === 1) {
      count++;
    } else if (count > 0) {
      clues.push(count);
      count = 0;
    }
  }
  if (count > 0) clues.push(count);
  return clues.length > 0 ? clues : [0];
}

function makePuzzle(solution: Grid): Puzzle {
  const rows = solution.length;
  const cols = solution[0].length;
  const rowClues = solution.map((row) => computeClues(row));
  const colClues = Array.from({ length: cols }, (_, c) =>
    computeClues(solution.map((row) => row[c]))
  );
  return { solution, rowClues, colClues };
}

// ── Easy 5×5 ─────────────────────────────────────────────────────────────────
const EASY_PUZZLES: Puzzle[] = [
  makePuzzle([
    [0, 0, 1, 0, 0],
    [0, 0, 1, 0, 0],
    [1, 1, 1, 1, 1],
    [0, 0, 1, 0, 0],
    [0, 0, 1, 0, 0],
  ]),
  makePuzzle([
    [0, 1, 0, 1, 0],
    [1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1],
    [0, 1, 1, 1, 0],
    [0, 0, 1, 0, 0],
  ]),
];

// ── Medium 8×8 ────────────────────────────────────────────────────────────────
const MEDIUM_PUZZLES: Puzzle[] = [
  makePuzzle([
    [1, 0, 0, 0, 0, 0, 0, 1],
    [1, 0, 0, 0, 0, 0, 0, 1],
    [1, 0, 0, 0, 0, 0, 0, 1],
    [1, 1, 1, 1, 1, 1, 1, 1],
    [1, 0, 0, 0, 0, 0, 0, 1],
    [1, 0, 0, 0, 0, 0, 0, 1],
    [1, 0, 0, 0, 0, 0, 0, 1],
    [1, 0, 0, 0, 0, 0, 0, 1],
  ]),
  makePuzzle([
    [0, 0, 0, 1, 1, 0, 0, 0],
    [0, 0, 1, 1, 1, 1, 0, 0],
    [0, 1, 1, 1, 1, 1, 1, 0],
    [1, 1, 1, 1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1, 1, 1, 1],
    [0, 1, 1, 1, 1, 1, 1, 0],
    [0, 0, 1, 1, 1, 1, 0, 0],
    [0, 0, 0, 1, 1, 0, 0, 0],
  ]),
];

// ── Hard 10×10 ────────────────────────────────────────────────────────────────
const HARD_PUZZLES: Puzzle[] = [
  makePuzzle([
    [0, 0, 0, 0, 1, 1, 0, 0, 0, 0],
    [0, 0, 0, 1, 1, 1, 1, 0, 0, 0],
    [0, 0, 1, 1, 1, 1, 1, 1, 0, 0],
    [0, 1, 1, 1, 1, 1, 1, 1, 1, 0],
    [1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    [1, 1, 0, 0, 1, 1, 0, 0, 1, 1],
    [1, 1, 0, 0, 1, 1, 0, 0, 1, 1],
    [1, 1, 0, 0, 1, 1, 0, 0, 1, 1],
    [1, 1, 0, 0, 1, 1, 0, 0, 1, 1],
    [1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  ]),
  makePuzzle([
    [0, 1, 1, 1, 1, 1, 1, 1, 1, 0],
    [1, 0, 0, 0, 0, 0, 0, 0, 0, 1],
    [1, 0, 1, 0, 0, 0, 1, 0, 0, 1],
    [1, 0, 0, 0, 0, 0, 0, 0, 0, 1],
    [1, 0, 0, 0, 0, 0, 0, 0, 0, 1],
    [1, 0, 1, 0, 0, 0, 0, 1, 0, 1],
    [1, 0, 0, 1, 1, 1, 1, 0, 0, 1],
    [1, 0, 0, 0, 0, 0, 0, 0, 0, 1],
    [1, 0, 0, 0, 0, 0, 0, 0, 0, 1],
    [0, 1, 1, 1, 1, 1, 1, 1, 1, 0],
  ]),
];

const PUZZLES_BY_DIFF: Record<string, Puzzle[]> = {
  easy: EASY_PUZZLES,
  medium: MEDIUM_PUZZLES,
  hard: HARD_PUZZLES,
};

// ─── Cell state: 0=empty, 1=filled, 2=crossed ────────────────────────────────
type CellState = 0 | 1 | 2;

function emptyBoard(rows: number, cols: number): CellState[][] {
  return Array.from({ length: rows }, () => Array(cols).fill(0) as CellState[]);
}

function cluesEqual(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function NonogramGame({
  onReady,
  onGameOver,
  onScore,
  difficulty = "medium",
  paused,
  soundEnabled = true,
}: GameEngineProps) {
  const play = useGameSound(soundEnabled ?? true);
  const pausedRef = useRef(paused);
  const doneRef = useRef(false);

  const puzzles = PUZZLES_BY_DIFF[difficulty] ?? PUZZLES_BY_DIFF.medium;
  const [puzzleIdx] = useState(() => Math.floor(Math.random() * puzzles.length));
  const puzzle = puzzles[puzzleIdx];
  const { solution, rowClues, colClues } = puzzle;
  const ROWS = solution.length;
  const COLS = solution[0].length;

  const [board, setBoard] = useState<CellState[][]>(() => emptyBoard(ROWS, COLS));
  const [seconds, setSeconds] = useState(0);
  const [done, setDone] = useState(false);

  // Track which rows/cols are currently complete
  const [completedRows, setCompletedRows] = useState<boolean[]>(() => Array(ROWS).fill(false));
  const [completedCols, setCompletedCols] = useState<boolean[]>(() => Array(COLS).fill(false));

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

  // Check win: every solution-1 cell is state=1, and no solution-0 cell is state=1
  const checkWin = useCallback(
    (b: CellState[][]): boolean => {
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          if (solution[r][c] === 1 && b[r][c] !== 1) return false;
          if (solution[r][c] === 0 && b[r][c] === 1) return false;
        }
      }
      return true;
    },
    [solution, ROWS, COLS]
  );

  const computeCompletions = useCallback(
    (b: CellState[][]): { rows: boolean[]; cols: boolean[] } => {
      const rows = Array.from({ length: ROWS }, (_, r) => {
        const userClue = computeClues(b[r].map((v) => (v === 1 ? 1 : 0)));
        return cluesEqual(userClue, rowClues[r]);
      });
      const cols = Array.from({ length: COLS }, (_, c) => {
        const userClue = computeClues(b.map((row) => (row[c] === 1 ? 1 : 0)));
        return cluesEqual(userClue, colClues[c]);
      });
      return { rows, cols };
    },
    [ROWS, COLS, rowClues, colClues]
  );

  const handleCellClick = useCallback(
    (r: number, c: number) => {
      if (pausedRef.current || doneRef.current) return;

      setBoard((prev) => {
        const next = prev.map((row) => [...row] as CellState[]);
        const cur = next[r][c];
        // Click: empty→filled, filled→crossed, crossed→empty
        next[r][c] = cur === 0 ? 1 : cur === 1 ? 2 : 0;

        const newState = next[r][c];
        if (newState === 1) {
          play("tap");
        }

        // Check row/col completions for match sound
        const { rows: newRows, cols: newCols } = computeCompletions(next);

        // Detect newly completed rows/cols to play match sound
        setCompletedRows((prevRows) => {
          const changed = newRows.some((v, i) => v && !prevRows[i]);
          if (changed) play("match");
          return newRows;
        });
        setCompletedCols((prevCols) => {
          const changed = newCols.some((v, i) => v && !prevCols[i]);
          if (changed) play("match");
          return newCols;
        });

        // Check win
        if (!doneRef.current && checkWin(next)) {
          doneRef.current = true;
          setTimeout(() => {
            setDone(true);
            play("win");
            setSeconds((s) => {
              const timeBonus = Math.max(0, 300 - s);
              const score = 500 + timeBonus;
              onScore?.(score);
              onGameOver(score);
              return s;
            });
          }, 100);
        }

        return next;
      });
    },
    [play, computeCompletions, checkWin, onScore, onGameOver]
  );

  const handleCellRightClick = useCallback(
    (e: React.MouseEvent, r: number, c: number) => {
      e.preventDefault();
      if (pausedRef.current || doneRef.current) return;

      setBoard((prev) => {
        const next = prev.map((row) => [...row] as CellState[]);
        const cur = next[r][c];
        // Right-click: filled→crossed, empty→crossed, crossed→empty
        next[r][c] = cur === 2 ? 0 : 2;

        const { rows: newRows, cols: newCols } = computeCompletions(next);
        setCompletedRows(newRows);
        setCompletedCols(newCols);

        return next;
      });
    },
    [computeCompletions]
  );

  // Cell sizing based on puzzle size
  const cellSize = ROWS <= 5 ? "w-10 h-10" : ROWS <= 8 ? "w-8 h-8" : "w-7 h-7";
  const clueSize = ROWS <= 5 ? "w-10" : ROWS <= 8 ? "w-8" : "w-7";
  const clueTextSize = ROWS <= 5 ? "text-xs" : "text-[10px]";

  // Maximum number of clue items in any col for header height
  const maxColClueLen = Math.max(...colClues.map((c) => c.length));

  const formatTime = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

  return (
    <div className="flex flex-col items-center gap-3 select-none w-full max-w-sm mx-auto">
      {/* HUD */}
      <div className="flex w-full items-center justify-between text-sm px-1">
        <span className="text-muted-foreground">
          Time: <span className="text-foreground font-semibold">{formatTime(seconds)}</span>
        </span>
        {done ? (
          <span className="text-emerald-400 font-bold">Solved!</span>
        ) : (
          <span className="text-muted-foreground capitalize">{difficulty}</span>
        )}
        <span className="text-muted-foreground">
          Score:{" "}
          <span className="text-foreground font-semibold">
            {done ? 500 + Math.max(0, 300 - seconds) : "—"}
          </span>
        </span>
      </div>

      {/* Win banner */}
      {done && (
        <div className="w-full rounded-xl bg-emerald-950/40 border border-emerald-500/40 px-4 py-3 text-center">
          <p className="text-emerald-400 font-bold text-lg">Puzzle Complete!</p>
          <p className="text-muted-foreground text-sm mt-0.5">
            Solved in {formatTime(seconds)} — Score: {500 + Math.max(0, 300 - seconds)}
          </p>
        </div>
      )}

      {/* Puzzle grid */}
      <div className="overflow-auto">
        <table className="border-collapse" style={{ tableLayout: "fixed" }}>
          <thead>
            {/* Column clue rows */}
            {Array.from({ length: maxColClueLen }, (_, clueRow) => (
              <tr key={clueRow}>
                {/* Top-left empty corner cell */}
                <td
                  className={`${clueSize}`}
                  style={{ minWidth: clueRow === 0 ? undefined : undefined }}
                />
                {colClues.map((clue, c) => {
                  const offset = maxColClueLen - clue.length;
                  const val = clueRow >= offset ? clue[clueRow - offset] : null;
                  return (
                    <td key={c} className={`${clueSize} text-center align-bottom pb-0.5`}>
                      {val !== null ? (
                        <span
                          className={`${clueTextSize} font-semibold ${
                            completedCols[c] ? "text-emerald-400" : "text-foreground"
                          }`}
                        >
                          {val}
                        </span>
                      ) : null}
                    </td>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {board.map((row, r) => (
              <tr key={r}>
                {/* Row clues */}
                <td className={`${clueSize} text-right pr-1.5 align-middle`}>
                  <span
                    className={`${clueTextSize} font-semibold whitespace-nowrap ${
                      completedRows[r] ? "text-emerald-400" : "text-foreground"
                    }`}
                  >
                    {rowClues[r].join(" ")}
                  </span>
                </td>
                {/* Cells */}
                {row.map((state, c) => {
                  const isFilled = state === 1;
                  const isCrossed = state === 2;
                  const borderTop = r % 5 === 0 ? "border-t-2 border-t-border/60" : "";
                  const borderLeft = c % 5 === 0 ? "border-l-2 border-l-border/60" : "";
                  return (
                    <td key={c} className="p-0">
                      <button
                        type="button"
                        onClick={() => handleCellClick(r, c)}
                        onContextMenu={(e) => handleCellRightClick(e, r, c)}
                        disabled={done}
                        className={[
                          cellSize,
                          "border border-border/40 flex items-center justify-center",
                          "transition-all duration-150",
                          borderTop,
                          borderLeft,
                          isFilled
                            ? "bg-foreground"
                            : isCrossed
                            ? "bg-card text-muted-foreground/60"
                            : "bg-card hover:bg-accent active:scale-95",
                          done ? "cursor-default" : "cursor-pointer",
                        ].join(" ")}
                        aria-label={`Cell ${r + 1},${c + 1}`}
                      >
                        {isCrossed && (
                          <span className={`${ROWS <= 5 ? "text-sm" : "text-xs"} font-bold leading-none text-muted-foreground/70`}>
                            ×
                          </span>
                        )}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted-foreground text-center">
        Click to fill · Click again for × · Right-click to mark empty
      </p>
    </div>
  );
}
