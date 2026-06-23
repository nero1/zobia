"use client";

/**
 * Sliding Blocks (Rush Hour) — slide blocks to guide the red car to the exit.
 * Grid: 6×6. Red car is horizontal on row 2. Exit is the right edge (col 6).
 * Score = max(0, 500 - moves * 20).
 */

import { useEffect, useState, useCallback, useRef } from "react";
import type { GameEngineProps } from "@/components/games/types";
import { useGameSound } from "@/components/games/useGameSound";

interface Block {
  id: string;
  color: string;
  row: number;
  col: number;
  length: number;
  orientation: "H" | "V";
  isRed?: boolean;
}

const GRID_SIZE = 6;

const PUZZLES: Record<string, Block[][]> = {
  easy: [
    [
      { id: "red", color: "bg-red-500",    row: 2, col: 0, length: 2, orientation: "H", isRed: true },
      { id: "b1",  color: "bg-blue-500",   row: 0, col: 2, length: 3, orientation: "V" },
      { id: "b2",  color: "bg-green-500",  row: 0, col: 4, length: 2, orientation: "H" },
      { id: "b3",  color: "bg-yellow-500", row: 1, col: 3, length: 2, orientation: "V" },
      { id: "b4",  color: "bg-purple-500", row: 3, col: 2, length: 2, orientation: "H" },
      { id: "b5",  color: "bg-orange-500", row: 4, col: 0, length: 3, orientation: "H" },
    ],
    [
      { id: "red", color: "bg-red-500",    row: 2, col: 1, length: 2, orientation: "H", isRed: true },
      { id: "b1",  color: "bg-blue-500",   row: 0, col: 3, length: 3, orientation: "V" },
      { id: "b2",  color: "bg-green-500",  row: 2, col: 3, length: 2, orientation: "V" },
      { id: "b3",  color: "bg-yellow-500", row: 0, col: 0, length: 2, orientation: "V" },
      { id: "b4",  color: "bg-purple-500", row: 3, col: 1, length: 3, orientation: "H" },
    ],
  ],
  medium: [
    [
      { id: "red", color: "bg-red-500",    row: 2, col: 0, length: 2, orientation: "H", isRed: true },
      { id: "b1",  color: "bg-blue-500",   row: 0, col: 2, length: 2, orientation: "V" },
      { id: "b2",  color: "bg-green-500",  row: 0, col: 3, length: 3, orientation: "H" },
      { id: "b3",  color: "bg-yellow-500", row: 1, col: 5, length: 2, orientation: "V" },
      { id: "b4",  color: "bg-purple-500", row: 2, col: 3, length: 2, orientation: "H" },
      { id: "b5",  color: "bg-orange-500", row: 3, col: 2, length: 3, orientation: "V" },
      { id: "b6",  color: "bg-pink-500",   row: 4, col: 0, length: 2, orientation: "H" },
      { id: "b7",  color: "bg-cyan-500",   row: 3, col: 4, length: 2, orientation: "H" },
    ],
    [
      { id: "red", color: "bg-red-500",    row: 2, col: 2, length: 2, orientation: "H", isRed: true },
      { id: "b1",  color: "bg-blue-500",   row: 0, col: 0, length: 3, orientation: "V" },
      { id: "b2",  color: "bg-green-500",  row: 0, col: 4, length: 2, orientation: "H" },
      { id: "b3",  color: "bg-yellow-500", row: 1, col: 2, length: 2, orientation: "V" },
      { id: "b4",  color: "bg-purple-500", row: 2, col: 5, length: 3, orientation: "V" },
      { id: "b5",  color: "bg-orange-500", row: 3, col: 1, length: 2, orientation: "H" },
      { id: "b6",  color: "bg-pink-500",   row: 4, col: 3, length: 3, orientation: "H" },
    ],
  ],
  hard: [
    [
      { id: "red", color: "bg-red-500",    row: 2, col: 1, length: 2, orientation: "H", isRed: true },
      { id: "b1",  color: "bg-blue-500",   row: 0, col: 0, length: 2, orientation: "H" },
      { id: "b2",  color: "bg-green-500",  row: 0, col: 3, length: 3, orientation: "V" },
      { id: "b3",  color: "bg-yellow-500", row: 0, col: 5, length: 3, orientation: "V" },
      { id: "b4",  color: "bg-purple-500", row: 1, col: 1, length: 2, orientation: "V" },
      { id: "b5",  color: "bg-orange-500", row: 1, col: 4, length: 2, orientation: "H" },
      { id: "b6",  color: "bg-pink-500",   row: 2, col: 3, length: 2, orientation: "V" },
      { id: "b7",  color: "bg-cyan-500",   row: 3, col: 0, length: 3, orientation: "H" },
      { id: "b8",  color: "bg-lime-500",   row: 4, col: 2, length: 2, orientation: "H" },
      { id: "b9",  color: "bg-amber-500",  row: 5, col: 4, length: 2, orientation: "H" },
    ],
    [
      { id: "red", color: "bg-red-500",    row: 2, col: 0, length: 2, orientation: "H", isRed: true },
      { id: "b1",  color: "bg-blue-500",   row: 0, col: 1, length: 3, orientation: "V" },
      { id: "b2",  color: "bg-green-500",  row: 0, col: 2, length: 2, orientation: "H" },
      { id: "b3",  color: "bg-yellow-500", row: 0, col: 4, length: 2, orientation: "V" },
      { id: "b4",  color: "bg-purple-500", row: 1, col: 3, length: 2, orientation: "H" },
      { id: "b5",  color: "bg-orange-500", row: 2, col: 2, length: 2, orientation: "V" },
      { id: "b6",  color: "bg-pink-500",   row: 3, col: 0, length: 2, orientation: "H" },
      { id: "b7",  color: "bg-cyan-500",   row: 3, col: 3, length: 3, orientation: "H" },
      { id: "b8",  color: "bg-lime-500",   row: 4, col: 1, length: 2, orientation: "V" },
      { id: "b9",  color: "bg-amber-500",  row: 5, col: 3, length: 3, orientation: "H" },
    ],
  ],
};

