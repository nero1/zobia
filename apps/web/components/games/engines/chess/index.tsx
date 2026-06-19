"use client";

/**
 * Chess — player (White) vs AI (Black).
 * Minimax with alpha-beta pruning: depth 2 easy, 3 medium, 4 hard.
 * Score = material captured by player − material lost (centipawns / 10, int).
 */

import { useEffect, useState, useCallback, useRef } from "react";
import type { GameEngineProps } from "@/components/games/types";
import { useGameSound } from "@/components/games/useGameSound";

/* ─── Types ─── */
type PieceType = "p" | "n" | "b" | "r" | "q" | "k";
type Color = "w" | "b";
interface Piece { type: PieceType; color: Color }
type Square = Piece | null;
type Board = Square[][];  // [row 0-7][col 0-7], row 0 = rank 8 (black side)

interface Move {
  from: [number, number];
  to: [number, number];
  promo?: PieceType;
  capture?: Piece;
  castle?: "k" | "q";
  enPassant?: boolean;
}

interface GameState {
  board: Board;
  turn: Color;
  castling: { wk: boolean; wq: boolean; bk: boolean; bq: boolean };
  enPassant: [number, number] | null;
  halfMove: number;
  fullMove: number;
}

/* ─── Constants ─── */
const PIECE_VALUES: Record<PieceType, number> = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 20000 };
const PIECE_GLYPHS: Record<string, string> = {
  wp: "♙", wn: "♘", wb: "♗", wr: "♖", wq: "♕", wk: "♔",
  bp: "♟", bn: "♞", bb: "♝", br: "♜", bq: "♛", bk: "♚",
};
const DEPTH: Record<string, number> = { easy: 2, medium: 3, hard: 4 };

/* ─── Board initialisation ─── */
function startBoard(): Board {
  const b: Board = Array.from({ length: 8 }, () => Array(8).fill(null));
  const backRank: PieceType[] = ["r", "n", "b", "q", "k", "b", "n", "r"];
  for (let c = 0; c < 8; c++) {
    b[0][c] = { type: backRank[c], color: "b" };
    b[1][c] = { type: "p", color: "b" };
    b[6][c] = { type: "p", color: "w" };
    b[7][c] = { type: backRank[c], color: "w" };
  }
  return b;
}

function cloneBoard(b: Board): Board {
  return b.map(row => row.map(sq => sq ? { ...sq } : null));
}

function cloneState(s: GameState): GameState {
  return {
    board: cloneBoard(s.board),
    turn: s.turn,
    castling: { ...s.castling },
    enPassant: s.enPassant ? [...s.enPassant] as [number, number] : null,
    halfMove: s.halfMove,
    fullMove: s.fullMove,
  };
}

/* ─── Move generation ─── */
function inBounds(r: number, c: number) { return r >= 0 && r < 8 && c >= 0 && c < 8; }

function isAttacked(board: Board, r: number, c: number, byColor: Color): boolean {
  const opp = byColor;
  // Pawns
  const dir = opp === "w" ? 1 : -1;
  for (const dc of [-1, 1]) {
    const pr = r + dir, pc = c + dc;
    if (inBounds(pr, pc)) {
      const sq = board[pr][pc];
      if (sq && sq.color === opp && sq.type === "p") return true;
    }
  }
  // Knights
  for (const [dr, dc] of [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]]) {
    const nr = r + dr, nc = c + dc;
    if (inBounds(nr, nc)) {
      const sq = board[nr][nc];
      if (sq && sq.color === opp && sq.type === "n") return true;
    }
  }
  // Sliders (rook/queen on ranks/files, bishop/queen on diagonals)
  for (const [dr, dc] of [[0,1],[0,-1],[1,0],[-1,0]]) {
    for (let i = 1; i < 8; i++) {
      const nr = r + dr * i, nc = c + dc * i;
      if (!inBounds(nr, nc)) break;
      const sq = board[nr][nc];
      if (sq) {
        if (sq.color === opp && (sq.type === "r" || sq.type === "q")) return true;
        break;
      }
    }
  }
  for (const [dr, dc] of [[1,1],[1,-1],[-1,1],[-1,-1]]) {
    for (let i = 1; i < 8; i++) {
      const nr = r + dr * i, nc = c + dc * i;
      if (!inBounds(nr, nc)) break;
      const sq = board[nr][nc];
      if (sq) {
        if (sq.color === opp && (sq.type === "b" || sq.type === "q")) return true;
        break;
      }
    }
  }
  // King
  for (const [dr, dc] of [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]]) {
    const nr = r + dr, nc = c + dc;
    if (inBounds(nr, nc)) {
      const sq = board[nr][nc];
      if (sq && sq.color === opp && sq.type === "k") return true;
    }
  }
  return false;
}

