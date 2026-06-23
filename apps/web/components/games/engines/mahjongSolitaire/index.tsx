"use client";

/**
 * Mahjong Solitaire — match and remove emoji tile pairs.
 * A tile is "free" if its left or right neighbour in the same row is absent.
 * Score = pairs_removed × 50.
 */

import { useEffect, useState, useCallback, useRef } from "react";
import type { GameEngineProps } from "@/components/games/types";
import { useGameSound } from "@/components/games/useGameSound";

// 20 unique symbols — each will appear in pairs
const SYMBOLS = [
  "🌸","🌺","🍀","🌙","⭐","🌊","🔥","💎","🦋","🌈",
  "🎵","🎨","🎭","🍎","🍊","🍇","🎸","🚀","🦊","🐉",
];

interface Tile {
  id: number;
  symbol: string;
  row: number;
  col: number;
  removed: boolean;
}

interface GridConfig {
  rows: number;
  cols: number;
  pairs: number;
}

const GRID_CONFIG: Record<string, GridConfig> = {
  easy:   { rows: 6, cols: 6,  pairs: 18 },
  medium: { rows: 8, cols: 9,  pairs: 36 },
  hard:   { rows: 9, cols: 12, pairs: 54 },
};

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function buildTiles(config: GridConfig): Tile[] {
  const { rows, cols, pairs } = config;
  // Repeat symbols to fill pairs count (cycle through symbols as needed)
  const symbolPool: string[] = [];
  for (let p = 0; p < pairs; p++) {
    const sym = SYMBOLS[p % SYMBOLS.length];
    symbolPool.push(sym, sym);
  }
  const shuffled = shuffle(symbolPool);

  const tiles: Tile[] = [];
  let idx = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      tiles.push({
        id: idx,
        symbol: shuffled[idx],
        row: r,
        col: c,
        removed: false,
      });
      idx++;
    }
  }
  return tiles;
}

/**
 * A tile is "free" if its left neighbour (same row, col-1) is absent/removed
 * OR its right neighbour (same row, col+1) is absent/removed.
 * A tile at col 0 always has its left side open.
 * A tile at the last col always has its right side open.
 */
function isFree(tile: Tile, tiles: Tile[], cols: number): boolean {
  if (tile.removed) return false;

  const leftFree =
    tile.col === 0 ||
    !tiles.some((t) => !t.removed && t.row === tile.row && t.col === tile.col - 1);

  const rightFree =
    tile.col === cols - 1 ||
    !tiles.some((t) => !t.removed && t.row === tile.row && t.col === tile.col + 1);

  return leftFree || rightFree;
}

