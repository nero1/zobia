"use client";

/**
 * Pipe Connect (Flow Free) — connect matching colored endpoint pairs by
 * drawing paths, filling the entire grid without crossing paths.
 */

import { useEffect, useState, useCallback, useRef } from "react";
import type { GameEngineProps } from "@/components/games/types";
import { useGameSound } from "@/components/games/useGameSound";

// ─── Types ────────────────────────────────────────────────────────────────────

type ColorName =
  | "red"
  | "blue"
  | "green"
  | "yellow"
  | "purple"
  | "orange"
  | "pink"
  | "cyan";

const COLOR_BG: Record<ColorName, string> = {
  red: "bg-red-500",
  blue: "bg-blue-500",
  green: "bg-green-500",
  yellow: "bg-yellow-400",
  purple: "bg-purple-500",
  orange: "bg-orange-500",
  pink: "bg-pink-500",
  cyan: "bg-cyan-500",
};

const COLOR_BORDER: Record<ColorName, string> = {
  red: "border-red-400",
  blue: "border-blue-400",
  green: "border-green-400",
  yellow: "border-yellow-300",
  purple: "border-purple-400",
  orange: "border-orange-400",
  pink: "border-pink-400",
  cyan: "border-cyan-400",
};

const COLOR_RING: Record<ColorName, string> = {
  red: "ring-red-400",
  blue: "ring-blue-400",
  green: "ring-green-400",
  yellow: "ring-yellow-300",
  purple: "ring-purple-400",
  orange: "ring-orange-400",
  pink: "ring-pink-400",
  cyan: "ring-cyan-400",
};

interface Endpoint {
  color: ColorName;
  from: [number, number];
  to: [number, number];
}

interface PuzzleDef {
  size: number;
  endpoints: Endpoint[];
}

// ─── Puzzle definitions ───────────────────────────────────────────────────────

const EASY_PUZZLES: PuzzleDef[] = [
  {
    size: 5,
    endpoints: [
      { color: "red",    from: [0, 0], to: [4, 4] },
      { color: "blue",   from: [0, 4], to: [4, 0] },
      { color: "green",  from: [0, 2], to: [4, 2] },
      { color: "yellow", from: [2, 0], to: [2, 4] },
    ],
  },
  {
    size: 5,
    endpoints: [
      { color: "red",    from: [0, 0], to: [2, 2] },
      { color: "blue",   from: [0, 3], to: [3, 0] },
      { color: "green",  from: [1, 1], to: [4, 4] },
      { color: "yellow", from: [2, 4], to: [4, 1] },
    ],
  },
];

const MEDIUM_PUZZLES: PuzzleDef[] = [
  {
    size: 7,
    endpoints: [
      { color: "red",    from: [0, 0], to: [6, 6] },
      { color: "blue",   from: [0, 6], to: [6, 0] },
      { color: "green",  from: [0, 3], to: [6, 3] },
      { color: "yellow", from: [3, 0], to: [3, 6] },
      { color: "purple", from: [1, 1], to: [5, 5] },
      { color: "orange", from: [1, 5], to: [5, 1] },
    ],
  },
  {
    size: 7,
    endpoints: [
      { color: "red",    from: [0, 1], to: [6, 5] },
      { color: "blue",   from: [0, 5], to: [6, 1] },
      { color: "green",  from: [2, 0], to: [4, 6] },
      { color: "yellow", from: [2, 6], to: [4, 0] },
      { color: "purple", from: [0, 3], to: [6, 3] },
      { color: "orange", from: [3, 2], to: [3, 4] },
    ],
  },
];

const HARD_PUZZLES: PuzzleDef[] = [
  {
    size: 9,
    endpoints: [
      { color: "red",    from: [0, 0], to: [8, 8] },
      { color: "blue",   from: [0, 8], to: [8, 0] },
      { color: "green",  from: [0, 4], to: [8, 4] },
      { color: "yellow", from: [4, 0], to: [4, 8] },
      { color: "purple", from: [1, 1], to: [7, 7] },
      { color: "orange", from: [1, 7], to: [7, 1] },
      { color: "pink",   from: [2, 2], to: [6, 6] },
      { color: "cyan",   from: [2, 6], to: [6, 2] },
    ],
  },
  {
    size: 9,
    endpoints: [
      { color: "red",    from: [0, 2], to: [8, 6] },
      { color: "blue",   from: [0, 6], to: [8, 2] },
      { color: "green",  from: [2, 0], to: [6, 8] },
      { color: "yellow", from: [2, 8], to: [6, 0] },
      { color: "purple", from: [0, 0], to: [8, 8] },
      { color: "orange", from: [0, 8], to: [8, 0] },
      { color: "pink",   from: [4, 1], to: [4, 7] },
      { color: "cyan",   from: [1, 4], to: [7, 4] },
    ],
  },
];