function findKing(board: Board, color: Color): [number, number] {
  for (let r = 0; r < 8; r++)
    for (let c = 0; c < 8; c++)
      if (board[r][c]?.color === color && board[r][c]?.type === "k") return [r, c];
  return [0, 0]; // should never happen
}

function inCheck(board: Board, color: Color): boolean {
  const [kr, kc] = findKing(board, color);
  return isAttacked(board, kr, kc, color === "w" ? "b" : "w");
}

function pseudoMoves(state: GameState, color: Color): Move[] {
  const { board, enPassant, castling } = state;
  const moves: Move[] = [];
  const opp = color === "w" ? "b" : "w";

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = board[r][c];
      if (!piece || piece.color !== color) continue;

      if (piece.type === "p") {
        const dir = color === "w" ? -1 : 1;
        const startRow = color === "w" ? 6 : 1;
        const promoRow = color === "w" ? 0 : 7;
        // Forward
        if (inBounds(r + dir, c) && !board[r + dir][c]) {
          const toR = r + dir;
          if (toR === promoRow) {
            for (const p of ["q", "r", "b", "n"] as PieceType[])
              moves.push({ from: [r, c], to: [toR, c], promo: p });
          } else {
            moves.push({ from: [r, c], to: [toR, c] });
            if (r === startRow && !board[r + 2 * dir][c])
              moves.push({ from: [r, c], to: [r + 2 * dir, c] });
          }
        }
        // Captures
        for (const dc of [-1, 1]) {
          const toR = r + dir, toC = c + dc;
          if (!inBounds(toR, toC)) continue;
          const target = board[toR][toC];
          if (target && target.color === opp) {
            if (toR === promoRow) {
              for (const p of ["q", "r", "b", "n"] as PieceType[])
                moves.push({ from: [r, c], to: [toR, toC], promo: p, capture: target });
            } else {
              moves.push({ from: [r, c], to: [toR, toC], capture: target });
            }
          }
          if (enPassant && enPassant[0] === toR && enPassant[1] === toC)
            moves.push({ from: [r, c], to: [toR, toC], enPassant: true, capture: { type: "p", color: opp } });
        }
      } else if (piece.type === "n") {
        for (const [dr, dc] of [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]]) {
          const toR = r + dr, toC = c + dc;
          if (!inBounds(toR, toC)) continue;
          const target = board[toR][toC];
          if (!target || target.color === opp)
            moves.push({ from: [r, c], to: [toR, toC], capture: target ?? undefined });
        }
      } else if (piece.type === "k") {
        for (const [dr, dc] of [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]]) {
          const toR = r + dr, toC = c + dc;
          if (!inBounds(toR, toC)) continue;
          const target = board[toR][toC];
          if (!target || target.color === opp)
            moves.push({ from: [r, c], to: [toR, toC], capture: target ?? undefined });
        }
        // Castling
        if (color === "w" && r === 7 && c === 4) {
          if (castling.wk && !board[7][5] && !board[7][6])
            moves.push({ from: [7, 4], to: [7, 6], castle: "k" });
          if (castling.wq && !board[7][3] && !board[7][2] && !board[7][1])
            moves.push({ from: [7, 4], to: [7, 2], castle: "q" });
        }
        if (color === "b" && r === 0 && c === 4) {
          if (castling.bk && !board[0][5] && !board[0][6])
            moves.push({ from: [0, 4], to: [0, 6], castle: "k" });
          if (castling.bq && !board[0][3] && !board[0][2] && !board[0][1])
            moves.push({ from: [0, 4], to: [0, 2], castle: "q" });
        }
      } else {
        // Sliders
        const dirs =
          piece.type === "r" ? [[0,1],[0,-1],[1,0],[-1,0]] :
          piece.type === "b" ? [[1,1],[1,-1],[-1,1],[-1,-1]] :
          [[0,1],[0,-1],[1,0],[-1,0],[1,1],[1,-1],[-1,1],[-1,-1]];
        for (const [dr, dc] of dirs) {
          for (let i = 1; i < 8; i++) {
            const toR = r + dr * i, toC = c + dc * i;
            if (!inBounds(toR, toC)) break;
            const target = board[toR][toC];
            if (!target) moves.push({ from: [r, c], to: [toR, toC] });
            else {
              if (target.color === opp) moves.push({ from: [r, c], to: [toR, toC], capture: target });
              break;
            }
          }
        }
      }
    }
  }
  return moves;
}

