"use client";

/**
 * Connect Four vs AI.
 * Player = 🔴, AI = 🟡.
 * Easy: random. Medium: blocks 3-in-a-row. Hard: minimax depth 4.
 * Win=200, Draw=50, Lose=0.
 */

import { useEffect, useState, useRef, useCallback } from "react";
import type { GameEngineProps } from "@/components/games/types";
import { useGameSound } from "@/components/games/useGameSound";

const ROWS = 6;
const COLS = 7;
type Cell = 1 | 2 | null; // 1=player, 2=AI
type Board = Cell[][];

function emptyBoard(): Board {
  return Array.from({ length: ROWS }, () => Array(COLS).fill(null));
}

function dropDisc(board: Board, col: number, player: 1 | 2): { board: Board; row: number } | null {
  for (let r = ROWS - 1; r >= 0; r--) {
    if (!board[r][col]) {
      const nb = board.map((row) => [...row]) as Board;
      nb[r][col] = player;
      return { board: nb, row: r };
    }
  }
  return null;
}

function checkWin(board: Board, player: Cell): number[][] | null {
  const winCells: number[][] = [];
  // Horizontal
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c <= COLS - 4; c++) {
      if ([0,1,2,3].every((d) => board[r][c+d] === player)) {
        return [[r,c],[r,c+1],[r,c+2],[r,c+3]];
      }
    }
  }
  // Vertical
  for (let r = 0; r <= ROWS - 4; r++) {
    for (let c = 0; c < COLS; c++) {
      if ([0,1,2,3].every((d) => board[r+d][c] === player)) {
        return [[r,c],[r+1,c],[r+2,c],[r+3,c]];
      }
    }
  }
  // Diagonal /
  for (let r = 3; r < ROWS; r++) {
    for (let c = 0; c <= COLS - 4; c++) {
      if ([0,1,2,3].every((d) => board[r-d][c+d] === player)) {
        return [[r,c],[r-1,c+1],[r-2,c+2],[r-3,c+3]];
      }
    }
  }
  // Diagonal \
  for (let r = 0; r <= ROWS - 4; r++) {
    for (let c = 0; c <= COLS - 4; c++) {
      if ([0,1,2,3].every((d) => board[r+d][c+d] === player)) {
        return [[r,c],[r+1,c+1],[r+2,c+2],[r+3,c+3]];
      }
    }
  }
  return null;
}

function isFull(board: Board): boolean {
  return board[0].every((c) => c !== null);
}

function getAvailableCols(board: Board): number[] {
  return Array.from({ length: COLS }, (_, i) => i).filter((c) => !board[0][c]);
}

function scoreWindow(window: Cell[], player: Cell): number {
  const opp = player === 1 ? 2 : 1;
  const pCount = window.filter((c) => c === player).length;
  const oCount = window.filter((c) => c === opp).length;
  const empty = window.filter((c) => c === null).length;
  if (pCount === 4) return 100;
  if (pCount === 3 && empty === 1) return 5;
  if (pCount === 2 && empty === 2) return 2;
  if (oCount === 3 && empty === 1) return -4;
  return 0;
}

function heuristicScore(board: Board, player: Cell): number {
  let s = 0;
  // Center column
  const center = board.map((r) => r[Math.floor(COLS/2)]);
  s += center.filter((c) => c === player).length * 3;
  // Horizontal windows
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c <= COLS-4; c++) {
      s += scoreWindow([board[r][c],board[r][c+1],board[r][c+2],board[r][c+3]], player);
    }
  }
  // Vertical
  for (let r = 0; r <= ROWS-4; r++) {
    for (let c = 0; c < COLS; c++) {
      s += scoreWindow([board[r][c],board[r+1][c],board[r+2][c],board[r+3][c]], player);
    }
  }
  return s;
}