const PUZZLES_BY_DIFF: Record<string, PuzzleDef[]> = {
  easy: EASY_PUZZLES,
  medium: MEDIUM_PUZZLES,
  hard: HARD_PUZZLES,
};

const SCORE_BY_DIFF: Record<string, number> = {
  easy: 500,
  medium: 750,
  hard: 1000,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function posKey(r: number, c: number): string {
  return `${r},${c}`;
}

function isAdjacent(
  [r1, c1]: [number, number],
  [r2, c2]: [number, number]
): boolean {
  return (
    (Math.abs(r1 - r2) === 1 && c1 === c2) ||
    (Math.abs(c1 - c2) === 1 && r1 === r2)
  );
}

// ─── State types ──────────────────────────────────────────────────────────────

type PathMap = Map<string, ColorName>; // posKey → color occupying that cell
type Paths = Record<ColorName, [number, number][]>;

function initPaths(endpoints: Endpoint[]): Paths {
  const paths: Partial<Paths> = {};
  for (const ep of endpoints) {
    paths[ep.color] = [];
  }
  return paths as Paths;
}

// Build the set of endpoint positions for quick lookup
function buildEndpointSet(
  endpoints: Endpoint[]
): Map<string, { color: ColorName; isFrom: boolean }> {
  const map = new Map<string, { color: ColorName; isFrom: boolean }>();
  for (const ep of endpoints) {
    map.set(posKey(...ep.from), { color: ep.color, isFrom: true });
    map.set(posKey(...ep.to), { color: ep.color, isFrom: false });
  }
  return map;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function PipeConnectGame({
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
  const { size, endpoints } = puzzle;

  const endpointSet = useRef(buildEndpointSet(endpoints)).current;

  // paths: per-color list of [r,c] cells in draw order (includes endpoints)
  const [paths, setPaths] = useState<Paths>(() => initPaths(endpoints));
  // activeColor: color currently being drawn
  const [activeColor, setActiveColor] = useState<ColorName | null>(null);
  const [done, setDone] = useState(false);

  // Whether mouse button is held (for drag-drawing)
  const mouseDownRef = useRef(false);

  useEffect(() => { pausedRef.current = paused; }, [paused]);
  useEffect(() => { onReady?.(); }, [onReady]);

  // Build a flat map: posKey → color (for fast lookup of which color owns a cell)
  const buildOccupancy = useCallback((ps: Paths): PathMap => {
    const map: PathMap = new Map();
    for (const [color, path] of Object.entries(ps) as [ColorName, [number, number][]][]) {
      for (const [r, c] of path) {
        map.set(posKey(r, c), color as ColorName);
      }
    }
    return map;
  }, []);

  // Check if a color's path connects its two endpoints
  const isColorConnected = useCallback(
    (color: ColorName, path: [number, number][]): boolean => {
      if (path.length < 2) return false;
      const ep = endpoints.find((e) => e.color === color)!;
      const first = path[0];
      const last = path[path.length - 1];
      const matchesFrom =
        (first[0] === ep.from[0] && first[1] === ep.from[1]) ||
        (last[0] === ep.from[0] && last[1] === ep.from[1]);
      const matchesTo =
        (first[0] === ep.to[0] && first[1] === ep.to[1]) ||
        (last[0] === ep.to[0] && last[1] === ep.to[1]);
      return matchesFrom && matchesTo;
    },
    [endpoints]
  );

  // Win check: all cells filled AND all pairs connected
  const checkWin = useCallback(
    (ps: Paths): boolean => {
      const occupancy = buildOccupancy(ps);
      if (occupancy.size !== size * size) return false;
      for (const ep of endpoints) {
        if (!isColorConnected(ep.color, ps[ep.color])) return false;
      }
      return true;
    },
    [buildOccupancy, size, endpoints, isColorConnected]
  );

  // Connected colors count for live score feedback
  const connectedCount = useCallback(
    (ps: Paths): number =>
      endpoints.filter((ep) => isColorConnected(ep.color, ps[ep.color])).length,
    [endpoints, isColorConnected]
  );

  // Start or continue a path at position [r, c]
  const handleCellInteract = useCallback(
    (r: number, c: number) => {
      if (pausedRef.current || doneRef.current) return;

      const key = posKey(r, c);
      const epInfo = endpointSet.get(key);

      setPaths((prev) => {
        const occupancy = buildOccupancy(prev);
        const occupyingColor = occupancy.get(key);

        // ── Case 1: Clicking an endpoint ───────────────────────────────────
        if (epInfo) {
          const color = epInfo.color;
          if (activeColor === color) {
            // Deselect
            setActiveColor(null);
            return prev;
          }
          // Start drawing from this endpoint: reset the path for this color
          setActiveColor(color);
          // The path starts with just this endpoint
          const newPaths = { ...prev, [color]: [[r, c]] as [number, number][] };
          // Clear any other color's path that occupied this cell (shouldn't
          // happen for endpoints, but guard anyway)
          return newPaths;
        }

        // ── Case 2: No active drawing ──────────────────────────────────────
        if (!activeColor) {
          // Clicking a filled path cell: restart that color's path from here
          if (occupyingColor) {
            const existingPath = prev[occupyingColor];
            const clickedIdx = existingPath.findIndex(
              ([pr, pc]) => pr === r && pc === c
            );
            if (clickedIdx >= 0) {
              const ep = endpoints.find((e) => e.color === occupyingColor)!;
              // Truncate path at this cell
              const truncated = existingPath.slice(0, clickedIdx + 1);
              // Check if the clicked cell is an endpoint — then we start fresh
              const isEp =
                (r === ep.from[0] && c === ep.from[1]) ||
                (r === ep.to[0] && c === ep.to[1]);
              if (isEp) {
                setActiveColor(occupyingColor);
                return { ...prev, [occupyingColor]: [[r, c]] as [number, number][] };
              }
              setActiveColor(occupyingColor);
              return { ...prev, [occupyingColor]: truncated };
            }
          }
          return prev;
        }

        // ── Case 3: Currently drawing ──────────────────────────────────────
        const currentPath = prev[activeColor];
        if (currentPath.length === 0) return prev;

        const lastCell = currentPath[currentPath.length - 1];

        // Must be adjacent to last drawn cell
        if (!isAdjacent(lastCell, [r, c])) return prev;

        // Check if we'd backtrack (clicking the second-to-last cell)
        if (currentPath.length >= 2) {
          const secondLast = currentPath[currentPath.length - 2];
          if (secondLast[0] === r && secondLast[1] === c) {
            // Backtrack: remove last cell
            play("move");
            return { ...prev, [activeColor]: currentPath.slice(0, -1) };
          }
        }

        // Check if this cell is already in OUR path (would create a loop)
        const selfIdx = currentPath.findIndex(([pr, pc]) => pr === r && pc === c);
        if (selfIdx >= 0) {
          // Truncate to that point
          play("move");
          return { ...prev, [activeColor]: currentPath.slice(0, selfIdx + 1) };
        }

        // Check if cell is occupied by ANOTHER color — clear that color's path
        let newPaths = { ...prev };
        if (occupyingColor && occupyingColor !== activeColor) {
          newPaths = { ...newPaths, [occupyingColor]: [] };
        }

        // Extend path
        const extended = [...currentPath, [r, c]] as [number, number][];
        newPaths = { ...newPaths, [activeColor]: extended };

        play("move");

        // Check if we just reached the endpoint of the active color
        const ep = endpoints.find((e) => e.color === activeColor)!;
        const justReachedEndpoint =
          (r === ep.from[0] && c === ep.from[1] && extended.length > 1) ||
          (r === ep.to[0] && c === ep.to[1] && extended.length > 1);

        if (justReachedEndpoint && isColorConnected(activeColor, extended)) {
          play("match");
          setActiveColor(null);
          // Check win
          if (checkWin(newPaths)) {
            doneRef.current = true;
            setTimeout(() => {
              setDone(true);
              play("win");
              const score = SCORE_BY_DIFF[difficulty] ?? 500;
              onScore?.(score);
              onGameOver(score);
            }, 150);
          } else {
            // Live score update
            const cc = connectedCount(newPaths);
            onScore?.(cc * Math.floor((SCORE_BY_DIFF[difficulty] ?? 500) / endpoints.length));
          }
        }

        return newPaths;
      });
    },
    [
      activeColor,
      endpointSet,
      buildOccupancy,
      endpoints,
      isColorConnected,
      checkWin,
      connectedCount,
      difficulty,
      play,
      onScore,
      onGameOver,
    ]
  );

  const handleMouseDown = useCallback(
    (r: number, c: number) => {
      mouseDownRef.current = true;
      handleCellInteract(r, c);
    },
    [handleCellInteract]
  );

  const handleMouseEnter = useCallback(
    (r: number, c: number) => {
      if (!mouseDownRef.current) return;
      if (!activeColor) return;
      handleCellInteract(r, c);
    },
    [activeColor, handleCellInteract]
  );

  useEffect(() => {
    const onMouseUp = () => { mouseDownRef.current = false; };
    window.addEventListener("mouseup", onMouseUp);
    return () => window.removeEventListener("mouseup", onMouseUp);
  }, []);

  // Derived: occupancy map for rendering
  const occupancy = buildOccupancy(paths);

  // Cell sizing
  const cellPx = size <= 5 ? 52 : size <= 7 ? 40 : 34;

  // Connected count for HUD
  const connected = connectedCount(paths);

  const totalCells = size * size;
  const filledCells = occupancy.size;

  return (
    <div className="flex flex-col items-center gap-3 select-none w-full max-w-sm mx-auto">
      {/* HUD */}
      <div className="flex w-full items-center justify-between text-sm px-1">
        <span className="text-muted-foreground">
          Pairs:{" "}
          <span className="text-foreground font-semibold">
            {connected}/{endpoints.length}
          </span>
        </span>
        {done ? (
          <span className="text-emerald-400 font-bold">Solved!</span>
        ) : (
          <span className="text-muted-foreground capitalize">{difficulty}</span>
        )}
        <span className="text-muted-foreground">
          Filled:{" "}
          <span className="text-foreground font-semibold">
            {filledCells}/{totalCells}
          </span>
        </span>
      </div>

      {/* Win banner */}
      {done && (
        <div className="w-full rounded-xl bg-emerald-950/40 border border-emerald-500/40 px-4 py-3 text-center">
          <p className="text-emerald-400 font-bold text-lg">Board Solved!</p>
          <p className="text-muted-foreground text-sm mt-0.5">
            Score: {SCORE_BY_DIFF[difficulty] ?? 500}
          </p>
        </div>
      )}

      {/* Grid */}
      <div
        className="grid border border-border/50 rounded-lg overflow-hidden"
        style={{
          gridTemplateColumns: `repeat(${size}, ${cellPx}px)`,
          gridTemplateRows: `repeat(${size}, ${cellPx}px)`,
        }}
        onMouseLeave={() => { mouseDownRef.current = false; }}
      >
        {Array.from({ length: size * size }, (_, idx) => {
          const r = Math.floor(idx / size);
          const c = idx % size;
          const key = posKey(r, c);
          const epInfo = endpointSet.get(key);
          const cellColor = occupancy.get(key) ?? null;
          const isEndpoint = !!epInfo;
          const isActive = cellColor === activeColor && activeColor !== null;

          // Determine pipe connections for this cell (for pipe rendering)
          const path = cellColor ? paths[cellColor] : null;
          let hasUp = false, hasDown = false, hasLeft = false, hasRight = false;
          if (path && path.length > 0) {
            const cellIdx = path.findIndex(([pr, pc]) => pr === r && pc === c);
            if (cellIdx >= 0) {
              if (cellIdx > 0) {
                const [pr, pc] = path[cellIdx - 1];
                if (pr === r - 1) hasUp = true;
                if (pr === r + 1) hasDown = true;
                if (pc === c - 1) hasLeft = true;
                if (pc === c + 1) hasRight = true;
              }
              if (cellIdx < path.length - 1) {
                const [nr, nc] = path[cellIdx + 1];
                if (nr === r - 1) hasUp = true;
                if (nr === r + 1) hasDown = true;
                if (nc === c - 1) hasLeft = true;
                if (nc === c + 1) hasRight = true;
              }
            }
          }

          const bgClass = cellColor
            ? COLOR_BG[cellColor]
            : "bg-card";
          const borderClass = isActive ? `ring-2 ${COLOR_RING[cellColor as ColorName]}` : "";

          return (
            <div
              key={idx}
              className={[
                "relative flex items-center justify-center cursor-pointer",
                "border border-border/20 transition-all duration-150",
                isActive ? "brightness-110" : "",
              ].join(" ")}
              style={{ width: cellPx, height: cellPx }}
              onMouseDown={() => handleMouseDown(r, c)}
              onMouseEnter={() => handleMouseEnter(r, c)}
            >
              {/* Pipe fill background */}
              {cellColor && !isEndpoint && (
                <>
                  {/* Center dot */}
                  <div
                    className={`absolute rounded-full z-10 ${COLOR_BG[cellColor]}`}
                    style={{
                      width: Math.round(cellPx * 0.38),
                      height: Math.round(cellPx * 0.38),
                    }}
                  />
                  {/* Horizontal pipe segment */}
                  {(hasLeft || hasRight) && (
                    <div
                      className={`absolute top-1/2 -translate-y-1/2 ${COLOR_BG[cellColor]}`}
                      style={{
                        left: hasLeft ? 0 : "50%",
                        right: hasRight ? 0 : "50%",
                        height: Math.round(cellPx * 0.38),
                      }}
                    />
                  )}
                  {/* Vertical pipe segment */}
                  {(hasUp || hasDown) && (
                    <div
                      className={`absolute left-1/2 -translate-x-1/2 ${COLOR_BG[cellColor]}`}
                      style={{
                        top: hasUp ? 0 : "50%",
                        bottom: hasDown ? 0 : "50%",
                        width: Math.round(cellPx * 0.38),
                      }}
                    />
                  )}
                </>
              )}

              {/* Endpoint circle */}
              {isEndpoint && (
                <div
                  className={[
                    "absolute rounded-full z-20 border-4",
                    epInfo ? COLOR_BG[epInfo.color] : "",
                    epInfo ? COLOR_BORDER[epInfo.color] : "",
                    borderClass,
                    isColorConnected(epInfo!.color, paths[epInfo!.color])
                      ? "opacity-100 scale-100"
                      : "opacity-90",
                    "transition-all duration-150",
                  ].join(" ")}
                  style={{
                    width: Math.round(cellPx * 0.62),
                    height: Math.round(cellPx * 0.62),
                  }}
                />
              )}

              {/* Pipe connection TO/FROM endpoint */}
              {isEndpoint && cellColor && (
                <>
                  {hasUp && (
                    <div
                      className={`absolute top-0 left-1/2 -translate-x-1/2 ${COLOR_BG[cellColor]} z-10`}
                      style={{ width: Math.round(cellPx * 0.38), height: "50%" }}
                    />
                  )}
                  {hasDown && (
                    <div
                      className={`absolute bottom-0 left-1/2 -translate-x-1/2 ${COLOR_BG[cellColor]} z-10`}
                      style={{ width: Math.round(cellPx * 0.38), height: "50%" }}
                    />
                  )}
                  {hasLeft && (
                    <div
                      className={`absolute top-1/2 left-0 -translate-y-1/2 ${COLOR_BG[cellColor]} z-10`}
                      style={{ width: "50%", height: Math.round(cellPx * 0.38) }}
                    />
                  )}
                  {hasRight && (
                    <div
                      className={`absolute top-1/2 right-0 -translate-y-1/2 ${COLOR_BG[cellColor]} z-10`}
                      style={{ width: "50%", height: Math.round(cellPx * 0.38) }}
                    />
                  )}
                </>
              )}

              {/* Empty cell hover hint */}
              {!cellColor && !isEndpoint && (
                <div className="w-1.5 h-1.5 rounded-full bg-border/30" />
              )}
            </div>
          );
        })}
      </div>

      <p className="text-xs text-muted-foreground text-center">
        Click/drag from a color dot to draw its path · Fill all cells to win
      </p>
    </div>
  );
}
