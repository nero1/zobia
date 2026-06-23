"use client";

/**
 * Dots and Boxes — draw lines between dots, complete a box to score.
 * Player vs AI. Completing a box claims it and grants another turn.
 */

import { useEffect, useState, useCallback, useRef } from "react";
import type { GameEngineProps } from "@/components/games/types";
import { useGameSound } from "@/components/games/useGameSound";

// Grid config: dots = (n+1)×(n+1), boxes = n×n
const GRID_CFG = {
  easy:   { dots: 4 }, // 3×3 boxes
  medium: { dots: 5 }, // 4×4 boxes
  hard:   { dots: 6 }, // 5×5 boxes
};

type Owner = "player" | "ai" | null;

interface GameState {
  hLines: boolean[][];  // hLines[r][c] = horizontal line between dot(r,c) and dot(r,c+1)
  vLines: boolean[][];  // vLines[r][c] = vertical line between dot(r,c) and dot(r+1,c)
  boxes: Owner[][];     // boxes[r][c]
  turn: "player" | "ai";
  playerBoxes: number;
  aiBoxes: number;
  done: boolean;
}

function initState(dots: number): GameState {
  const n = dots - 1; // boxes per side
  return {
    hLines: Array.from({ length: dots }, () => Array(n).fill(false)),
    vLines: Array.from({ length: n }, () => Array(dots).fill(false)),
    boxes: Array.from({ length: n }, () => Array(n).fill(null)),
    turn: "player",
    playerBoxes: 0,
    aiBoxes: 0,
    done: false,
  };
}

function checkBoxes(state: GameState, dots: number): { newBoxes: number; nextState: GameState } {
  const n = dots - 1;
  const boxes = state.boxes.map((row) => [...row]);
  let newBoxes = 0;
  const owner = state.turn;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (boxes[r][c] === null) {
        const top    = state.hLines[r][c];
        const bottom = state.hLines[r + 1][c];
        const left   = state.vLines[r][c];
        const right  = state.vLines[r][c + 1];
        if (top && bottom && left && right) {
          boxes[r][c] = owner;
          newBoxes++;
        }
      }
    }
  }
  const playerBoxes = state.playerBoxes + (owner === "player" ? newBoxes : 0);
  const aiBoxes     = state.aiBoxes     + (owner === "ai"     ? newBoxes : 0);
  return {
    newBoxes,
    nextState: { ...state, boxes, playerBoxes, aiBoxes },
  };
}

function countSidesForBox(state: GameState, r: number, c: number): number {
  return (
    (state.hLines[r][c]     ? 1 : 0) +
    (state.hLines[r + 1][c] ? 1 : 0) +
    (state.vLines[r][c]     ? 1 : 0) +
    (state.vLines[r][c + 1] ? 1 : 0)
  );
}

function allLines(dots: number) {
  const n = dots - 1;
  const lines: Array<{ type: "h" | "v"; r: number; c: number }> = [];
  for (let r = 0; r < dots; r++) for (let c = 0; c < n; c++) lines.push({ type: "h", r, c });
  for (let r = 0; r < n; r++) for (let c = 0; c < dots; c++) lines.push({ type: "v", r, c });
  return lines;
}

function aiPickLine(state: GameState, dots: number, difficulty: string) {
  const n = dots - 1;
  const available = allLines(dots).filter(({ type, r, c }) =>
    type === "h" ? !state.hLines[r][c] : !state.vLines[r][c]
  );
  if (available.length === 0) return null;

  if (difficulty === "easy") {
    return available[Math.floor(Math.random() * available.length)];
  }

  // Medium/Hard: complete any 3-sided box first
  for (const line of available) {
    const tempH = state.hLines.map((row) => [...row]);
    const tempV = state.vLines.map((row) => [...row]);
    if (line.type === "h") tempH[line.r][line.c] = true;
    else tempV[line.r][line.c] = true;
    const tempState = { ...state, hLines: tempH, vLines: tempV };
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (tempState.boxes[r][c] === null && countSidesForBox(tempState, r, c) === 4) {
          return line;
        }
      }
    }
  }

  if (difficulty === "hard") {
    // Avoid giving opponent a 3-sided box
    const safe = available.filter((line) => {
      const tempH = state.hLines.map((row) => [...row]);
      const tempV = state.vLines.map((row) => [...row]);
      if (line.type === "h") tempH[line.r][line.c] = true;
      else tempV[line.r][line.c] = true;
      const tempState = { ...state, hLines: tempH, vLines: tempV };
      for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
          if (tempState.boxes[r][c] === null && countSidesForBox(tempState, r, c) === 3) {
            return false;
          }
        }
      }
      return true;
    });
    const pool = safe.length > 0 ? safe : available;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  return available[Math.floor(Math.random() * available.length)];
}