function minimax(board: Board, depth: number, alpha: number, beta: number, maximizing: boolean): number {
  if (checkWin(board, 2)) return 1000 + depth;
  if (checkWin(board, 1)) return -(1000 + depth);
  if (isFull(board) || depth === 0) return heuristicScore(board, 2);
  const cols = getAvailableCols(board);
  if (maximizing) {
    let v = -Infinity;
    for (const c of cols) {
      const result = dropDisc(board, c, 2);
      if (!result) continue;
      v = Math.max(v, minimax(result.board, depth-1, alpha, beta, false));
      alpha = Math.max(alpha, v);
      if (alpha >= beta) break;
    }
    return v;
  } else {
    let v = Infinity;
    for (const c of cols) {
      const result = dropDisc(board, c, 1);
      if (!result) continue;
      v = Math.min(v, minimax(result.board, depth-1, alpha, beta, true));
      beta = Math.min(beta, v);
      if (alpha >= beta) break;
    }
    return v;
  }
}

function getAIMove(board: Board, difficulty: string): number {
  const cols = getAvailableCols(board);
  if (!cols.length) return -1;
  if (difficulty === "easy") return cols[Math.floor(Math.random() * cols.length)];
  if (difficulty === "medium") {
    // Win if possible
    for (const c of cols) {
      const r = dropDisc(board, c, 2);
      if (r && checkWin(r.board, 2)) return c;
    }
    // Block player win
    for (const c of cols) {
      const r = dropDisc(board, c, 1);
      if (r && checkWin(r.board, 1)) return c;
    }
    // Block 3-in-a-row
    return cols[Math.floor(Math.random() * cols.length)];
  }
  // Hard: minimax depth 4
  let best = -Infinity;
  let bestCol = cols[Math.floor(Math.random() * cols.length)];
  for (const c of cols) {
    const r = dropDisc(board, c, 2);
    if (!r) continue;
    const v = minimax(r.board, 4, -Infinity, Infinity, false);
    if (v > best) { best = v; bestCol = c; }
  }
  return bestCol;
}

interface DiscProps { player: Cell; isWin: boolean; isNew: boolean }

function Disc({ player, isWin, isNew }: DiscProps) {
  if (!player) {
    return <div className="w-full aspect-square rounded-full bg-neutral-900 border border-neutral-800" />;
  }
  return (
    <div className={`w-full aspect-square rounded-full border-2 transition-all duration-300 ${
      isWin ? "scale-110 shadow-lg" : ""
    } ${
      player === 1
        ? `bg-red-500 border-red-400 ${isNew ? "animate-bounce" : ""}`
        : `bg-yellow-400 border-yellow-300 ${isNew ? "animate-bounce" : ""}`
    }`} />
  );
}