function applyMove(state: GameState, move: Move): GameState {
  const next = cloneState(state);
  const { board } = next;
  const [fr, fc] = move.from;
  const [tr, tc] = move.to;
  const piece = board[fr][fc]!;

  // En passant capture
  if (move.enPassant) {
    const captureRow = fr;
    board[captureRow][tc] = null;
  }

  // Move piece
  board[tr][tc] = move.promo ? { type: move.promo, color: piece.color } : { ...piece };
  board[fr][fc] = null;

  // Castling rook
  if (move.castle) {
    if (move.castle === "k") {
      board[tr][tr === 7 ? 5 : 5] = board[tr][7];
      board[tr][7] = null;
    } else {
      board[tr][tr === 7 ? 3 : 3] = board[tr][0];
      board[tr][0] = null;
    }
  }

  // Update castling rights
  if (piece.type === "k") {
    if (piece.color === "w") { next.castling.wk = false; next.castling.wq = false; }
    else { next.castling.bk = false; next.castling.bq = false; }
  }
  if (piece.type === "r") {
    if (fr === 7 && fc === 7) next.castling.wk = false;
    if (fr === 7 && fc === 0) next.castling.wq = false;
    if (fr === 0 && fc === 7) next.castling.bk = false;
    if (fr === 0 && fc === 0) next.castling.bq = false;
  }

  // En passant target square
  if (piece.type === "p" && Math.abs(tr - fr) === 2)
    next.enPassant = [(fr + tr) / 2, fc] as [number, number];
  else
    next.enPassant = null;

  next.halfMove = (piece.type === "p" || move.capture) ? 0 : next.halfMove + 1;
  if (state.turn === "b") next.fullMove++;
  next.turn = state.turn === "w" ? "b" : "w";
  return next;
}

function legalMoves(state: GameState, color: Color): Move[] {
  return pseudoMoves(state, color).filter(m => {
    const next = applyMove(state, m);
    // For castling, check squares the king passes through
    if (m.castle) {
      const row = color === "w" ? 7 : 0;
      const opp = color === "w" ? "b" : "w";
      if (isAttacked(state.board, row, 4, opp)) return false;
      if (m.castle === "k" && (isAttacked(state.board, row, 5, opp) || isAttacked(state.board, row, 6, opp))) return false;
      if (m.castle === "q" && (isAttacked(state.board, row, 3, opp) || isAttacked(state.board, row, 2, opp))) return false;
    }
    return !inCheck(next.board, color);
  });
}