/** Build a 6×6 occupancy grid: each cell holds the block id or null */
function buildGrid(blocks: Block[]): (string | null)[][] {
  const grid: (string | null)[][] = Array.from({ length: GRID_SIZE }, () =>
    Array(GRID_SIZE).fill(null)
  );
  for (const b of blocks) {
    for (let i = 0; i < b.length; i++) {
      const r = b.orientation === "V" ? b.row + i : b.row;
      const c = b.orientation === "H" ? b.col + i : b.col;
      if (r >= 0 && r < GRID_SIZE && c >= 0 && c < GRID_SIZE) {
        grid[r][c] = b.id;
      }
    }
  }
  return grid;
}

/** Returns the cells a block occupies */
function blockCells(b: Block): { r: number; c: number }[] {
  return Array.from({ length: b.length }, (_, i) => ({
    r: b.orientation === "V" ? b.row + i : b.row,
    c: b.orientation === "H" ? b.col + i : b.col,
  }));
}

/**
 * Check whether block b can slide to a new top-left position (newRow, newCol).
 * Returns true if all cells along the path (exclusive of b's own cells) are empty.
 */
function canSlide(b: Block, newRow: number, newCol: number, grid: (string | null)[][]): boolean {
  if (b.orientation === "H") {
    // newRow must equal b.row
    if (newRow !== b.row) return false;
    if (newCol < 0 || newCol + b.length - 1 >= GRID_SIZE) return false;
    // Cells the block would move through/to
    const ownCols = new Set(Array.from({ length: b.length }, (_, i) => b.col + i));
    if (newCol < b.col) {
      // Moving left: check cols [newCol .. b.col - 1]
      for (let c = newCol; c < b.col; c++) {
        if (!ownCols.has(c) && grid[b.row][c] !== null) return false;
      }
    } else {
      // Moving right: check cols [b.col + b.length .. newCol + b.length - 1]
      for (let c = b.col + b.length; c <= newCol + b.length - 1; c++) {
        if (c < GRID_SIZE && grid[b.row][c] !== null) return false;
      }
    }
    return true;
  } else {
    // Vertical
    if (newCol !== b.col) return false;
    if (newRow < 0 || newRow + b.length - 1 >= GRID_SIZE) return false;
    const ownRows = new Set(Array.from({ length: b.length }, (_, i) => b.row + i));
    if (newRow < b.row) {
      for (let r = newRow; r < b.row; r++) {
        if (!ownRows.has(r) && grid[r][b.col] !== null) return false;
      }
    } else {
      for (let r = b.row + b.length; r <= newRow + b.length - 1; r++) {
        if (r < GRID_SIZE && grid[r][b.col] !== null) return false;
      }
    }
    return true;
  }
}

