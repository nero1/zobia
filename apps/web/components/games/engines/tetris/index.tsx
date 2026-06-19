"use client";

/**
 * Tetris — falling-blocks puzzle.
 * Desktop: arrow keys to move/rotate, Space to hard-drop, S/Down to soft-drop.
 * Mobile: left side buttons (◀ ⟳), right side buttons (▶ ▼ ⤓) flanking the play area.
 * Score: 40/100/300/1200 × level per 1/2/3/4 lines.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import type { GameEngineProps } from "@/components/games/types";
import { useGameSound } from "@/components/games/useGameSound";

const COLS = 10;
const ROWS = 20;
const CELL = 17;
const PW = COLS * CELL;  // 170px play area width
const PH = ROWS * CELL;  // 340px

const SHAPES: number[][][] = [
  [[1,1,1,1]],
  [[1,1],[1,1]],
  [[0,1,0],[1,1,1]],
  [[0,1,1],[1,1,0]],
  [[1,1,0],[0,1,1]],
  [[1,0,0],[1,1,1]],
  [[0,0,1],[1,1,1]],
];
const COLORS = ["#06b6d4","#eab308","#a855f7","#22c55e","#ef4444","#3b82f6","#f97316"];
const LINE_SCORES = [0,40,100,300,1200];

// Difficulty → base drop interval in ms
const DROP_MS: Record<string, number> = { easy: 700, medium: 500, hard: 300 };

type Piece = { shape: number[][]; color: number; x: number; y: number };

function rotate(sh: number[][]): number[][] {
  const rows = sh.length, cols = sh[0].length;
  const out = Array.from({ length: cols }, () => Array(rows).fill(0));
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) out[c][rows - 1 - r] = sh[r][c];
  return out;
}

function ghostY(piece: Piece, board: number[][]): number {
  let y = piece.y;
  while (true) {
    const next = { ...piece, y: y + 1 };
    if (collidesPiece(next, board)) break;
    y++;
  }
  return y;
}

function collidesPiece(p: Piece, board: number[][]): boolean {
  for (let r = 0; r < p.shape.length; r++)
    for (let c = 0; c < p.shape[r].length; c++) {
      if (!p.shape[r][c]) continue;
      const x = p.x + c, y = p.y + r;
      if (x < 0 || x >= COLS || y >= ROWS) return true;
      if (y >= 0 && board[y][x]) return true;
    }
  return false;
}

export default function TetrisGame({ onReady, onGameOver, onScore, difficulty = "medium", paused, soundEnabled = true }: GameEngineProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [score, setScore] = useState(0);
  const [lines, setLines] = useState(0);
  const [level, setLevel] = useState(1);
  const pausedRef = useRef(paused);
  const play = useGameSound(soundEnabled ?? true);

  const apiRef = useRef<{
    left: () => void; right: () => void;
    rotate: () => void; soft: () => void; hard: () => void;
  }>();

  useEffect(() => { pausedRef.current = paused; }, [paused]);

  useEffect(() => {
    onReady?.();
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    const board: number[][] = Array.from({ length: ROWS }, () => Array(COLS).fill(0));

    const spawn = (): Piece => {
      const i = Math.floor(Math.random() * SHAPES.length);
      return { shape: SHAPES[i], color: i + 1, x: Math.floor((COLS - SHAPES[i][0].length) / 2), y: -1 };
    };

    let piece = spawn();
    const s = { score: 0, lines: 0, level: 1, over: false, drop: 0 };

    const collides = (p: Piece) => collidesPiece(p, board);

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
        if (board[r].every(v => v !== 0)) {
          board.splice(r, 1);
          board.unshift(Array(COLS).fill(0));
          cleared++;
          r++;
        }
      }
      if (cleared) {
        s.lines += cleared;
        s.level = Math.floor(s.lines / 10) + 1;
        s.score += LINE_SCORES[cleared] * s.level;
        setScore(s.score);
        setLines(s.lines);
        setLevel(s.level);
        onScore?.(s.score);
        play("levelUp");
      }
    };

    const lock = () => {
      merge(piece);
      if (s.over) { onGameOver(s.score); return; }
      clearLines();
      play("drop");
      piece = spawn();
      if (collides(piece)) { s.over = true; play("lose"); onGameOver(s.score); }
    };

    const tryMove = (dx: number, dy: number): boolean => {
      const moved = { ...piece, x: piece.x + dx, y: piece.y + dy };
      if (!collides(moved)) { piece = moved; return true; }
      return false;
    };

    const tryRotate = () => {
      const r = { ...piece, shape: rotate(piece.shape) };
      if (!collides(r)) { piece = r; play("tap"); return; }
      for (const dx of [-1, 1, -2, 2]) {
        const k = { ...r, x: r.x + dx };
        if (!collides(k)) { piece = k; play("tap"); return; }
      }
    };

    const hardDrop = () => {
      if (s.over) return;
      const gy = ghostY(piece, board);
      piece = { ...piece, y: gy };
      lock();
      draw();
    };

    apiRef.current = {
      left:   () => { if (!s.over && !pausedRef.current) { tryMove(-1, 0); play("move"); draw(); } },
      right:  () => { if (!s.over && !pausedRef.current) { tryMove(1, 0); play("move"); draw(); } },
      rotate: () => { if (!s.over && !pausedRef.current) { tryRotate(); draw(); } },
      soft:   () => { if (!s.over && !pausedRef.current) { if (!tryMove(0, 1)) lock(); draw(); } },
      hard:   () => { if (!s.over && !pausedRef.current) { hardDrop(); } },
    };

    const onKey = (e: KeyboardEvent) => {
      if (!apiRef.current) return;
      const a = apiRef.current;
      switch (e.key) {
        case "ArrowLeft":  a.left();   e.preventDefault(); break;
        case "ArrowRight": a.right();  e.preventDefault(); break;
        case "ArrowUp":    a.rotate(); e.preventDefault(); break;
        case "ArrowDown":  a.soft();   e.preventDefault(); break;
        case " ":          a.hard();   e.preventDefault(); break;
        case "a": case "A": a.left();  break;
        case "d": case "D": a.right(); break;
        case "w": case "W": a.rotate(); break;
        case "s": case "S": a.soft();  break;
      }
    };
    window.addEventListener("keydown", onKey);

    function draw() {
      ctx.fillStyle = "#0f172a";
      ctx.fillRect(0, 0, PW, PH);

      // Grid
      ctx.strokeStyle = "#1e293b";
      ctx.lineWidth = 0.5;
      for (let r = 0; r <= ROWS; r++) {
        ctx.beginPath(); ctx.moveTo(0, r * CELL); ctx.lineTo(PW, r * CELL); ctx.stroke();
      }
      for (let c = 0; c <= COLS; c++) {
        ctx.beginPath(); ctx.moveTo(c * CELL, 0); ctx.lineTo(c * CELL, PH); ctx.stroke();
      }

      // Board cells
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
        if (!board[r][c]) continue;
        ctx.fillStyle = COLORS[board[r][c] - 1];
        ctx.fillRect(c * CELL + 1, r * CELL + 1, CELL - 2, CELL - 2);
        // highlight
        ctx.fillStyle = "rgba(255,255,255,0.15)";
        ctx.fillRect(c * CELL + 1, r * CELL + 1, CELL - 2, 3);
      }

      // Ghost piece
      const gy = ghostY(piece, board);
      if (gy !== piece.y) {
        ctx.fillStyle = "rgba(255,255,255,0.1)";
        for (let r = 0; r < piece.shape.length; r++)
          for (let c = 0; c < piece.shape[r].length; c++)
            if (piece.shape[r][c] && gy + r >= 0)
              ctx.fillRect((piece.x + c) * CELL + 1, (gy + r) * CELL + 1, CELL - 2, CELL - 2);
      }

      // Active piece
      ctx.fillStyle = COLORS[piece.color - 1];
      for (let r = 0; r < piece.shape.length; r++)
        for (let c = 0; c < piece.shape[r].length; c++)
          if (piece.shape[r][c] && piece.y + r >= 0) {
            ctx.fillRect((piece.x + c) * CELL + 1, (piece.y + r) * CELL + 1, CELL - 2, CELL - 2);
            ctx.fillStyle = "rgba(255,255,255,0.2)";
            ctx.fillRect((piece.x + c) * CELL + 1, (piece.y + r) * CELL + 1, CELL - 2, 3);
            ctx.fillStyle = COLORS[piece.color - 1];
          }
    }

    draw();
    let last = 0, raf = 0;
    const loop = (t: number) => {
      if (s.over) return;
      const dropInterval = Math.max(80, (DROP_MS[difficulty] ?? 500) - (s.level - 1) * 40);
      if (!pausedRef.current && t - last > dropInterval) {
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [difficulty]);

  const Btn = useCallback(({ label, fn, className = "" }: { label: string; fn: () => void; className?: string }) => (
    <button
      type="button"
      onPointerDown={(e) => { e.preventDefault(); fn(); }}
      className={`rounded-lg bg-neutral-800 text-white font-bold hover:bg-neutral-700 active:scale-90 transition-transform touch-none select-none ${className}`}
    >
      {label}
    </button>
  ), []);

  return (
    <div className="flex flex-col items-center gap-1 select-none">
      {/* Score row */}
      <div className="flex gap-6 text-xs font-semibold text-foreground">
        <span>Score: {score}</span>
        <span>Lines: {lines}</span>
        <span>Level: {level}</span>
      </div>

      {/* Play area + side buttons */}
      <div className="flex items-stretch gap-1">
        {/* Left buttons: ◀ and ⟳ */}
        <div className="flex flex-col gap-1 justify-center">
          <Btn label="⟳" fn={() => apiRef.current?.rotate()} className="w-12 h-16 text-xl" />
          <Btn label="◀" fn={() => apiRef.current?.left()} className="w-12 h-16 text-xl" />
        </div>

        {/* Canvas */}
        <canvas
          ref={canvasRef}
          width={PW}
          height={PH}
          className="rounded border border-neutral-700 touch-none"
        />

        {/* Right buttons: ▶ ▼ ⤓ */}
        <div className="flex flex-col gap-1 justify-center">
          <Btn label="▶" fn={() => apiRef.current?.right()} className="w-12 h-10 text-xl" />
          <Btn label="▼" fn={() => apiRef.current?.soft()} className="w-12 h-10 text-xl" />
          <Btn label="⤓" fn={() => apiRef.current?.hard()} className="w-12 h-12 text-2xl" />
        </div>
      </div>

      <p className="text-xs text-muted-foreground">Arrows/WASD · Space = hard drop</p>
    </div>
  );
}