/* ─── AI Evaluation ─── */
const PST: Record<PieceType, number[][]> = {
  p: [
    [0,0,0,0,0,0,0,0],[50,50,50,50,50,50,50,50],[10,10,20,30,30,20,10,10],
    [5,5,10,25,25,10,5,5],[0,0,0,20,20,0,0,0],[5,-5,-10,0,0,-10,-5,5],
    [5,10,10,-20,-20,10,10,5],[0,0,0,0,0,0,0,0],
  ],
  n: [
    [-50,-40,-30,-30,-30,-30,-40,-50],[-40,-20,0,0,0,0,-20,-40],
    [-30,0,10,15,15,10,0,-30],[-30,5,15,20,20,15,5,-30],
    [-30,0,15,20,20,15,0,-30],[-30,5,10,15,15,10,5,-30],
    [-40,-20,0,5,5,0,-20,-40],[-50,-40,-30,-30,-30,-30,-40,-50],
  ],
  b: [
    [-20,-10,-10,-10,-10,-10,-10,-20],[-10,0,0,0,0,0,0,-10],
    [-10,0,5,10,10,5,0,-10],[-10,5,5,10,10,5,5,-10],
    [-10,0,10,10,10,10,0,-10],[-10,10,10,10,10,10,10,-10],
    [-10,5,0,0,0,0,5,-10],[-20,-10,-10,-10,-10,-10,-10,-20],
  ],
  r: [
    [0,0,0,0,0,0,0,0],[5,10,10,10,10,10,10,5],[-5,0,0,0,0,0,0,-5],
    [-5,0,0,0,0,0,0,-5],[-5,0,0,0,0,0,0,-5],[-5,0,0,0,0,0,0,-5],
    [-5,0,0,0,0,0,0,-5],[0,0,0,5,5,0,0,0],
  ],
  q: [
    [-20,-10,-10,-5,-5,-10,-10,-20],[-10,0,0,0,0,0,0,-10],
    [-10,0,5,5,5,5,0,-10],[-5,0,5,5,5,5,0,-5],
    [0,0,5,5,5,5,0,-5],[-10,5,5,5,5,5,0,-10],
    [-10,0,5,0,0,0,0,-10],[-20,-10,-10,-5,-5,-10,-10,-20],
  ],
  k: [
    [-30,-40,-40,-50,-50,-40,-40,-30],[-30,-40,-40,-50,-50,-40,-40,-30],
    [-30,-40,-40,-50,-50,-40,-40,-30],[-30,-40,-40,-50,-50,-40,-40,-30],
    [-20,-30,-30,-40,-40,-30,-30,-20],[-10,-20,-20,-20,-20,-20,-20,-10],
    [20,20,0,0,0,0,20,20],[20,30,10,0,0,10,30,20],
  ],
};

function evaluate(board: Board): number {
  let score = 0;
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (!p) continue;
      const pst = p.color === "w" ? PST[p.type][r][c] : PST[p.type][7 - r][c];
      const val = PIECE_VALUES[p.type] + pst;
      score += p.color === "w" ? val : -val;
    }
  }
  return score;
}

function minimax(state: GameState, depth: number, alpha: number, beta: number, maxing: boolean): number {
  if (depth === 0) return evaluate(state.board);
  const color: Color = maxing ? "w" : "b";
  const moves = legalMoves(state, color);
  if (moves.length === 0) {
    if (inCheck(state.board, color)) return maxing ? -99999 : 99999; // checkmate
    return 0; // stalemate
  }
  if (maxing) {
    let best = -Infinity;
    for (const m of moves) {
      best = Math.max(best, minimax(applyMove(state, m), depth - 1, alpha, beta, false));
      alpha = Math.max(alpha, best);
      if (beta <= alpha) break;
    }
    return best;
  } else {
    let best = Infinity;
    for (const m of moves) {
      best = Math.min(best, minimax(applyMove(state, m), depth - 1, alpha, beta, true));
      beta = Math.min(beta, best);
      if (beta <= alpha) break;
    }
    return best;
  }
}