export default function ConnectFourGame({
  onReady, onGameOver, onScore, difficulty = "medium", paused, soundEnabled = true,
}: GameEngineProps) {
  const diff = difficulty ?? "medium";
  const [board, setBoard] = useState<Board>(emptyBoard);
  const [isPlayerTurn, setIsPlayerTurn] = useState(true);
  const [winCells, setWinCells] = useState<number[][] | null>(null);
  const [done, setDone] = useState(false);
  const [result, setResult] = useState<"win" | "lose" | "draw" | null>(null);
  const [lastDrop, setLastDrop] = useState<[number, number] | null>(null);
  const [hoveredCol, setHoveredCol] = useState<number | null>(null);
  const doneRef = useRef(false);
  const pausedRef = useRef(paused);
  const play = useGameSound(soundEnabled ?? true);

  useEffect(() => { pausedRef.current = paused; }, [paused]);
  useEffect(() => { onReady?.(); }, [onReady]);

  const finishGame = useCallback((outcome: "win" | "lose" | "draw", boardState: Board) => {
    doneRef.current = true;
    setDone(true);
    setIsPlayerTurn(false);
    const score = outcome === "win" ? 200 : outcome === "draw" ? 50 : 0;
    if (outcome === "win") play("win");
    else if (outcome === "lose") play("lose");
    else play("score");
    onScore?.(score);
    onGameOver(score);
    setResult(outcome);
  }, [play, onScore, onGameOver]);

  const doAIMove = useCallback((currentBoard: Board) => {
    if (doneRef.current) return;
    const col = getAIMove(currentBoard, diff);
    if (col === -1) return;
    const result = dropDisc(currentBoard, col, 2);
    if (!result) return;
    play("drop");
    setBoard(result.board);
    setLastDrop([result.row, col]);
    setIsPlayerTurn(true);

    const win = checkWin(result.board, 2);
    if (win) { setWinCells(win); finishGame("lose", result.board); return; }
    if (isFull(result.board)) { finishGame("draw", result.board); return; }
  }, [diff, play, finishGame]);

  const handleColumnClick = useCallback((col: number) => {
    if (pausedRef.current || !isPlayerTurn || done || board[0][col]) return;
    const result = dropDisc(board, col, 1);
    if (!result) return;
    play("drop");
    setBoard(result.board);
    setLastDrop([result.row, col]);
    setIsPlayerTurn(false);

    const win = checkWin(result.board, 1);
    if (win) { setWinCells(win); finishGame("win", result.board); return; }
    if (isFull(result.board)) { finishGame("draw", result.board); return; }

    // AI move after delay
    setTimeout(() => doAIMove(result.board), 500);
  }, [board, isPlayerTurn, done, play, finishGame, doAIMove]);

  const isWinCell = (r: number, c: number) =>
    winCells?.some(([wr, wc]) => wr === r && wc === c) ?? false;

  const isNewDisc = (r: number, c: number) =>
    lastDrop !== null && lastDrop[0] === r && lastDrop[1] === c;

  return (
    <div className="flex flex-col items-center gap-3 select-none w-full max-w-sm mx-auto">
      {/* Header */}
      <div className="flex w-full items-center justify-between text-sm px-1">
        <span className="flex items-center gap-1 text-muted-foreground">
          <span className="text-red-500">🔴 You</span>
        </span>
        {result ? (
          <span className={`font-bold ${result === "win" ? "text-emerald-400" : result === "lose" ? "text-red-400" : "text-amber-400"}`}>
            {result === "win" ? "🎉 You win! +200" : result === "lose" ? "💀 AI wins" : "🤝 Draw! +50"}
          </span>
        ) : (
          <span className={`text-xs font-semibold px-2 py-1 rounded-full ${
            isPlayerTurn ? "bg-red-500/20 text-red-400" : "bg-yellow-500/20 text-yellow-400"
          }`}>
            {isPlayerTurn ? "Your turn" : "AI thinking..."}
          </span>
        )}
        <span className="flex items-center gap-1 text-muted-foreground">
          <span className="text-yellow-400">AI 🟡</span>
        </span>
      </div>

      {/* Column drop buttons */}
      <div className="grid gap-0.5 w-full" style={{ gridTemplateColumns: `repeat(${COLS}, 1fr)` }}>
        {Array.from({ length: COLS }, (_, c) => (
          <button
            key={c}
            type="button"
            onClick={() => handleColumnClick(c)}
            onMouseEnter={() => setHoveredCol(c)}
            onMouseLeave={() => setHoveredCol(null)}
            disabled={!isPlayerTurn || done || !!board[0][c]}
            className={`h-7 rounded-t-lg text-sm transition-all flex items-center justify-center ${
              hoveredCol === c && isPlayerTurn && !done && !board[0][c]
                ? "bg-red-500/30 text-red-400"
                : "bg-transparent text-transparent"
            } disabled:cursor-default`}
          >
            ▼
          </button>
        ))}
      </div>

      {/* Board */}
      <div className="w-full rounded-xl bg-blue-900/40 border-2 border-blue-800/50 p-2">
        <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${COLS}, 1fr)` }}>
          {board.map((row, r) =>
            row.map((cell, c) => (
              <Disc
                key={`${r}-${c}`}
                player={cell}
                isWin={isWinCell(r, c)}
                isNew={isNewDisc(r, c)}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
