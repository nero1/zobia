"use client";

/**
 * Snake — classic arcade. Arrow keys / WASD or swipe to steer. Eating food
 * grows the snake and adds 10 to the score; hitting a wall or yourself ends it.
 */

import { useEffect, useRef, useState } from "react";
import type { GameEngineProps } from "@/components/games/types";

const CELLS = 20;
const SIZE = 360;
const CELL = SIZE / CELLS;
const TICK_MS = 110;

type Pt = { x: number; y: number };

export default function SnakeGame({ onReady, onGameOver, onScore }: GameEngineProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [score, setScore] = useState(0);

  const state = useRef({
    snake: [{ x: 10, y: 10 }] as Pt[],
    dir: { x: 1, y: 0 } as Pt,
    nextDir: { x: 1, y: 0 } as Pt,
    food: { x: 15, y: 10 } as Pt,
    over: false,
    score: 0,
  });

  useEffect(() => {
    onReady?.();
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;

    const setDir = (x: number, y: number) => {
      const d = state.current.dir;
      if (d.x === -x && d.y === -y) return; // no 180° reversal
      state.current.nextDir = { x, y };
    };

    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === "arrowup" || k === "w") setDir(0, -1);
      else if (k === "arrowdown" || k === "s") setDir(0, 1);
      else if (k === "arrowleft" || k === "a") setDir(-1, 0);
      else if (k === "arrowright" || k === "d") setDir(1, 0);
    };
    window.addEventListener("keydown", onKey);

    let touchStart: Pt | null = null;
    const canvas = canvasRef.current!;
    const onTouchStart = (e: TouchEvent) => {
      touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    };
    const onTouchMove = (e: TouchEvent) => {
      if (!touchStart) return;
      const dx = e.touches[0].clientX - touchStart.x;
      const dy = e.touches[0].clientY - touchStart.y;
      if (Math.abs(dx) < 20 && Math.abs(dy) < 20) return;
      if (Math.abs(dx) > Math.abs(dy)) setDir(dx > 0 ? 1 : -1, 0);
      else setDir(0, dy > 0 ? 1 : -1);
      touchStart = null;
      e.preventDefault();
    };
    canvas.addEventListener("touchstart", onTouchStart, { passive: true });
    canvas.addEventListener("touchmove", onTouchMove, { passive: false });

    const placeFood = () => {
      const s = state.current;
      let f: Pt;
      do {
        f = { x: Math.floor(Math.random() * CELLS), y: Math.floor(Math.random() * CELLS) };
      } while (s.snake.some((p) => p.x === f.x && p.y === f.y));
      s.food = f;
    };

    const draw = () => {
      const s = state.current;
      ctx.fillStyle = "#0f172a";
      ctx.fillRect(0, 0, SIZE, SIZE);
      ctx.fillStyle = "#ef4444";
      ctx.fillRect(s.food.x * CELL, s.food.y * CELL, CELL - 1, CELL - 1);
      s.snake.forEach((p, i) => {
        ctx.fillStyle = i === 0 ? "#22c55e" : "#4ade80";
        ctx.fillRect(p.x * CELL, p.y * CELL, CELL - 1, CELL - 1);
      });
    };

    const tick = () => {
      const s = state.current;
      if (s.over) return;
      s.dir = s.nextDir;
      const head = { x: s.snake[0].x + s.dir.x, y: s.snake[0].y + s.dir.y };
      if (
        head.x < 0 || head.y < 0 || head.x >= CELLS || head.y >= CELLS ||
        s.snake.some((p) => p.x === head.x && p.y === head.y)
      ) {
        s.over = true;
        onGameOver(s.score);
        return;
      }
      s.snake.unshift(head);
      if (head.x === s.food.x && head.y === s.food.y) {
        s.score += 10;
        setScore(s.score);
        onScore?.(s.score);
        placeFood();
      } else {
        s.snake.pop();
      }
      draw();
    };

    draw();
    const id = setInterval(tick, TICK_MS);
    return () => {
      clearInterval(id);
      window.removeEventListener("keydown", onKey);
      canvas.removeEventListener("touchstart", onTouchStart);
      canvas.removeEventListener("touchmove", onTouchMove);
    };
  }, [onGameOver, onReady, onScore]);

  return (
    <div className="flex flex-col items-center gap-2 select-none">
      <div className="text-sm font-semibold text-neutral-200">Score: {score}</div>
      <canvas
        ref={canvasRef}
        width={SIZE}
        height={SIZE}
        className="rounded-lg border border-neutral-700 touch-none max-w-full"
      />
      <p className="text-xs text-neutral-400">Arrow keys / WASD or swipe to steer.</p>
    </div>
  );
}
