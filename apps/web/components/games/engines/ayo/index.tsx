"use client";

/**
 * Ayo (Nigerian Mancala/Oware) — 2-row 6-pit board vs AI.
 * Player pits: bottom row (indices 0-5). AI pits: top row (indices 0-5).
 * Distribute counter-clockwise. Capture on 2 or 3 seeds in opponent pit.
 * Score = player's captured seeds.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import type { GameEngineProps } from "@/components/games/types";
import { useGameSound } from "@/components/games/useGameSound";

const AI_DELAY: Record<string, number> = { easy: 1200, medium: 500, hard: 200 };

type Board = {
  playerPits: number[]; // 6 pits
  aiPits: number[]; // 6 pits
  playerStore: number;
  aiStore: number;
};

function initBoard(): Board {
  return {
    playerPits: [4, 4, 4, 4, 4, 4],
    aiPits: [4, 4, 4, 4, 4, 4],
    playerStore: 0,
    aiStore: 0,
  };
}

/**
 * Distribute seeds from a pit.
 * side: "player" | "ai", pitIdx: 0-5
 * Returns new board state.
 */
function distribute(board: Board, side: "player" | "ai", pitIdx: number): Board {
  const b: Board = {
    playerPits: [...board.playerPits],
    aiPits: [...board.aiPits],
    playerStore: board.playerStore,
    aiStore: board.aiStore,
  };

  let seeds = side === "player" ? b.playerPits[pitIdx] : b.aiPits[pitIdx];
  if (seeds === 0) return board;

  if (side === "player") b.playerPits[pitIdx] = 0;
  else b.aiPits[pitIdx] = 0;

  // Build distribution order counter-clockwise:
  // Player side: pits 0-5 left-to-right (index 0=left, 5=right)
  // AI side: pits 5-0 left-to-right (so counter-clockwise means ai pit 0 -> ai pit 1... -> ai pit 5 -> player pit 5 -> player pit 4...)
  // Counter-clockwise sequence from player side:
  // player[pitIdx+1..5], ai[0..5], player[0..pitIdx-1] (skip opponent store, no store for player in counter-clockwise)
  // Actually: counter-clockwise on a standard mancala board:
  //   From player pit i, go right along player pits, then up-left along AI pits
  //   Order: player: i+1, i+2... 5, then ai: 0,1,2,3,4,5, then player: 0..i-1
  //   Skip: opponent's store (AI store = left side for AI). Player sows into player store going right.
  //   Player store is at the right end of player row; AI store at left end of AI row.

  // Sequence of cells (as [side, idx]):
  type Cell = ["player" | "ai", number] | ["playerStore" | "aiStore", 0];
  const seq: Cell[] = [];
  if (side === "player") {
    for (let i = pitIdx + 1; i <= 5; i++) seq.push(["player", i]);
    seq.push(["playerStore", 0]);
    for (let i = 5; i >= 0; i--) seq.push(["ai", i]);
    // ai store skipped
    for (let i = 0; i < pitIdx; i++) seq.push(["player", i]);
  } else {
    for (let i = pitIdx + 1; i <= 5; i++) seq.push(["ai", i]);
    seq.push(["aiStore", 0]);
    for (let i = 0; i <= 5; i++) seq.push(["player", i]);
    // player store skipped
    for (let i = 0; i < pitIdx; i++) seq.push(["ai", i]);
  }

  let pos = 0;
  while (seeds > 0) {
    const cell = seq[pos % seq.length];
    if (cell[0] === "playerStore") b.playerStore++;
    else if (cell[0] === "aiStore") b.aiStore++;
    else if (cell[0] === "player") b.playerPits[cell[1] as number]++;
    else b.aiPits[cell[1] as number]++;
    seeds--;
    pos++;
  }

  // Capture: check last cell
  const lastCell = seq[(pos - 1) % seq.length];
  if (lastCell[0] !== "playerStore" && lastCell[0] !== "aiStore") {
    const lastSide = lastCell[0] as "player" | "ai";
    const lastIdx = lastCell[1] as number;
    // Capture if last seed landed in opponent's pit with 2 or 3 seeds
    const opponentSide = side === "player" ? "ai" : "player";
    if (lastSide === opponentSide) {
      const pits = lastSide === "player" ? b.playerPits : b.aiPits;
      // Capture backwards
      let capIdx = lastIdx;
      while (capIdx >= 0 && (pits[capIdx] === 2 || pits[capIdx] === 3)) {
        if (side === "player") {
          b.playerStore += pits[capIdx];
        } else {
          b.aiStore += pits[capIdx];
        }
        pits[capIdx] = 0;
        capIdx--;
      }
    }
  }

  return b;
}

