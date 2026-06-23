"use client";

/**
 * Word Search — find all hidden words in a letter grid.
 * Click the first letter of a word, then the last to select.
 * Score = words_found * 100 + max(0, 300 - seconds_taken).
 */

import { useEffect, useState, useCallback, useRef } from "react";
import type { GameEngineProps } from "@/components/games/types";
import { useGameSound } from "@/components/games/useGameSound";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WORD_LISTS: Record<string, string[]> = {
  easy:   ["CAT", "DOG", "FISH", "BIRD", "LION", "BEAR", "WOLF", "FROG"],
  medium: ["EAGLE", "TIGER", "SHARK", "WHALE", "KOALA", "PANDA", "HORSE", "ZEBRA", "COBRA", "MOOSE"],
  hard:   ["ELEPHANT", "CHEETAH", "DOLPHIN", "PENGUIN", "GORILLA", "PANTHER", "BUFFALO", "GIRAFFE", "FLAMINGO", "LEOPARD", "JAGUAR", "VULTURE"],
};

const GRID_SIZES: Record<string, number> = { easy: 8, medium: 10, hard: 12 };

// 8 directions: [row_delta, col_delta]
const DIRECTIONS: [number, number][] = [
  [0, 1], [0, -1], [1, 0], [-1, 0],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
];

// ---------------------------------------------------------------------------
// Grid generation
// ---------------------------------------------------------------------------

function buildGrid(words: string[], size: number): { grid: string[][]; placements: Placement[] } {
  const MAX_ATTEMPTS = 200;

  function tryPlace(
    grid: string[][],
    word: string,
    attempts = 100
  ): { r: number; c: number; dr: number; dc: number } | null {
    for (let i = 0; i < attempts; i++) {
      const [dr, dc] = DIRECTIONS[Math.floor(Math.random() * DIRECTIONS.length)];
      const r = Math.floor(Math.random() * size);
      const c = Math.floor(Math.random() * size);

      // Check bounds
      const endR = r + dr * (word.length - 1);
      const endC = c + dc * (word.length - 1);
      if (endR < 0 || endR >= size || endC < 0 || endC >= size) continue;

      // Check for conflicts
      let ok = true;
      for (let j = 0; j < word.length; j++) {
        const nr = r + dr * j;
        const nc = c + dc * j;
        if (grid[nr][nc] !== "" && grid[nr][nc] !== word[j]) { ok = false; break; }
      }
      if (!ok) continue;

      return { r, c, dr, dc };
    }
    return null;
  }

  // Try the full board generation up to MAX_ATTEMPTS times
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const grid: string[][] = Array.from({ length: size }, () => Array(size).fill(""));
    const placements: Placement[] = [];
    let allPlaced = true;

    // Shuffle words before placing so order doesn't bias placement
    const shuffledWords = [...words].sort(() => Math.random() - 0.5);

    for (const word of shuffledWords) {
      const placement = tryPlace(grid, word);
      if (!placement) { allPlaced = false; break; }
      const { r, c, dr, dc } = placement;
      for (let j = 0; j < word.length; j++) {
        grid[r + dr * j][c + dc * j] = word[j];
      }
      placements.push({ word, r, c, dr, dc });
    }

    if (!allPlaced) continue;

    // Fill empty cells with random letters
    const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (grid[r][c] === "") {
          grid[r][c] = letters[Math.floor(Math.random() * letters.length)];
        }
      }
    }

    return { grid, placements };
  }

  // Fallback: place what we can and fill rest
  const grid: string[][] = Array.from({ length: size }, () => Array(size).fill(""));
  const placements: Placement[] = [];
  for (const word of words) {
    const placement = tryPlace(grid, word, 200);
    if (placement) {
      const { r, c, dr, dc } = placement;
      for (let j = 0; j < word.length; j++) {
        grid[r + dr * j][c + dc * j] = word[j];
      }
      placements.push({ word, r, c, dr, dc });
    }
  }
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (grid[r][c] === "") grid[r][c] = letters[Math.floor(Math.random() * letters.length)];
    }
  }
  return { grid, placements };
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Placement {
  word: string;
  r: number;
  c: number;
  dr: number;
  dc: number;
}