export default function MahjongSolitaireGame({
  onReady,
  onGameOver,
  onScore,
  difficulty = "medium",
  paused,
  soundEnabled = true,
}: GameEngineProps) {
  const config = GRID_CONFIG[difficulty] ?? GRID_CONFIG.medium;
  const { rows, cols, pairs } = config;

  const [tiles, setTiles] = useState<Tile[]>(() => buildTiles(config));
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [pairsRemoved, setPairsRemoved] = useState(0);
  const [won, setWon] = useState(false);
  const [flashId, setFlashId] = useState<number | null>(null); // for miss flash

  const pausedRef = useRef(paused);
  const doneRef = useRef(false);
  const play = useGameSound(soundEnabled ?? true);

  useEffect(() => { pausedRef.current = paused; }, [paused]);
  useEffect(() => { onReady?.(); }, [onReady]);

  const handleTileClick = useCallback(
    (tile: Tile) => {
      if (pausedRef.current || doneRef.current || tile.removed) return;
      if (!isFree(tile, tiles, cols)) return;

      if (selectedId === null) {
        // First selection
        setSelectedId(tile.id);
        play("card");
        return;
      }

      if (selectedId === tile.id) {
        // Deselect same tile
        setSelectedId(null);
        return;
      }

      const selTile = tiles.find((t) => t.id === selectedId);
      if (!selTile) {
        setSelectedId(tile.id);
        play("card");
        return;
      }

      if (selTile.symbol === tile.symbol) {
        // Match!
        play("match");
        const newTiles = tiles.map((t) =>
          t.id === selTile.id || t.id === tile.id ? { ...t, removed: true } : t
        );
        setTiles(newTiles);
        setSelectedId(null);

        const newPairs = pairsRemoved + 1;
        setPairsRemoved(newPairs);
        const newScore = newPairs * 50;
        onScore?.(newScore);

        if (newPairs >= pairs) {
          // All pairs removed
          doneRef.current = true;
          setWon(true);
          play("win");
          onGameOver(newScore);
        }
      } else {
        // No match
        play("miss");
        setFlashId(tile.id);
        setTimeout(() => setFlashId(null), 400);
        setSelectedId(null);
      }
    },
    [tiles, selectedId, pairsRemoved, pairs, cols, onScore, onGameOver, play]
  );

  // Check for no more moves possible
  const freeTiles = tiles.filter((t) => !t.removed && isFree(t, tiles, cols));
  const hasMovesLeft = (() => {
    if (won) return true;
    const symbolCounts: Record<string, number> = {};
    for (const t of freeTiles) {
      symbolCounts[t.symbol] = (symbolCounts[t.symbol] ?? 0) + 1;
      if (symbolCounts[t.symbol] >= 2) return true;
    }
    return false;
  })();

  const score = pairsRemoved * 50;
  const remaining = pairs - pairsRemoved;

  // Grid rendering: build 2D map for quick lookup
  const tileMap = new Map<string, Tile>();
  for (const t of tiles) {
    if (!t.removed) tileMap.set(`${t.row},${t.col}`, t);
  }

  return (
    <div className="flex flex-col items-center gap-3 select-none w-full max-w-sm mx-auto">
      {/* Header */}
      <div className="flex w-full items-center justify-between text-sm px-1">
        <span className="text-muted-foreground">
          Score: <span className="text-foreground font-semibold">{score}</span>
        </span>
        {won ? (
          <span className="text-emerald-400 font-bold">All matched!</span>
        ) : !hasMovesLeft ? (
          <span className="text-red-400 font-semibold">No moves left</span>
        ) : (
          <span className="text-emerald-400 font-semibold">
            {remaining} pair{remaining !== 1 ? "s" : ""} left
          </span>
        )}
        <span className="text-muted-foreground text-xs">
          {freeTiles.length} free
        </span>
      </div>

      {/* Tile grid */}
      <div
        className="grid gap-0.5 w-full"
        style={{
          gridTemplateColumns: `repeat(${cols}, 1fr)`,
          gridTemplateRows: `repeat(${rows}, 1fr)`,
        }}
      >
        {Array.from({ length: rows * cols }).map((_, idx) => {
          const r = Math.floor(idx / cols);
          const c = idx % cols;
          const tile = tileMap.get(`${r},${c}`);

          if (!tile) {
            // Empty cell (removed tile)
            return (
              <div
                key={idx}
                className="aspect-square rounded-md bg-muted/10 border border-dashed border-border/20"
              />
            );
          }

          const free = isFree(tile, tiles, cols);
          const isSelected = tile.id === selectedId;
          const isFlashing = tile.id === flashId;

          return (
            <button
              key={tile.id}
              type="button"
              onClick={() => handleTileClick(tile)}
              disabled={!free || won}
              className={`aspect-square rounded-md text-xs sm:text-sm flex items-center justify-center border transition-all duration-150 leading-none ${
                isSelected
                  ? "ring-2 ring-white border-white/50 bg-primary/20 scale-95 z-10"
                  : isFlashing
                  ? "border-red-400/80 bg-red-950/30 scale-95"
                  : free
                  ? "border-border bg-card hover:border-primary/50 hover:bg-accent cursor-pointer hover:scale-95"
                  : "border-border/30 bg-card/50 opacity-50 cursor-not-allowed"
              }`}
            >
              {tile.symbol}
            </button>
          );
        })}
      </div>

      {/* Status messages */}
      {won && (
        <p className="text-emerald-400 text-sm font-semibold text-center">
          All {pairs} pairs matched! Final score: {score}
        </p>
      )}
      {!won && !hasMovesLeft && !doneRef.current && (
        <div className="flex flex-col items-center gap-2">
          <p className="text-red-400 text-sm font-semibold text-center">
            No more moves! {pairsRemoved} of {pairs} pairs cleared.
          </p>
          <button
            type="button"
            onClick={() => {
              if (doneRef.current) return;
              doneRef.current = true;
              onGameOver(score);
            }}
            className="px-4 py-1.5 text-sm bg-card border border-border rounded-lg text-foreground hover:bg-accent active:scale-95 transition-all duration-150"
          >
            End Game
          </button>
        </div>
      )}
      {!won && hasMovesLeft && (
        <p className="text-xs text-muted-foreground text-center">
          Select two matching tiles to remove them. Free tiles have full opacity.
        </p>
      )}
    </div>
  );
}
