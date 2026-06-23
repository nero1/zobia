"use client";

/**
 * Tic-Tac-Toe vs AI.
 * Easy: random AI. Medium: blocking AI. Hard: minimax (unbeatable).
 * Best of 3 (Easy/Medium), single game (Hard).
 * Score: win=100, draw=30, lose=0 per round.
 */

import { useEffect, useState, useRef, useCallback } from "react";
import type { GameEngineProps } from "@/components/games/types";
import { useGameSound } from "@/components/games/useGameSound";

type Cell = "X" | "O" | null;
type Board = Cell[];

const WIN_LINES = [
  [0,1,2],[3,4,5],[6,7,8],
  [0,3,6],[1,4,7],[2,5,8],
  [0,4,8],[2,4,6],
];

function getWinner(board: Board): { winner: Cell; line: number[] } | null {
  for (const line of WIN_LINES) {
    const [a, b, c] = line;
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return { winner: board[a], line };
    }
  }
  return null;
}

function isDraw(board: Board) {
  return board.every((c) => c !== null) && !getWinner(board);
}

// Minimax
function minimax(board: Board, isMaximizing: boolean): number {
  const result = getWinner(board);
  if (result) return result.winner === "O" ? 10 : -10;
  if (isDraw(board)) return 0;
  if (isMaximizing) {
    let best = -Infinity;
    for (let i = 0; i < 9; i++) {
      if (!board[i]) {
        board[i] = "O";
        best = Math.max(best, minimax(board, false));
        board[i] = null;
      }
    }
    return best;
  } else {
    let best = Infinity;
    for (let i = 0; i < 9; i++) {
      if (!board[i]) {
        board[i] = "X";
        best = Math.min(best, minimax(board, true));
        board[i] = null;
      }
    }
    return best;
  }
}

function getBestMove(board: Board): number {
  let best = -Infinity;
  let bestMove = -1;
  const available = board.map((c, i) => c === null ? i : -1).filter((i) => i >= 0);
  for (const i of available) {
    board[i] = "O";
    const score = minimax(board, false);
    board[i] = null;
    if (score > best) { best = score; bestMove = i; }
  }
  return bestMove;
}

function getBlockingMove(board: Board): number {
  const available = board.map((c, i) => c === null ? i : -1).filter((i) => i >= 0);
  // Try to win first
  for (const i of available) {
    board[i] = "O";
    if (getWinner(board)) { board[i] = null; return i; }
    board[i] = null;
  }
  // Block player win
  for (const i of available) {
    board[i] = "X";
    if (getWinner(board)) { board[i] = null; return i; }
    board[i] = null;
  }
  // Center
  if (!board[4]) return 4;
  // Random
  return available[Math.floor(Math.random() * available.length)];
}

function getAIMove(board: Board, difficulty: string): number {
  const available = board.map((c, i) => c === null ? i : -1).filter((i) => i >= 0);
  if (available.length === 0) return -1;
  if (difficulty === "easy") return available[Math.floor(Math.random() * available.length)];
  if (difficulty === "medium") return getBlockingMove(board);
  return getBestMove(board);
}

const BEST_OF = { easy: 3, medium: 3, hard: 1 };

