"use client";

/**
 * Snake — classic arcade. Arrow keys / WASD or swipe / on-screen D-pad to steer.
 * Eating food grows the snake; hitting a wall or yourself ends the run.
 * Score = food eaten × 10.  Difficulty controls speed.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import type { GameEngineProps } from "@/components/games/types";
import { useGameSound } from "@/components/games/useGameSound";

const CELLS = 20;
const SIZE = 340;
const CELL = SIZE / CELLS;

// Difficulty → tick interval in ms (lower = faster)
const TICK_MS: Record<string, number> = { easy: 260, medium: 180, hard: 110 };

type Pt = { x: number; y: number };

export default function SnakeGame({ onReady, onGameOver, onScore, difficulty = "medium", paused, soundEnabled = true }: GameEngineProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [score, setScore] = useState(0);
  const [over, setOver] = useState(false);
  const play = useGameSound(soundEnabled ?? true);
  const pausedRef = useRef(paused);

  useEffect(() => { pausedRef.current = paused; }, [paused]);

  const dirRef = useRef<{ fn: (x: number, y: number) => void }>({ fn: () => {} });

  useEffect(() => {
    onReady?.();
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;

    const state = {
      snake: [{ x: 10, y: 10 }, { x: 9, y: 10 }, { x: 8, y: 10 }] as Pt[],
      dir: { x: 1, y: 0 } as Pt,
      nextDir: { x: 1, y: 0 } as Pt,
      food: { x: 15, y: 10 } as Pt,
      over: false,
      score: 0,
    };

    const setDir = (x: number, y: number) => {
      const d = state.dir;
      if (d.x === -x && d.y === -y) return; // no 180°
      state.nextDir = { x, y };
    };

    dirRef.current.fn = setDir;

    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === "arrowup" || k === "w")    { setDir(0, -1); e.preventDefault(); }
      else if (k === "arrowdown" || k === "s")  { setDir(0, 1);  e.preventDefault(); }
      else if (k === "arrowleft" || k === "a")  { setDir(-1, 0); e.preventDefault(); }
      else if (k === "arrowright" || k === "d") { setDir(1, 0);  e.preventDefault(); }
    };
    window.addEventListener("keydown", onKey);

    let touchStart: Pt | null = null;
    const onTouchStart = (e: TouchEvent) => {
      touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    };
    const onTouchMove = (e: TouchEvent) => {
      if (!touchStart) return;
      const dx = e.touches[0].clientX - touchStart.x;
      const dy = e.touches[0].clientY - touchStart.y;
      if (Math.abs(dx) < 12 && Math.abs(dy) < 12) return;
      if (Math.abs(dx) > Math.abs(dy)) setDir(dx > 0 ? 1 : -1, 0);
      else setDir(0, dy > 0 ? 1 : -1);
      touchStart = null;
      e.preventDefault();
    };
    canvas.addEventListener("touchstart", onTouchStart, { passive: true });
    canvas.addEventListener("touchmove", onTouchMove, { passive: false });

    const placeFood = () => {
      let f: Pt;
      do {
        f = { x: Math.floor(Math.random() * CELLS), y: Math.floor(Math.random() * CELLS) };
      } while (state.snake.some((p) => p.x === f.x && p.y === f.y));
      state.food = f;
    };

    const draw = () => {
      ctx.fillStyle = "#0f172a";
      ctx.fillRect(0, 0, SIZE, SIZE);

      // Grid lines (subtle)
      ctx.strokeStyle = "#1e293b";
      ctx.lineWidth = 0.5;
      for (let i = 0; i <= CELLS; i++) {
        ctx.beginPath(); ctx.moveTo(i * CELL, 0); ctx.lineTo(i * CELL, SIZE); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, i * CELL); ctx.lineTo(SIZE, i * CELL); ctx.stroke();
      }

      // Food with glow
      ctx.shadowColor = "#ef4444";
      ctx.shadowBlur = 8;
      ctx.fillStyle = "#ef4444";
      const fx = state.food.x * CELL + CELL / 2;
      const fy = state.food.y * CELL + CELL / 2;
      ctx.beginPath();
      ctx.arc(fx, fy, (CELL - 2) / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;

      // Snake
      state.snake.forEach((p, i) => {
        const t = 1 - i / state.snake.length;
        const green = Math.round(100 + 100 * t);
        ctx.fillStyle = i === 0 ? "#22c55e" : `rgb(${Math.round(20 * t)},${green},${Math.round(40 * t)})`;
        const pad = i === 0 ? 1 : 2;
        ctx.beginPath();
        ctx.roundRect(p.x * CELL + pad, p.y * CELL + pad, CELL - pad * 2, CELL - pad * 2, i === 0 ? 4 : 2);
        ctx.fill();
      });

      // Eyes on head
      const head = state.snake[0];
      ctx.fillStyle = "#0f172a";
      const ex = head.x * CELL + CELL / 2;
      const ey = head.y * CELL + CELL / 2;
      const offset = CELL * 0.18;
      const eyeDir = { x: state.dir.x * offset, y: state.dir.y * offset };
      const perp = { x: -state.dir.y * offset * 0.7, y: state.dir.x * offset * 0.7 };
      ctx.beginPath();
      ctx.arc(ex + eyeDir.x + perp.x, ey + eyeDir.y + perp.y, 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(ex + eyeDir.x - perp.x, ey + eyeDir.y - perp.y, 2, 0, Math.PI * 2);
      ctx.fill();
    };

    const tick = () => {
      if (state.over || pausedRef.current) return;
      state.dir = state.nextDir;
      const head = { x: state.snake[0].x + state.dir.x, y: state.snake[0].y + state.dir.y };
      if (
        head.x < 0 || head.y < 0 || head.x >= CELLS || head.y >= CELLS ||
        state.snake.some((p) => p.x === head.x && p.y === head.y)
      ) {
        state.over = true;
        play("lose");
        setOver(true);
        onGameOver(state.score);
        // Draw dead state
        ctx.fillStyle = "rgba(239,68,68,0.2)";
        ctx.fillRect(0, 0, SIZE, SIZE);
        ctx.fillStyle = "#ef4444";
        ctx.font = `bold ${CELL * 1.5}px sans-serif`;
        ctx.textAlign = "center";
        ctx.fillText("Game Over", SIZE / 2, SIZE / 2);
        return;
      }
      state.snake.unshift(head);
      if (head.x === state.food.x && head.y === state.food.y) {
        state.score += 10;
        setScore(state.score);
        onScore?.(state.score);
        play("match");
        placeFood();
      } else {
        state.snake.pop();
      }
      draw();
    };

    draw();
    const tickMs = TICK_MS[difficulty] ?? 180;
    const id = setInterval(tick, tickMs);
    return () => {
      clearInterval(id);
      window.removeEventListener("keydown", onKey);
      canvas.removeEventListener("touchstart", onTouchStart);
      canvas.removeEventListener("touchmove", onTouchMove);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [difficulty]);

  const steer = useCallback((x: number, y: number) => {
    dirRef.current.fn(x, y);
  }, []);

  return (
    <div className="flex flex-col items-center gap-2 select-none">
      <div className="text-sm font-semibold text-foreground">Score: {score}</div>
      <canvas
        ref={canvasRef}
        width={SIZE}
        height={SIZE}
        className="rounded-lg border border-neutral-700 touch-none"
        style={{ maxWidth: "min(340px, calc(100vw - 32px))", aspectRatio: "1" }}
      />
      {/* D-pad for mobile */}
      <div className="grid grid-cols-3 gap-1 w-36">
        <div />
        <button type="button" onClick={() => steer(0, -1)}
          className="h-12 rounded-lg bg-neutral-800 text-white font-bold text-lg hover:bg-neutral-700 active:scale-90 transition-transform">▲</button>
        <div />
        <button type="button" onClick={() => steer(-1, 0)}
          className="h-12 rounded-lg bg-neutral-800 text-white font-bold text-lg hover:bg-neutral-700 active:scale-90 transition-transform">◀</button>
        <button type="button" onClick={() => steer(0, 1)}
          className="h-12 rounded-lg bg-neutral-800 text-white font-bold text-lg hover:bg-neutral-700 active:scale-90 transition-transform">▼</button>
        <button type="button" onClick={() => steer(1, 0)}
          className="h-12 rounded-lg bg-neutral-800 text-white font-bold text-lg hover:bg-neutral-700 active:scale-90 transition-transform">▶</button>
      </div>
      <p className="text-xs text-muted-foreground">Arrow keys / WASD, swipe, or D-pad to steer.</p>
    </div>
  );
}