function bestAiMove(state: GameState, depth: number): Move | null {
  const moves = legalMoves(state, "b");
  if (!moves.length) return null;
  // Always promote to queen for simplicity
  const filteredMoves = moves.map(m => m.promo ? { ...m, promo: "q" as PieceType } : m);
  let bestVal = Infinity, best = filteredMoves[0];
  for (const m of filteredMoves) {
    const val = minimax(applyMove(state, m), depth - 1, -Infinity, Infinity, true);
    if (val < bestVal) { bestVal = val; best = m; }
  }
  return best;
}

/* ─── Component ─── */
export default function ChessGame({ onReady, onGameOver, onScore, difficulty = "medium", paused, soundEnabled = true }: GameEngineProps) {
  const depth = DEPTH[difficulty] ?? 3;

  const initialState: GameState = {
    board: startBoard(),
    turn: "w",
    castling: { wk: true, wq: true, bk: true, bq: true },
    enPassant: null,
    halfMove: 0,
    fullMove: 1,
  };

  const [gameState, setGameState] = useState<GameState>(initialState);
  const [selected, setSelected] = useState<[number, number] | null>(null);
  const [legalDests, setLegalDests] = useState<[number, number][]>([]);
  const [status, setStatus] = useState<"playing" | "check" | "checkmate" | "stalemate" | "draw">("playing");
  const [thinking, setThinking] = useState(false);
  const [capturedW, setCapturedW] = useState<Piece[]>([]);  // captured by white
  const [capturedB, setCapturedB] = useState<Piece[]>([]);  // captured by black
  const [lastMove, setLastMove] = useState<Move | null>(null);
  const pausedRef = useRef(paused);
  const play = useGameSound(soundEnabled ?? true);

  useEffect(() => { pausedRef.current = paused; }, [paused]);
  useEffect(() => { onReady?.(); }, [onReady]);

  const materialScore = useCallback(() => {
    const wVal = capturedW.reduce((s, p) => s + PIECE_VALUES[p.type], 0);
    const bVal = capturedB.reduce((s, p) => s + PIECE_VALUES[p.type], 0);
    return Math.max(0, wVal - bVal);
  }, [capturedW, capturedB]);

  const checkGameStatus = useCallback((state: GameState, color: Color) => {
    const moves = legalMoves(state, color);
    if (!moves.length) {
      if (inCheck(state.board, color)) return "checkmate" as const;
      return "stalemate" as const;
    }
    if (state.halfMove >= 50) return "draw" as const;
    if (inCheck(state.board, color)) return "check" as const;
    return "playing" as const;
  }, []);

  const handleAiMove = useCallback((state: GameState) => {
    if (pausedRef.current) return;
    setThinking(true);
    // Run AI in a microtask to avoid blocking UI
    setTimeout(() => {
      const move = bestAiMove(state, depth);
      if (!move) {
        // AI has no moves
        const s = checkGameStatus(state, "b");
        setStatus(s === "checkmate" ? "checkmate" : "stalemate");
        setThinking(false);
        const score = materialScore();
        onGameOver(score);
        return;
      }
      const next = applyMove(state, move);
      if (move.capture) {
        setCapturedB(prev => [...prev, move.capture!]);
        play("match");
      } else {
        play("move");
      }
      setLastMove(move);
      setGameState(next);
      const newStatus = checkGameStatus(next, "w");
      setStatus(newStatus);
      setThinking(false);
      if (newStatus === "checkmate" || newStatus === "stalemate" || newStatus === "draw") {
        const score = materialScore();
        onGameOver(score);
      } else if (newStatus === "check") {
        play("miss");
      }
    }, 50);
  }, [depth, checkGameStatus, materialScore, onGameOver, play]);

  const handleSquareClick = useCallback((r: number, c: number) => {
    if (pausedRef.current || gameState.turn !== "w" || thinking || status !== "playing" && status !== "check") return;
    const piece = gameState.board[r][c];

    if (selected) {
      // Try to make move
      const moves = legalMoves(gameState, "w");
      const move = moves.find(m =>
        m.from[0] === selected[0] && m.from[1] === selected[1] &&
        m.to[0] === r && m.to[1] === c &&
        (!m.promo || m.promo === "q") // auto-queen
      );
      if (move) {
        const mWithPromo = move.promo ? { ...move, promo: "q" as PieceType } : move;
        const next = applyMove(gameState, mWithPromo);
        if (mWithPromo.capture) {
          setCapturedW(prev => [...prev, mWithPromo.capture!]);
          play("match");
        } else if (mWithPromo.castle) {
          play("click");
        } else {
          play("move");
        }
        setLastMove(mWithPromo);
        setGameState(next);
        setSelected(null);
        setLegalDests([]);
        const newStatus = checkGameStatus(next, "b");
        if (newStatus === "checkmate" || newStatus === "stalemate" || newStatus === "draw") {
          setStatus(newStatus);
          onGameOver(materialScore() + (newStatus === "checkmate" ? 500 : 0));
        } else {
          setStatus("playing");
          const score = materialScore();
          onScore?.(score);
          handleAiMove(next);
        }
        return;
      }
      // Deselect or re-select
      if (piece && piece.color === "w") {
        setSelected([r, c]);
        const dests = legalMoves(gameState, "w")
          .filter(m => m.from[0] === r && m.from[1] === c)
          .map(m => m.to as [number, number]);
        setLegalDests(dests);
      } else {
        setSelected(null);
        setLegalDests([]);
      }
    } else {
      if (piece && piece.color === "w") {
        setSelected([r, c]);
        const dests = legalMoves(gameState, "w")
          .filter(m => m.from[0] === r && m.from[1] === c)
          .map(m => m.to as [number, number]);
        setLegalDests(dests);
        play("tap");
      }
    }
  }, [gameState, selected, thinking, status, checkGameStatus, materialScore, onGameOver, onScore, handleAiMove, play]);

  const isHighlighted = (r: number, c: number) =>
    (selected && selected[0] === r && selected[1] === c) ||
    legalDests.some(d => d[0] === r && d[1] === c) ||
    (lastMove && ((lastMove.from[0] === r && lastMove.from[1] === c) || (lastMove.to[0] === r && lastMove.to[1] === c)));

  const isDest = (r: number, c: number) => legalDests.some(d => d[0] === r && d[1] === c);
  const isLastMove = (r: number, c: number) =>
    lastMove && ((lastMove.from[0] === r && lastMove.from[1] === c) || (lastMove.to[0] === r && lastMove.to[1] === c));

  const score = materialScore();

  const FILES = ["a","b","c","d","e","f","g","h"];
  const RANKS = ["8","7","6","5","4","3","2","1"];

  return (
    <div className="flex flex-col items-center gap-3 select-none w-full max-w-sm mx-auto">
      {/* Status bar */}
      <div className="flex w-full items-center justify-between text-sm px-1">
        <span className="text-emerald-400 font-semibold">Score: {score}</span>
        <span className={`font-bold ${
          status === "checkmate" ? "text-red-400" :
          status === "check" ? "text-amber-400 animate-pulse" :
          status === "stalemate" || status === "draw" ? "text-muted-foreground" :
          thinking ? "text-blue-400 animate-pulse" :
          gameState.turn === "w" ? "text-emerald-400" : "text-muted-foreground"
        }`}>
          {status === "checkmate" ? (gameState.turn === "w" ? "You lost!" : "Checkmate! You win!") :
           status === "stalemate" ? "Stalemate — Draw" :
           status === "draw" ? "50-move draw" :
           status === "check" ? "Check!" :
           thinking ? "AI thinking…" :
           gameState.turn === "w" ? "Your turn (White)" : "AI's turn (Black)"}
        </span>
        <span className="text-muted-foreground text-xs">Move {gameState.fullMove}</span>
      </div>

      {/* Captured by white */}
      <div className="flex flex-wrap gap-0.5 w-full min-h-[1.5rem] text-sm">
        {capturedW.map((p, i) => (
          <span key={i} className="text-base leading-none">{PIECE_GLYPHS[`b${p.type}`]}</span>
        ))}
      </div>

      {/* Board */}
      <div className="relative border border-border rounded-sm overflow-hidden shadow-xl"
        style={{ width: "min(340px, calc(100vw - 48px))", aspectRatio: "1" }}>
        <div className="grid w-full h-full" style={{ gridTemplateColumns: "repeat(8, 1fr)", gridTemplateRows: "repeat(8, 1fr)" }}>
          {gameState.board.map((row, r) => row.map((piece, c) => {
            const isDark = (r + c) % 2 === 1;
            const sel = selected && selected[0] === r && selected[1] === c;
            const dest = isDest(r, c);
            const lm = isLastMove(r, c);
            return (
              <div
                key={`${r}${c}`}
                onClick={() => handleSquareClick(r, c)}
                className={`relative flex items-center justify-center cursor-pointer transition-colors duration-100
                  ${isDark ? "bg-[#769656]" : "bg-[#eeeed2]"}
                  ${sel ? "ring-2 ring-inset ring-yellow-400" : ""}
                  ${lm ? "bg-opacity-80" : ""}
                `}
                style={{
                  backgroundColor: sel ? (isDark ? "#f6f669" : "#f6f669") :
                    lm ? (isDark ? "#bbca44" : "#f6f669") :
                    isDark ? "#769656" : "#eeeed2",
                }}
              >
                {dest && (
                  <div className={`absolute rounded-full ${piece ? "inset-0 ring-4 ring-inset ring-black/20" : "w-1/3 h-1/3 bg-black/20"}`} />
                )}
                {piece && (
                  <span className={`text-2xl leading-none z-10 drop-shadow-sm select-none
                    ${piece.color === "w" ? "text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.8)]" : "text-black drop-shadow-[0_1px_1px_rgba(255,255,255,0.3)]"}
                  `} style={{ fontSize: "clamp(14px, 5vw, 24px)" }}>
                    {PIECE_GLYPHS[`${piece.color}${piece.type}`]}
                  </span>
                )}
                {c === 0 && <span className="absolute top-0.5 left-0.5 text-[8px] leading-none opacity-60 text-black font-bold">{RANKS[r]}</span>}
                {r === 7 && <span className="absolute bottom-0.5 right-0.5 text-[8px] leading-none opacity-60 text-black font-bold">{FILES[c]}</span>}
              </div>
            );
          }))}
        </div>
      </div>

      {/* Captured by black */}
      <div className="flex flex-wrap gap-0.5 w-full min-h-[1.5rem] text-sm">
        {capturedB.map((p, i) => (
          <span key={i} className="text-base leading-none">{PIECE_GLYPHS[`w${p.type}`]}</span>
        ))}
      </div>

      {(status === "checkmate" || status === "stalemate" || status === "draw") && (
        <div className="text-center space-y-1 py-2">
          <p className={`text-lg font-bold ${
            status === "checkmate" && gameState.turn === "b" ? "text-emerald-400" : "text-amber-400"
          }`}>
            {status === "checkmate"
              ? gameState.turn === "w" ? "AI wins by checkmate" : "You win by checkmate! 🏆"
              : "Draw"}
          </p>
          <p className="text-muted-foreground text-sm">Material score: {score}</p>
        </div>
      )}
    </div>
  );
}