interface CellPos { r: number; c: number }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTime(secs: number): string {
  const m = Math.floor(secs / 60).toString().padStart(2, "0");
  const s = (secs % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

/** Return all cells between two points if they form a valid straight line, else null */
function getLineCells(start: CellPos, end: CellPos): CellPos[] | null {
  const dr = end.r - start.r;
  const dc = end.c - start.c;
  const len = Math.max(Math.abs(dr), Math.abs(dc));
  if (len === 0) return [start];

  // Must be horizontal, vertical, or exactly diagonal
  if (Math.abs(dr) !== 0 && Math.abs(dc) !== 0 && Math.abs(dr) !== Math.abs(dc)) return null;

  const stepR = dr === 0 ? 0 : dr / Math.abs(dr);
  const stepC = dc === 0 ? 0 : dc / Math.abs(dc);

  const cells: CellPos[] = [];
  for (let i = 0; i <= len; i++) {
    cells.push({ r: start.r + stepR * i, c: start.c + stepC * i });
  }
  return cells;
}

/** Check if selected cells spell a word (forward or backward) matching a placement */
function matchPlacement(cells: CellPos[], grid: string[][], placements: Placement[]): Placement | null {
  if (cells.length < 2) return null;
  const word = cells.map((p) => grid[p.r][p.c]).join("");
  const wordRev = [...word].reverse().join("");

  for (const p of placements) {
    if (p.word === word || p.word === wordRev) {
      // Verify the cells actually match this placement
      const placeCells = Array.from({ length: p.word.length }, (_, i) => ({
        r: p.r + p.dr * i,
        c: p.c + p.dc * i,
      }));
      // Check either forward or backward match
      const fwd = cells.every((cell, i) => placeCells[i]?.r === cell.r && placeCells[i]?.c === cell.c);
      const bwd = cells.every((cell, i) => {
        const pi = placeCells.length - 1 - i;
        return placeCells[pi]?.r === cell.r && placeCells[pi]?.c === cell.c;
      });
      if (fwd || bwd) return p;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function WordSearchGame({
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

  const words = WORD_LISTS[difficulty] ?? WORD_LISTS.medium;
  const size = GRID_SIZES[difficulty] ?? 10;

  const [{ grid, placements }] = useState(() => buildGrid(words, size));

  const [foundWords, setFoundWords] = useState<Set<string>>(new Set());
  const [firstClick, setFirstClick] = useState<CellPos | null>(null);
  const [hoverCell, setHoverCell] = useState<CellPos | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [done, setDone] = useState(false);
  const [flash, setFlash] = useState<{ cells: CellPos[]; good: boolean } | null>(null);

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

  // Cells that are part of found words
  const foundCells = useRef<Map<string, string>>(new Map()); // "r,c" -> word

  // Compute preview selection (cells between first click and hover)
  const previewCells: CellPos[] | null =
    firstClick && hoverCell ? getLineCells(firstClick, hoverCell) : null;

  const handleCellClick = useCallback((r: number, c: number) => {
    if (pausedRef.current || done) return;

    if (!firstClick) {
      // First click — set anchor
      setFirstClick({ r, c });
      play("tap");
      return;
    }

    // Second click — attempt to match a word
    const selCells = getLineCells(firstClick, { r, c });
    if (!selCells || selCells.length < 2) {
      // Not a valid line — reset or re-anchor if same cell
      if (firstClick.r === r && firstClick.c === c) {
        setFirstClick(null);
      } else {
        setFirstClick({ r, c });
        play("tap");
      }
      return;
    }

    const matched = matchPlacement(selCells, grid, placements);

    if (matched && !foundWords.has(matched.word)) {
      // Found a new word!
      play("match");
      const newFound = new Set(foundWords);
      newFound.add(matched.word);

      // Record found cells
      for (let i = 0; i < matched.word.length; i++) {
        const key = `${matched.r + matched.dr * i},${matched.c + matched.dc * i}`;
        foundCells.current.set(key, matched.word);
      }

      setFoundWords(newFound);
      setFirstClick(null);
      setHoverCell(null);

      const score = newFound.size * 100 + Math.max(0, 300 - seconds);
      onScore?.(score);

      if (newFound.size >= words.length && !gameOverFiredRef.current) {
        gameOverFiredRef.current = true;
        setDone(true);
        play("win");
        const finalScore = newFound.size * 100 + Math.max(0, 300 - seconds);
        onGameOver(finalScore);
      }
    } else if (matched && foundWords.has(matched.word)) {
      // Already found — just reset
      setFirstClick(null);
      setHoverCell(null);
    } else {
      // No match
      play("miss");
      setFlash({ cells: selCells, good: false });
      setTimeout(() => {
        setFlash(null);
        setFirstClick(null);
        setHoverCell(null);
      }, 500);
    }
  }, [done, firstClick, foundWords, grid, placements, words.length, seconds, onScore, onGameOver, play]);

  const handleCellHover = useCallback((r: number, c: number) => {
    if (firstClick) setHoverCell({ r, c });
  }, [firstClick]);

  // Determine cell appearance
  const getCellClass = (r: number, c: number): string => {
    const key = `${r},${c}`;
    const isFound = foundCells.current.has(key);
    const isFirst = firstClick?.r === r && firstClick?.c === c;

    const inPreview = previewCells?.some((p) => p.r === r && p.c === c);
    const inFlash = flash?.cells.some((p) => p.r === r && p.c === c);

    let base = "flex items-center justify-center font-bold cursor-pointer transition-all duration-100 rounded-sm select-none ";

    // Size responsive
    if (size === 8) base += "text-sm ";
    else if (size === 10) base += "text-xs ";
    else base += "text-[10px] ";

    if (isFound) {
      base += "bg-emerald-600 text-white ";
    } else if (inFlash) {
      base += flash?.good ? "bg-emerald-500 text-white " : "bg-red-700/60 text-red-200 ";
    } else if (isFirst) {
      base += "bg-blue-500 text-white ring-2 ring-blue-300 ";
    } else if (inPreview) {
      base += "bg-blue-600/70 text-white ";
    } else {
      base += "bg-card hover:bg-accent text-foreground border border-border/30 ";
    }

    return base;
  };

  const score = foundWords.size * 100 + Math.max(0, 300 - seconds);

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
          Score: <span className="text-foreground font-semibold">{score}</span>
        </span>
      </div>

      {/* Progress */}
      <div className="flex w-full items-center gap-2 px-1">
        <div className="flex-1 h-1.5 bg-neutral-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-emerald-500 rounded-full transition-all duration-500"
            style={{ width: `${(foundWords.size / words.length) * 100}%` }}
          />
        </div>
        <span className="text-xs text-muted-foreground shrink-0">{foundWords.size}/{words.length}</span>
      </div>

      {/* Grid */}
      <div
        className="w-full rounded-lg border border-border bg-card overflow-hidden p-0.5"
        style={{ display: "grid", gridTemplateColumns: `repeat(${size}, 1fr)`, gap: "1px" }}
        onMouseLeave={() => { if (!done) setHoverCell(null); }}
      >
        {grid.map((row, r) =>
          row.map((letter, c) => (
            <div
              key={`${r}-${c}`}
              className={getCellClass(r, c)}
              style={{ aspectRatio: "1" }}
              onClick={() => handleCellClick(r, c)}
              onMouseEnter={() => handleCellHover(r, c)}
            >
              {letter}
            </div>
          ))
        )}
      </div>

      {/* Word list */}
      <div className="w-full">
        <div className="flex flex-wrap gap-1.5 justify-center">
          {words.map((word) => {
            const found = foundWords.has(word);
            return (
              <span
                key={word}
                className={`px-2 py-0.5 rounded-lg text-xs font-medium border transition-all duration-150 ${
                  found
                    ? "border-emerald-500/30 bg-emerald-950/20 text-emerald-400 line-through decoration-emerald-500"
                    : "border-border bg-card text-muted-foreground"
                }`}
              >
                {word}
              </span>
            );
          })}
        </div>
      </div>

      {/* Done banner */}
      {done && (
        <div className="w-full rounded-2xl border-2 border-emerald-500/50 bg-emerald-950/30 p-4 text-center">
          <div className="text-emerald-400 font-bold text-lg">All Words Found!</div>
          <div className="text-muted-foreground text-sm mt-1">
            Time: {formatTime(seconds)} · Score: {score}
          </div>
        </div>
      )}

      {/* Instructions */}
      {!done && (
        <p className="text-xs text-muted-foreground text-center">
          {firstClick
            ? "Now click the last letter of a word"
            : "Click the first letter of a hidden word"}
        </p>
      )}
    </div>
  );
}