export default function TicTacToeGame({
  onReady, onGameOver, onScore, difficulty = "medium", paused, soundEnabled = true,
}: GameEngineProps) {
  const diff = difficulty ?? "medium";
  const maxRounds = BEST_OF[diff as keyof typeof BEST_OF] ?? 3;
  const [board, setBoard] = useState<Board>(Array(9).fill(null));
  const [isPlayerTurn, setIsPlayerTurn] = useState(true);
  const [round, setRound] = useState(1);
  const [scores, setScores] = useState({ player: 0, ai: 0, draw: 0 });
  const [totalScore, setTotalScore] = useState(0);
  const [roundResult, setRoundResult] = useState<"win" | "lose" | "draw" | null>(null);
  const [winLine, setWinLine] = useState<number[] | null>(null);
  const [gameDone, setGameDone] = useState(false);
  const doneRef = useRef(false);
  const pausedRef = useRef(paused);
  const aiTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const play = useGameSound(soundEnabled ?? true);

  useEffect(() => { pausedRef.current = paused; }, [paused]);
  useEffect(() => { onReady?.(); }, [onReady]);

  const endRound = useCallback((result: "win" | "lose" | "draw", line: number[] | null, currentBoard: Board) => {
    setRoundResult(result);
    setWinLine(line);
    let pts = 0;
    if (result === "win") { pts = 100; play("win"); }
    else if (result === "lose") { play("lose"); }
    else { pts = 30; play("score"); }

    setScores((prev) => ({
      ...prev,
      player: result === "win" ? prev.player + 1 : prev.player,
      ai: result === "lose" ? prev.ai + 1 : prev.ai,
      draw: result === "draw" ? prev.draw + 1 : prev.draw,
    }));

    setTotalScore((prev) => {
      const newScore = prev + pts;
      onScore?.(newScore);
      return newScore;
    });

    setTimeout(() => {
      if (round >= maxRounds || doneRef.current) {
        doneRef.current = true;
        setGameDone(true);
        setTotalScore((s) => {
          onGameOver(s);
          return s;
        });
      } else {
        setRound((r) => r + 1);
        setBoard(Array(9).fill(null));
        setIsPlayerTurn(true);
        setRoundResult(null);
        setWinLine(null);
      }
    }, 1500);
  }, [round, maxRounds, play, onScore, onGameOver]);

  const handlePlayerMove = useCallback((index: number) => {
    if (pausedRef.current || !isPlayerTurn || board[index] || roundResult || gameDone) return;
    play("tap");
    const newBoard = [...board] as Board;
    newBoard[index] = "X";
    setBoard(newBoard);
    setIsPlayerTurn(false);

    const winResult = getWinner(newBoard);
    if (winResult) {
      endRound("win", winResult.line, newBoard);
      return;
    }
    if (isDraw(newBoard)) {
      endRound("draw", null, newBoard);
      return;
    }

    // AI move after delay
    aiTimerRef.current = setTimeout(() => {
      if (pausedRef.current) { setIsPlayerTurn(true); return; }
      const aiMove = getAIMove(newBoard, diff);
      if (aiMove === -1) return;
      play("click");
      const aiBoard = [...newBoard] as Board;
      aiBoard[aiMove] = "O";
      setBoard(aiBoard);
      setIsPlayerTurn(true);

      const aiWin = getWinner(aiBoard);
      if (aiWin) {
        endRound("lose", aiWin.line, aiBoard);
        return;
      }
      if (isDraw(aiBoard)) {
        endRound("draw", null, aiBoard);
      }
    }, 400);
  }, [board, isPlayerTurn, roundResult, gameDone, diff, play, endRound]);

  useEffect(() => () => { if (aiTimerRef.current) clearTimeout(aiTimerRef.current); }, []);

  if (gameDone) {
    return (
      <div className="flex flex-col items-center gap-4 select-none w-full max-w-sm mx-auto">
        <div className="w-full rounded-2xl border-2 border-border bg-card p-6 text-center flex flex-col gap-3">
          <p className="text-2xl font-black text-foreground">Game Over!</p>
          <p className="text-emerald-400 font-bold text-3xl">{totalScore} pts</p>
          <p className="text-muted-foreground">
            You: {scores.player}W | AI: {scores.ai}W | Draws: {scores.draw}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-4 select-none w-full max-w-sm mx-auto">
      {/* Header */}
      <div className="flex w-full items-center justify-between text-sm px-1">
        <span className="text-muted-foreground">Round {round}/{maxRounds}</span>
        <span className="text-emerald-400 font-bold text-xl">{totalScore}</span>
        <span className="text-muted-foreground">
          You:{scores.player} AI:{scores.ai}
        </span>
      </div>

      {/* Turn indicator */}
      <div className={`text-sm font-semibold px-3 py-1 rounded-full ${
        roundResult ? "text-muted-foreground" :
        isPlayerTurn ? "text-blue-400 bg-blue-500/20" : "text-orange-400 bg-orange-500/20"
      }`}>
        {roundResult === "win" ? "🎉 You won this round!" :
         roundResult === "lose" ? "🤖 AI won this round" :
         roundResult === "draw" ? "🤝 Draw!" :
         isPlayerTurn ? "Your turn (X)" : "AI thinking..."}
      </div>

      {/* Board */}
      <div className="grid grid-cols-3 gap-2 w-full max-w-[240px]">
        {board.map((cell, i) => {
          const isWinCell = winLine?.includes(i);
          return (
            <button
              key={i}
              type="button"
              onClick={() => handlePlayerMove(i)}
              disabled={!!cell || !isPlayerTurn || !!roundResult}
              className={`aspect-square rounded-xl text-4xl font-black border-2 flex items-center justify-center transition-all ${
                isWinCell ? "border-emerald-500 bg-emerald-500/20 scale-105" :
                cell ? "border-border bg-card cursor-default" :
                isPlayerTurn && !roundResult ? "border-border bg-card hover:bg-accent cursor-pointer hover:border-primary/50" :
                "border-border bg-card cursor-default"
              }`}
            >
              <span className={cell === "X" ? "text-blue-400" : "text-orange-400"}>
                {cell}
              </span>
            </button>
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex gap-4 text-sm text-muted-foreground">
        <span><span className="text-blue-400 font-bold">X</span> = You</span>
        <span><span className="text-orange-400 font-bold">O</span> = AI</span>
      </div>
    </div>
  );
}