export default function DotsAndBoxesGame({
  onReady, onGameOver, onScore, difficulty = "medium", paused, soundEnabled = true,
}: GameEngineProps) {
  const { dots } = GRID_CFG[difficulty] ?? GRID_CFG.medium;
  const n = dots - 1;

  const [state, setState] = useState<GameState>(() => initState(dots));
  const [flash, setFlash] = useState<string | null>(null);

  const play = useGameSound(soundEnabled ?? true);
  const pausedRef = useRef(paused);
  const overRef = useRef(false);
  const aiTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { pausedRef.current = paused; }, [paused]);
  useEffect(() => { onReady?.(); }, [onReady]);

  const endGame = useCallback(
    (s: GameState) => {
      if (overRef.current) return;
      overRef.current = true;
      const finalScore = s.playerBoxes * 50;
      onScore?.(finalScore);
      if (s.playerBoxes > s.aiBoxes) play("win");
      else play("lose");
      onGameOver(finalScore);
    },
    [onGameOver, onScore, play]
  );

  const applyLine = useCallback(
    (s: GameState, type: "h" | "v", r: number, c: number, actor: "player" | "ai"): GameState => {
      const newH = s.hLines.map((row) => [...row]);
      const newV = s.vLines.map((row) => [...row]);
      if (type === "h") newH[r][c] = true;
      else newV[r][c] = true;
      const next: GameState = { ...s, hLines: newH, vLines: newV, turn: actor };
      const { newBoxes, nextState } = checkBoxes(next, dots);
      if (newBoxes > 0) {
        play("score");
        onScore?.(nextState.playerBoxes * 50);
      } else {
        play("move");
      }
      // same turn if got a box, else switch
      const nextTurn = newBoxes > 0 ? actor : (actor === "player" ? "ai" : "player");
      return { ...nextState, turn: nextTurn };
    },
    [dots, onScore, play]
  );

  const checkDone = useCallback(
    (s: GameState): boolean => {
      // done when all boxes claimed
      const total = n * n;
      if (s.playerBoxes + s.aiBoxes >= total) {
        endGame(s);
        return true;
      }
      return false;
    },
    [n, endGame]
  );

  // AI turn
  useEffect(() => {
    if (state.turn !== "ai" || state.done || overRef.current) return;
    if (pausedRef.current) return;

    const delay = difficulty === "easy" ? 600 : difficulty === "medium" ? 500 : 400;
    aiTimerRef.current = setTimeout(() => {
      if (pausedRef.current || overRef.current) return;
      const line = aiPickLine(state, dots, difficulty);
      if (!line) return;
      setState((prev) => {
        const next = applyLine(prev, line.type, line.r, line.c, "ai");
        if (checkDone(next)) return { ...next, done: true };
        return next;
      });
    }, delay);
    return () => { if (aiTimerRef.current) clearTimeout(aiTimerRef.current); };
  }, [state, dots, difficulty, applyLine, checkDone]);

  const handleHLine = useCallback(
    (r: number, c: number) => {
      if (pausedRef.current || overRef.current || state.turn !== "player" || state.done) return;
      if (state.hLines[r][c]) return;
      setFlash(`h-${r}-${c}`);
      setTimeout(() => setFlash(null), 300);
      setState((prev) => {
        const next = applyLine(prev, "h", r, c, "player");
        if (checkDone(next)) return { ...next, done: true };
        return next;
      });
    },
    [state, applyLine, checkDone]
  );

  const handleVLine = useCallback(
    (r: number, c: number) => {
      if (pausedRef.current || overRef.current || state.turn !== "player" || state.done) return;
      if (state.vLines[r][c]) return;
      setFlash(`v-${r}-${c}`);
      setTimeout(() => setFlash(null), 300);
      setState((prev) => {
        const next = applyLine(prev, "v", r, c, "player");
        if (checkDone(next)) return { ...next, done: true };
        return next;
      });
    },
    [state, applyLine, checkDone]
  );

  const DOT_SIZE = 10;
  const CELL = Math.floor(260 / n); // px per cell

  return (
    <div className="flex flex-col items-center gap-3 select-none w-full max-w-sm mx-auto">
      {/* Scores */}
      <div className="flex w-full justify-between items-center px-2">
        <div className="flex flex-col items-center">
          <span className="text-blue-400 font-bold text-lg">{state.playerBoxes}</span>
          <span className="text-xs text-muted-foreground">You 🔵</span>
        </div>
        <span className="text-muted-foreground text-sm">
          {state.done ? "Game Over!" : state.turn === "player" ? "Your turn" : "AI thinking..."}
        </span>
        <div className="flex flex-col items-center">
          <span className="text-red-400 font-bold text-lg">{state.aiBoxes}</span>
          <span className="text-xs text-muted-foreground">AI 🔴</span>
        </div>
      </div>

      {/* Board */}
      <div
        className="relative bg-card border border-border rounded-xl p-3"
        style={{ width: CELL * n + DOT_SIZE * 2 + 24, height: CELL * n + DOT_SIZE * 2 + 24 }}
      >
        <svg
          width={CELL * n + DOT_SIZE}
          height={CELL * n + DOT_SIZE}
          className="overflow-visible"
        >
          {/* Boxes (fill when owned) */}
          {state.boxes.map((row, r) =>
            row.map((owner, c) =>
              owner ? (
                <rect
                  key={`box-${r}-${c}`}
                  x={c * CELL + DOT_SIZE / 2}
                  y={r * CELL + DOT_SIZE / 2}
                  width={CELL}
                  height={CELL}
                  fill={owner === "player" ? "rgba(59,130,246,0.3)" : "rgba(239,68,68,0.3)"}
                />
              ) : null
            )
          )}

          {/* Horizontal lines */}
          {state.hLines.map((row, r) =>
            row.map((drawn, c) => {
              const fk = `h-${r}-${c}`;
              return (
                <line
                  key={fk}
                  x1={c * CELL + DOT_SIZE}
                  y1={r * CELL + DOT_SIZE / 2}
                  x2={(c + 1) * CELL}
                  y2={r * CELL + DOT_SIZE / 2}
                  stroke={drawn ? (flash === fk ? "#facc15" : "#6366f1") : "transparent"}
                  strokeWidth={drawn ? 3 : 10}
                  strokeLinecap="round"
                  className={!drawn && state.turn === "player" && !state.done ? "cursor-pointer" : ""}
                  onClick={() => !drawn && handleHLine(r, c)}
                >
                  {!drawn && (
                    <title>Draw line</title>
                  )}
                </line>
              );
            })
          )}

          {/* Horizontal line hit areas (wider clickable zone) */}
          {state.hLines.map((row, r) =>
            row.map((drawn, c) =>
              !drawn ? (
                <rect
                  key={`hh-${r}-${c}`}
                  x={c * CELL + DOT_SIZE}
                  y={r * CELL + DOT_SIZE / 2 - 6}
                  width={CELL - DOT_SIZE}
                  height={12}
                  fill="transparent"
                  className={state.turn === "player" && !state.done ? "cursor-pointer hover:fill-blue-500/20" : ""}
                  onClick={() => handleHLine(r, c)}
                />
              ) : null
            )
          )}

          {/* Vertical lines */}
          {state.vLines.map((row, r) =>
            row.map((drawn, c) => {
              const fk = `v-${r}-${c}`;
              return (
                <line
                  key={fk}
                  x1={c * CELL + DOT_SIZE / 2}
                  y1={r * CELL + DOT_SIZE}
                  x2={c * CELL + DOT_SIZE / 2}
                  y2={(r + 1) * CELL}
                  stroke={drawn ? (flash === fk ? "#facc15" : "#6366f1") : "transparent"}
                  strokeWidth={drawn ? 3 : 10}
                  strokeLinecap="round"
                />
              );
            })
          )}

          {/* Vertical line hit areas */}
          {state.vLines.map((row, r) =>
            row.map((drawn, c) =>
              !drawn ? (
                <rect
                  key={`vh-${r}-${c}`}
                  x={c * CELL + DOT_SIZE / 2 - 6}
                  y={r * CELL + DOT_SIZE}
                  width={12}
                  height={CELL - DOT_SIZE}
                  fill="transparent"
                  className={state.turn === "player" && !state.done ? "cursor-pointer hover:fill-blue-500/20" : ""}
                  onClick={() => handleVLine(r, c)}
                />
              ) : null
            )
          )}

          {/* Box ownership labels */}
          {state.boxes.map((row, r) =>
            row.map((owner, c) =>
              owner ? (
                <text
                  key={`lbl-${r}-${c}`}
                  x={c * CELL + CELL / 2 + DOT_SIZE / 2}
                  y={r * CELL + CELL / 2 + DOT_SIZE / 2 + 5}
                  textAnchor="middle"
                  fontSize={CELL > 50 ? 16 : 12}
                  fill={owner === "player" ? "#60a5fa" : "#f87171"}
                >
                  {owner === "player" ? "●" : "●"}
                </text>
              ) : null
            )
          )}

          {/* Dots */}
          {Array.from({ length: dots }, (_, r) =>
            Array.from({ length: dots }, (_, c) => (
              <circle
                key={`dot-${r}-${c}`}
                cx={c * CELL + DOT_SIZE / 2}
                cy={r * CELL + DOT_SIZE / 2}
                r={DOT_SIZE / 2}
                fill="#e2e8f0"
              />
            ))
          )}
        </svg>
      </div>

      {state.done && (
        <div className="flex flex-col items-center gap-1">
          <span className="text-4xl animate-bounce">{state.playerBoxes > state.aiBoxes ? "🎉" : state.playerBoxes === state.aiBoxes ? "🤝" : "😔"}</span>
          <span className={`font-bold text-lg ${state.playerBoxes > state.aiBoxes ? "text-emerald-400" : state.playerBoxes === state.aiBoxes ? "text-yellow-400" : "text-red-400"}`}>
            {state.playerBoxes > state.aiBoxes ? "You Win!" : state.playerBoxes === state.aiBoxes ? "Draw!" : "AI Wins"}
          </span>
          <span className="text-muted-foreground text-sm">Score: {state.playerBoxes * 50}</span>
        </div>
      )}
    </div>
  );
}