function deepCloneBlocks(blocks: Block[]): Block[] {
  return blocks.map((b) => ({ ...b }));
}

function getPuzzle(difficulty: string): Block[] {
  const puzzles = PUZZLES[difficulty] ?? PUZZLES.medium;
  return deepCloneBlocks(puzzles[Math.floor(Math.random() * puzzles.length)]);
}

export default function SlidingBlocksGame({
  onReady,
  onGameOver,
  onScore,
  difficulty = "medium",
  paused,
  soundEnabled = true,
}: GameEngineProps) {
  const [blocks, setBlocks] = useState<Block[]>(() => getPuzzle(difficulty));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [moves, setMoves] = useState(0);
  const [won, setWon] = useState(false);
  const [exiting, setExiting] = useState(false);

  const pausedRef = useRef(paused);
  const doneRef = useRef(false);
  const play = useGameSound(soundEnabled ?? true);

  useEffect(() => { pausedRef.current = paused; }, [paused]);
  useEffect(() => { onReady?.(); }, [onReady]);

  const score = Math.max(0, 500 - moves * 20);

  const handleWin = useCallback(
    (finalMoves: number) => {
      if (doneRef.current) return;
      doneRef.current = true;
      play("win");
      setExiting(true);
      setWon(true);
      const finalScore = Math.max(0, 500 - finalMoves * 20);
      onScore?.(finalScore);
      setTimeout(() => {
        onGameOver(finalScore);
      }, 800);
    },
    [onGameOver, onScore, play]
  );

  const slideBlock = useCallback(
    (blockId: string, newRow: number, newCol: number) => {
      if (pausedRef.current || doneRef.current) return;

      setBlocks((prev) => {
        const block = prev.find((b) => b.id === blockId);
        if (!block) return prev;

        const grid = buildGrid(prev);
        if (!canSlide(block, newRow, newCol, grid)) return prev;

        play("move");
        const newBlocks = prev.map((b) =>
          b.id === blockId ? { ...b, row: newRow, col: newCol } : b
        );

        setMoves((m) => {
          const newMoves = m + 1;
          onScore?.(Math.max(0, 500 - newMoves * 20));
          // Win check: red block reaches col 4 (occupies cols 4-5)
          if (blockId === "red" && newCol === 4) {
            handleWin(newMoves);
          }
          return newMoves;
        });

        return newBlocks;
      });
    },
    [onScore, play, handleWin]
  );

  const handleCellClick = useCallback(
    (r: number, c: number) => {
      if (pausedRef.current || doneRef.current) return;

      const grid = buildGrid(blocks);
      const clickedId = grid[r]?.[c] ?? null;

      if (clickedId !== null) {
        // Clicking a block: select or deselect
        setSelectedId((prev) => (prev === clickedId ? null : clickedId));
        play("click");
        return;
      }

      // Clicking an empty cell
      if (selectedId === null) return;
      const selBlock = blocks.find((b) => b.id === selectedId);
      if (!selBlock) return;

      if (selBlock.orientation === "H" && r === selBlock.row) {
        // Slide horizontal block: target col is the clicked col if left-edge would be there
        // Determine if click is to the left or right and compute new col for the block
        let targetCol: number;
        if (c < selBlock.col) {
          // Clicked left of block — slide left so left edge = c
          targetCol = c;
        } else {
          // Clicked right of block — slide right so right edge = c, left edge = c - length + 1
          targetCol = c - selBlock.length + 1;
        }
        if (targetCol >= 0 && targetCol + selBlock.length - 1 < GRID_SIZE) {
          slideBlock(selectedId, r, targetCol);
          setSelectedId(null);
        }
      } else if (selBlock.orientation === "V" && c === selBlock.col) {
        let targetRow: number;
        if (r < selBlock.row) {
          targetRow = r;
        } else {
          targetRow = r - selBlock.length + 1;
        }
        if (targetRow >= 0 && targetRow + selBlock.length - 1 < GRID_SIZE) {
          slideBlock(selectedId, targetRow, c);
          setSelectedId(null);
        }
      }
    },
    [blocks, selectedId, slideBlock, play]
  );

  // Arrow key support for selected block
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (doneRef.current || pausedRef.current || !selectedId) return;
      const selBlock = blocks.find((b) => b.id === selectedId);
      if (!selBlock) return;

      if (selBlock.orientation === "H") {
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          slideBlock(selectedId, selBlock.row, selBlock.col - 1);
        } else if (e.key === "ArrowRight") {
          e.preventDefault();
          slideBlock(selectedId, selBlock.row, selBlock.col + 1);
        }
      } else {
        if (e.key === "ArrowUp") {
          e.preventDefault();
          slideBlock(selectedId, selBlock.row - 1, selBlock.col);
        } else if (e.key === "ArrowDown") {
          e.preventDefault();
          slideBlock(selectedId, selBlock.row + 1, selBlock.col);
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [blocks, selectedId, slideBlock]);

  const grid = buildGrid(blocks);

  // Arrow buttons for selected block
  const selectedBlock = blocks.find((b) => b.id === selectedId) ?? null;

  const moveSelected = (dr: number, dc: number) => {
    if (!selectedBlock || doneRef.current || pausedRef.current) return;
    slideBlock(selectedBlock.id, selectedBlock.row + dr, selectedBlock.col + dc);
  };

  return (
    <div className="flex flex-col items-center gap-3 select-none w-full max-w-sm mx-auto">
      {/* Header */}
      <div className="flex w-full items-center justify-between text-sm px-1">
        <span className="text-muted-foreground">
          Moves: <span className="text-foreground font-semibold">{moves}</span>
        </span>
        {won ? (
          <span className="text-emerald-400 font-bold">Escaped! +{score}</span>
        ) : (
          <span className="text-muted-foreground">
            Score: <span className="text-foreground font-semibold">{score}</span>
          </span>
        )}
        <span className="text-muted-foreground text-xs">
          {selectedId ? (
            <span className="text-emerald-400">
              {selectedId === "red" ? "Red car" : selectedId} selected
            </span>
          ) : (
            "Click a block"
          )}
        </span>
      </div>

      {/* Game grid */}
      <div className="relative w-full aspect-square bg-card border border-border rounded-xl overflow-hidden p-1">
        {/* Exit marker on right side of row 2 */}
        <div
          className="absolute right-0 top-0 flex items-center justify-center z-10"
          style={{
            height: `${100 / GRID_SIZE}%`,
            top: `${(2 / GRID_SIZE) * 100}%`,
            width: "0.5rem",
          }}
        >
          <div className="w-1 h-3/4 bg-emerald-400/60 rounded-l" />
        </div>

        {/* Grid cells */}
        <div
          className="grid h-full w-full gap-0.5"
          style={{
            gridTemplateColumns: `repeat(${GRID_SIZE}, 1fr)`,
            gridTemplateRows: `repeat(${GRID_SIZE}, 1fr)`,
          }}
        >
          {Array.from({ length: GRID_SIZE * GRID_SIZE }).map((_, idx) => {
            const r = Math.floor(idx / GRID_SIZE);
            const c = idx % GRID_SIZE;
            return (
              <div
                key={idx}
                onClick={() => handleCellClick(r, c)}
                className={`rounded-sm cursor-pointer transition-all duration-150 ${
                  r === 2 ? "bg-emerald-950/20" : "bg-muted/20"
                } hover:bg-primary/10`}
              />
            );
          })}
        </div>

        {/* Blocks rendered absolutely */}
        {blocks.map((b) => {
          const isSelected = b.id === selectedId;
          const isExiting = b.isRed && exiting;
          const cells = blockCells(b);
          const minR = Math.min(...cells.map((c) => c.r));
          const minC = Math.min(...cells.map((c) => c.c));
          const maxR = Math.max(...cells.map((c) => c.r));
          const maxC = Math.max(...cells.map((c) => c.c));

          const topPct = (minR / GRID_SIZE) * 100;
          const leftPct = (minC / GRID_SIZE) * 100;
          const heightPct = ((maxR - minR + 1) / GRID_SIZE) * 100;
          const widthPct = ((maxC - minC + 1) / GRID_SIZE) * 100;

          return (
            <div
              key={b.id}
              onClick={() => {
                if (doneRef.current || pausedRef.current) return;
                setSelectedId((prev) => (prev === b.id ? null : b.id));
                play("click");
              }}
              className={`absolute rounded-lg cursor-pointer flex items-center justify-center transition-all duration-150 ${b.color} ${
                isSelected
                  ? "ring-2 ring-white ring-offset-1 ring-offset-transparent brightness-110 z-20"
                  : "hover:brightness-110 z-10"
              } ${isExiting ? "translate-x-full opacity-0" : ""}`}
              style={{
                top: `calc(${topPct}% + 2px)`,
                left: `calc(${leftPct}% + 2px)`,
                width: `calc(${widthPct}% - 4px)`,
                height: `calc(${heightPct}% - 4px)`,
              }}
            >
              {b.isRed && (
                <span className="text-white font-bold text-xs select-none pointer-events-none">
                  →
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Arrow control pad for selected block */}
      {selectedBlock && !won && (
        <div className="flex flex-col items-center gap-1">
          {selectedBlock.orientation === "V" && (
            <button
              type="button"
              onClick={() => moveSelected(-1, 0)}
              className="w-10 h-8 bg-card border border-border rounded-lg text-foreground hover:bg-accent active:scale-95 transition-all duration-150 flex items-center justify-center text-sm"
            >
              ▲
            </button>
          )}
          <div className="flex gap-1">
            {selectedBlock.orientation === "H" && (
              <button
                type="button"
                onClick={() => moveSelected(0, -1)}
                className="w-10 h-8 bg-card border border-border rounded-lg text-foreground hover:bg-accent active:scale-95 transition-all duration-150 flex items-center justify-center text-sm"
              >
                ◀
              </button>
            )}
            <div className="w-10 h-8 flex items-center justify-center">
              <span className="text-xs text-muted-foreground truncate max-w-full px-1">
                {selectedBlock.isRed ? "🚗" : "📦"}
              </span>
            </div>
            {selectedBlock.orientation === "H" && (
              <button
                type="button"
                onClick={() => moveSelected(0, 1)}
                className="w-10 h-8 bg-card border border-border rounded-lg text-foreground hover:bg-accent active:scale-95 transition-all duration-150 flex items-center justify-center text-sm"
              >
                ▶
              </button>
            )}
          </div>
          {selectedBlock.orientation === "V" && (
            <button
              type="button"
              onClick={() => moveSelected(1, 0)}
              className="w-10 h-8 bg-card border border-border rounded-lg text-foreground hover:bg-accent active:scale-95 transition-all duration-150 flex items-center justify-center text-sm"
            >
              ▼
            </button>
          )}
        </div>
      )}

      {/* Instructions */}
      {!won && !selectedId && (
        <p className="text-xs text-muted-foreground text-center">
          Click the <span className="text-red-400 font-semibold">red car</span> then click
          where to slide it. Guide it to the{" "}
          <span className="text-emerald-400 font-semibold">green exit</span> on the right.
        </p>
      )}
      {won && (
        <p className="text-emerald-400 text-sm font-semibold text-center">
          The red car escaped in {moves} move{moves !== 1 ? "s" : ""}!
        </p>
      )}
    </div>
  );
}
