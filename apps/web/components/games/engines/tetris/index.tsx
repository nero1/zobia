"use client";

/**
 * Tetris — falling-blocks puzzle. Left/right to move, up to rotate, down to soft
 * drop, space to hard drop (touch buttons mirror these). Clearing lines scores
 * (40/100/300/1200 × level). Game ends when a new piece can't spawn.
 */

import { useEffect, useRef, useState } from "react";
import type { GameEngineProps } from "@/components/games/types";

const COLS = 10;
const ROWS = 20;
const CELL = 18;

const SHAPES: number[][][] = [
  [[1, 1, 1, 1]],                    // I
  [[1, 1], [1, 1]],                  // O
  [[0, 1, 0], [1, 1, 1]],            // T
  [[0, 1, 1], [1, 1, 0]],            // S
  [[1, 1, 0], [0, 1, 1]],            // Z
  [[1, 0, 0], [1, 1, 1]],            // J
  [[0, 0, 1], [1, 1, 1]],            // L
];
const COLORS = ["#06b6d4", "#eab308", "#a855f7", "#22c55e", "#ef4444", "#3b82f6", "#f97316"];
const LINE_SCORES = [0, 40, 100, 300, 1200];

type Piece = { shape: number[][]; color: number; x: number; y: number };

function rotateShape(sh: number[][]): number[][] {
  const rows = sh.length, cols = sh[0].length;
  const out = Array.from({ length: cols }, () => Array(rows).fill(0));
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) out[c][rows - 1 - r] = sh[r][c];
  return out;
}

export default function TetrisGame({ onReady, onGameOver, onScore }: GameEngineProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [score, setScore] = useState(0);
  const api = useRef<{ left: () => void; right: () => void; rotate: () => void; soft: () => void; hard: () => void }>();

  useEffect(() => {
    onReady?.();
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    const board: number[][] = Array.from({ length: ROWS }, () => Array(COLS).fill(0));

    const spawn = (): Piece => {
      const i = Math.floor(Math.random() * SHAPES.length);
      return { shape: SHAPES[i], color: i + 1, x: Math.floor((COLS - SHAPES[i][0].length) / 2), y: 0 };
    };
    let piece = spawn();
    const s = { score: 0, lines: 0, over: false, drop: 0 };

    const collides = (p: Piece): boolean => {
      for (let r = 0; r < p.shape.length; r++)
        for (let c = 0; c < p.shape[r].length; c++) {
          if (!p.shape[r][c]) continue;
          const x = p.x + c, y = p.y + r;
          if (x < 0 || x >= COLS || y >= ROWS) return true;
          if (y >= 0 && board[y][x]) return true;
        }
      return false;
    };

    const merge = (p: Piece) => {
      for (let r = 0; r < p.shape.length; r++)
        for (let c = 0; c < p.shape[r].length; c++)
          if (p.shape[r][c]) {
            const y = p.y + r;
            if (y < 0) { s.over = true; return; }
            board[y][p.x + c] = p.color;
          }
    };

    const clearLines = () => {
      let cleared = 0;
      for (let r = ROWS - 1; r >= 0; r--) {
        if (board[r].every((v) => v !== 0)) {
          board.splice(r, 1);
          board.unshift(Array(COLS).fill(0));
          cleared++;
          r++;
        }
      }
      if (cleared) {
        s.lines += cleared;
        const level = Math.floor(s.lines / 10) + 1;
        s.score += LINE_SCORES[cleared] * level;
        setScore(s.score);
        onScore?.(s.score);
      }
    };

    const lock = () => {
      merge(piece);
      if (s.over) { onGameOver(s.score); return; }
      clearLines();
      piece = spawn();
      if (collides(piece)) { s.over = true; onGameOver(s.score); }
    };

    const tryMove = (dx: number, dy: number): boolean => {
      const moved = { ...piece, x: piece.x + dx, y: piece.y + dy };
      if (!collides(moved)) { piece = moved; return true; }
      return false;
    };

    api.current = {
      left: () => { if (!s.over) { tryMove(-1, 0); draw(); } },
      right: () => { if (!s.over) { tryMove(1, 0); draw(); } },
      soft: () => { if (!s.over && !tryMove(0, 1)) lock(); draw(); },
      hard: () => { if (s.over) return; while (tryMove(0, 1)) { /* drop */ } lock(); draw(); },
      rotate: () => {
        if (s.over) return;
        const r = { ...piece, shape: rotateShape(piece.shape) };
        if (!collides(r)) piece = r;
        else { // simple wall kick
          for (const dx of [-1, 1, -2, 2]) {
            const k = { ...r, x: r.x + dx };
            if (!collides(k)) { piece = k; break; }
          }
        }
        draw();
      },
    };

    const onKey = (e: KeyboardEvent) => {
      const a = api.current!;
      const k = e.key.toLowerCase();
      if (k === "arrowleft" || k === "a") a.left();
      else if (k === "arrowright" || k === "d") a.right();
      else if (k === "arrowup" || k === "w") a.rotate();
      else if (k === "arrowdown" || k === "s") a.soft();
      else if (k === " ") a.hard();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);

    function draw() {
      ctx.fillStyle = "#0f172a"; ctx.fillRect(0, 0, COLS * CELL, ROWS * CELL);
      const cell = (x: number, y: number, color: number) => {
        ctx.fillStyle = COLORS[color - 1];
        ctx.fillRect(x * CELL, y * CELL, CELL - 1, CELL - 1);
      };
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (board[r][c]) cell(c, r, board[r][c]);
      for (let r = 0; r < piece.shape.length; r++)
        for (let c = 0; c < piece.shape[r].length; c++)
          if (piece.shape[r][c] && piece.y + r >= 0) cell(piece.x + c, piece.y + r, piece.color);
    }

    draw();
    let last = 0;
    let raf = 0;
    const loop = (t: number) => {
      if (s.over) return;
      if (t - last > Math.max(120, 600 - s.lines * 20)) {
        if (!tryMove(0, 1)) lock();
        draw();
        last = t;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onKey);
    };
  }, [onGameOver, onReady, onScore]);

  const Btn = ({ label, fn }: { label: string; fn: () => void }) => (
    <button
      type="button"
      onClick={fn}
      className="rounded-md bg-neutral-700 px-3 py-2 text-sm font-semibold text-white active:bg-neutral-600"
    >
      {label}
    </button>
  );

  return (
    <div className="flex flex-col items-center gap-2 select-none">
      <div className="text-sm font-semibold text-neutral-200">Score: {score}</div>
      <canvas ref={canvasRef} width={COLS * CELL} height={ROWS * CELL} className="rounded-lg border border-neutral-700 touch-none" />
      <div className="flex gap-2">
        <Btn label="◀" fn={() => api.current?.left()} />
        <Btn label="⟳" fn={() => api.current?.rotate()} />
        <Btn label="▶" fn={() => api.current?.right()} />
        <Btn label="▼" fn={() => api.current?.soft()} />
        <Btn label="⤓" fn={() => api.current?.hard()} />
      </div>
      <p className="text-xs text-neutral-400">Arrows/WASD to play, Space to hard-drop.</p>
    </div>
  );
}