function canMove(board: Board, side: "player" | "ai"): boolean {
  const pits = side === "player" ? board.playerPits : board.aiPits;
  return pits.some((p) => p > 0);
}

function aiPickPit(board: Board, difficulty: string): number {
  const pits = board.aiPits;
  const valid = pits.map((p, i) => (p > 0 ? i : -1)).filter((i) => i >= 0);
  if (valid.length === 0) return -1;

  if (difficulty === "hard") {
    // Look ahead: pick best capturing move
    let bestScore = -Infinity;
    let bestIdx = valid[0];
    for (const idx of valid) {
      const newBoard = distribute(board, "ai", idx);
      const gain = newBoard.aiStore - board.aiStore;
      if (gain > bestScore) {
        bestScore = gain;
        bestIdx = idx;
      }
    }
    return bestIdx;
  }

  // Greedy: pick pit with most seeds
  let maxSeeds = -1;
  let bestIdx = valid[0];
  for (const idx of valid) {
    if (pits[idx] > maxSeeds) {
      maxSeeds = pits[idx];
      bestIdx = idx;
    }
  }
  return bestIdx;
}

export default function AyoGame({
  onReady,
  onGameOver,
  onScore,
  difficulty = "medium",
  paused,
  soundEnabled = true,
}: GameEngineProps) {
  const play = useGameSound(soundEnabled ?? true);
  const pausedRef = useRef(paused);
  useEffect(() => { pausedRef.current = paused; }, [paused]);
  useEffect(() => { onReady?.(); }, [onReady]);

  const [board, setBoard] = useState<Board>(initBoard());
  const [turn, setTurn] = useState<"player" | "ai">("player");
  const [over, setOver] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");

  const overRef = useRef(false);
  const boardRef = useRef(board);
  boardRef.current = board;

  const aiDelay = AI_DELAY[difficulty] ?? 500;

  const endGame = useCallback((finalBoard: Board) => {
    if (overRef.current) return;
    overRef.current = true;
    setOver(true);
    // Collect remaining seeds
    const fb: Board = {
      ...finalBoard,
      playerStore: finalBoard.playerStore + finalBoard.playerPits.reduce((a, b) => a + b, 0),
      aiStore: finalBoard.aiStore + finalBoard.aiPits.reduce((a, b) => a + b, 0),
      playerPits: [0, 0, 0, 0, 0, 0],
      aiPits: [0, 0, 0, 0, 0, 0],
    };
    setBoard(fb);
    const playerScore = fb.playerStore;
    onScore?.(playerScore);
    if (playerScore > fb.aiStore) {
      play("win");
      setStatusMsg(`You win! ${playerScore} vs ${fb.aiStore}`);
    } else if (playerScore < fb.aiStore) {
      play("lose");
      setStatusMsg(`AI wins! ${playerScore} vs ${fb.aiStore}`);
    } else {
      play("win");
      setStatusMsg(`Draw! ${playerScore} each`);
    }
    onGameOver(playerScore);
  }, [onGameOver, onScore, play]);

  const checkEnd = useCallback((b: Board) => {
    if (b.playerStore >= 25 || b.aiStore >= 25) { endGame(b); return true; }
    if (!canMove(b, "player") || !canMove(b, "ai")) { endGame(b); return true; }
    return false;
  }, [endGame]);

  // AI turn
  useEffect(() => {
    if (over || turn !== "ai" || pausedRef.current) return;
    const tid = setTimeout(() => {
      if (overRef.current || pausedRef.current) return;
      const idx = aiPickPit(boardRef.current, difficulty);
      if (idx === -1) { endGame(boardRef.current); return; }
      play("drop");
      const newBoard = distribute(boardRef.current, "ai", idx);
      setBoard(newBoard);
      onScore?.(newBoard.playerStore);
      if (!checkEnd(newBoard)) {
        setTurn("player");
      }
    }, aiDelay);
    return () => clearTimeout(tid);
  }, [turn, over, aiDelay, difficulty, endGame, checkEnd, onScore, play]);

  const playerMove = useCallback((pitIdx: number) => {
    if (over || turn !== "player" || pausedRef.current) return;
    const b = boardRef.current;
    if (b.playerPits[pitIdx] === 0) return;
    play("drop");
    const newBoard = distribute(b, "player", pitIdx);
    setBoard(newBoard);
    onScore?.(newBoard.playerStore);
    if (!checkEnd(newBoard)) {
      setTurn("ai");
    }
  }, [over, turn, checkEnd, onScore, play]);

  const renderSeeds = (count: number) => {
    if (count === 0) return <span className="text-amber-600 text-xs">·</span>;
    if (count <= 8) return (
      <div className="flex flex-wrap justify-center gap-0.5">
        {Array.from({ length: count }).map((_, i) => (
          <div key={i} className="w-2 h-2 rounded-full bg-amber-200" />
        ))}
      </div>
    );
    return <span className="text-amber-100 font-bold text-sm">{count}</span>;
  };

  return (
    <div className="flex flex-col items-center gap-3 select-none w-full max-w-sm mx-auto">
      <div className="flex w-full items-center justify-between px-2 text-sm font-semibold">
        <span className="text-emerald-400">You: {board.playerStore}</span>
        <span className={turn === "ai" && !over ? "text-amber-400 animate-pulse" : "text-muted-foreground"}>
          {over ? statusMsg : turn === "ai" ? "AI thinking..." : "Your turn"}
        </span>
        <span className="text-muted-foreground">AI: {board.aiStore}</span>
      </div>

      <div className="w-full rounded-2xl border-2 border-amber-800 bg-amber-900 p-3">
        {/* AI pits (top row, displayed right-to-left = 5..0) */}
        <div className="text-center text-xs text-amber-300 mb-1">AI</div>
        <div className="flex gap-2 justify-center mb-2">
          <div className="flex items-center justify-center w-10 h-14 rounded-full bg-amber-800 border border-amber-700">
            <div className="text-center">
              <div className="text-xs text-amber-400">AI</div>
              <div className="text-amber-100 font-bold text-sm">{board.aiStore}</div>
            </div>
          </div>
          {[5, 4, 3, 2, 1, 0].map((i) => (
            <div
              key={i}
              className="flex flex-col items-center justify-center w-10 h-14 rounded-full bg-amber-950 border border-amber-700"
            >
              {renderSeeds(board.aiPits[i])}
            </div>
          ))}
          <div className="flex items-center justify-center w-10 h-14 rounded-full bg-amber-800 border border-amber-700">
            <div className="text-center">
              <div className="text-xs text-emerald-400">You</div>
              <div className="text-emerald-400 font-bold text-sm">{board.playerStore}</div>
            </div>
          </div>
        </div>

        {/* Player pits (bottom row, left-to-right = 0..5) */}
        <div className="flex gap-2 justify-center mt-2">
          <div className="w-10" /> {/* spacer for AI store */}
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <button
              key={i}
              type="button"
              onClick={() => playerMove(i)}
              disabled={over || turn !== "player" || board.playerPits[i] === 0}
              className={`flex flex-col items-center justify-center w-10 h-14 rounded-full border-2 transition-all duration-150
                ${turn === "player" && !over && board.playerPits[i] > 0
                  ? "bg-amber-800 border-amber-500 hover:bg-amber-700 hover:scale-105 active:scale-95 cursor-pointer"
                  : "bg-amber-950 border-amber-800 cursor-default opacity-60"}`}
            >
              {renderSeeds(board.playerPits[i])}
            </button>
          ))}
          <div className="w-10" /> {/* spacer for player store */}
        </div>
        <div className="text-center text-xs text-amber-300 mt-1">You (tap to move)</div>
      </div>

      <p className="text-xs text-muted-foreground">Distribute seeds counter-clockwise. Capture 2 or 3!</p>
    </div>
  );
}
