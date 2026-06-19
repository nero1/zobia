"use client";

/**
 * Breakout — bounce the ball off the paddle to smash every brick. Move with
 * arrow keys / mouse / touch. Each brick is 10 points; clearing the board wins
 * a bonus. Lose all 3 balls and the game ends.
 */

import { useEffect, useRef, useState } from "react";
import type { GameEngineProps } from "@/components/games/types";

const W = 360;
const H = 420;
const PADDLE_W = 70;
const PADDLE_H = 10;
const BALL_R = 6;
const ROWS = 5;
const COLS = 8;
const BRICK_H = 16;
const GAP = 4;

export default function BreakoutGame({ onReady, onGameOver, onScore }: GameEngineProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [score, setScore] = useState(0);

  useEffect(() => {
    onReady?.();
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    const brickW = (W - GAP * (COLS + 1)) / COLS;

    const bricks: boolean[][] = Array.from({ length: ROWS }, () => Array(COLS).fill(true));
    let remaining = ROWS * COLS;
    const s = {
      paddleX: W / 2 - PADDLE_W / 2,
      bx: W / 2, by: H - 40, vx: 3, vy: -3,
      lives: 3, score: 0, over: false,
    };

    const movePaddle = (clientX: number) => {
      const rect = canvas.getBoundingClientRect();
      const x = ((clientX - rect.left) / rect.width) * W;
      s.paddleX = Math.max(0, Math.min(W - PADDLE_W, x - PADDLE_W / 2));
    };
    const onMouse = (e: MouseEvent) => movePaddle(e.clientX);
    const onTouch = (e: TouchEvent) => { movePaddle(e.touches[0].clientX); e.preventDefault(); };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") s.paddleX = Math.max(0, s.paddleX - 24);
      if (e.key === "ArrowRight") s.paddleX = Math.min(W - PADDLE_W, s.paddleX + 24);
    };
    canvas.addEventListener("mousemove", onMouse);
    canvas.addEventListener("touchmove", onTouch, { passive: false });
    window.addEventListener("keydown", onKey);

    const endGame = () => {
      if (s.over) return;
      s.over = true;
      onGameOver(s.score);
    };

    let raf = 0;
    const loop = () => {
      if (s.over) return;
      s.bx += s.vx; s.by += s.vy;
      if (s.bx < BALL_R || s.bx > W - BALL_R) s.vx *= -1;
      if (s.by < BALL_R) s.vy *= -1;

      // paddle
      if (
        s.by + BALL_R >= H - 20 && s.by + BALL_R <= H - 20 + PADDLE_H &&
        s.bx >= s.paddleX && s.bx <= s.paddleX + PADDLE_W && s.vy > 0
      ) {
        s.vy *= -1;
        s.vx += ((s.bx - (s.paddleX + PADDLE_W / 2)) / (PADDLE_W / 2)) * 1.5;
      }

      // bottom -> lose life
      if (s.by > H) {
        s.lives -= 1;
        if (s.lives <= 0) { endGame(); return; }
        s.bx = W / 2; s.by = H - 40; s.vx = 3; s.vy = -3;
      }

      // bricks
      outer: for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          if (!bricks[r][c]) continue;
          const bx = GAP + c * (brickW + GAP);
          const by = GAP + r * (BRICK_H + GAP) + 30;
          if (s.bx > bx && s.bx < bx + brickW && s.by > by && s.by < by + BRICK_H) {
            bricks[r][c] = false;
            remaining -= 1;
            s.vy *= -1;
            s.score += 10;
            setScore(s.score);
            onScore?.(s.score);
            if (remaining === 0) { s.score += 100; setScore(s.score); endGame(); return; }
            break outer;
          }
        }
      }

      // draw
      ctx.fillStyle = "#0f172a"; ctx.fillRect(0, 0, W, H);
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          if (!bricks[r][c]) continue;
          ctx.fillStyle = ["#f97316", "#eab308", "#22c55e", "#06b6d4", "#a855f7"][r % 5];
          ctx.fillRect(GAP + c * (brickW + GAP), GAP + r * (BRICK_H + GAP) + 30, brickW, BRICK_H);
        }
      }
      ctx.fillStyle = "#e2e8f0";
      ctx.fillRect(s.paddleX, H - 20, PADDLE_W, PADDLE_H);
      ctx.beginPath();
      ctx.arc(s.bx, s.by, BALL_R, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#94a3b8";
      ctx.font = "12px sans-serif";
      ctx.fillText(`Lives: ${s.lives}`, 8, 20);

      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      canvas.removeEventListener("mousemove", onMouse);
      canvas.removeEventListener("touchmove", onTouch);
      window.removeEventListener("keydown", onKey);
    };
  }, [onGameOver, onReady, onScore]);

  return (
    <div className="flex flex-col items-center gap-2 select-none">
      <div className="text-sm font-semibold text-neutral-200">Score: {score}</div>
      <canvas ref={canvasRef} width={W} height={H} className="rounded-lg border border-neutral-700 touch-none max-w-full" />
      <p className="text-xs text-neutral-400">Move with mouse, touch, or arrow keys.</p>
    </div>
  );
}
