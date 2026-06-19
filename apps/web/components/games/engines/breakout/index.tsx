"use client";

/**
 * Breakout (Brick Buster) — bounce the ball off the paddle to smash every brick.
 * Move with mouse / touch / arrow keys. Each brick = 10 pts; clearing the board
 * grants a +100 bonus. Lose all 3 balls and the game ends.
 * Supports: difficulty (ball speed), paused, soundEnabled.
 */

import { useEffect, useRef, useState } from "react";
import type { GameEngineProps } from "@/components/games/types";
import { useGameSound } from "@/components/games/useGameSound";

const W = 360;
const H = 420;
const PADDLE_W = 70;
const PADDLE_H = 10;
const BALL_R = 6;
const ROWS = 5;
const COLS = 8;
const BRICK_H = 16;
const GAP = 4;

// Difficulty → ball speed multiplier
const SPEED: Record<string, number> = { easy: 2.5, medium: 3.5, hard: 5.0 };

export default function BreakoutGame({ onReady, onGameOver, onScore, difficulty = "medium", paused, soundEnabled = true }: GameEngineProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [score, setScore] = useState(0);
  const [lives, setLives] = useState(3);
  const pausedRef = useRef(paused);
  const play = useGameSound(soundEnabled ?? true);

  useEffect(() => { pausedRef.current = paused; }, [paused]);

  useEffect(() => {
    onReady?.();
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    const brickW = (W - GAP * (COLS + 1)) / COLS;
    const speed = SPEED[difficulty] ?? 3.5;

    const bricks: boolean[][] = Array.from({ length: ROWS }, () => Array(COLS).fill(true));
    let remaining = ROWS * COLS;
    const s = {
      paddleX: W / 2 - PADDLE_W / 2,
      bx: W / 2,
      by: H - 60,
      vx: speed * 0.7,
      vy: -speed,
      lives: 3,
      score: 0,
      over: false,
    };

    const movePaddle = (clientX: number) => {
      const rect = canvas.getBoundingClientRect();
      const x = ((clientX - rect.left) / rect.width) * W;
      s.paddleX = Math.max(0, Math.min(W - PADDLE_W, x - PADDLE_W / 2));
    };
    const onMouse = (e: MouseEvent) => movePaddle(e.clientX);
    const onTouch = (e: TouchEvent) => { movePaddle(e.touches[0].clientX); e.preventDefault(); };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft")  { s.paddleX = Math.max(0, s.paddleX - 28); e.preventDefault(); }
      if (e.key === "ArrowRight") { s.paddleX = Math.min(W - PADDLE_W, s.paddleX + 28); e.preventDefault(); }
    };
    canvas.addEventListener("mousemove", onMouse);
    canvas.addEventListener("touchmove", onTouch, { passive: false });
    window.addEventListener("keydown", onKey);

    const endGame = () => {
      if (s.over) return;
      s.over = true;
      play("lose");
      onGameOver(s.score);
    };

    const BRICK_COLORS = ["#f97316","#eab308","#22c55e","#06b6d4","#a855f7"];

    let raf = 0;
    const loop = () => {
      if (s.over) return;

      if (!pausedRef.current) {
        s.bx += s.vx;
        s.by += s.vy;

        // Wall bounces
        if (s.bx < BALL_R)      { s.bx = BALL_R;      s.vx *= -1; play("tap"); }
        if (s.bx > W - BALL_R)  { s.bx = W - BALL_R;  s.vx *= -1; play("tap"); }
        if (s.by < BALL_R)      { s.by = BALL_R;       s.vy *= -1; play("tap"); }

        // Paddle
        const paddleY = H - 20;
        if (
          s.by + BALL_R >= paddleY &&
          s.by + BALL_R <= paddleY + PADDLE_H &&
          s.bx >= s.paddleX &&
          s.bx <= s.paddleX + PADDLE_W &&
          s.vy > 0
        ) {
          s.vy = -Math.abs(s.vy);
          const rel = (s.bx - (s.paddleX + PADDLE_W / 2)) / (PADDLE_W / 2);
          s.vx = rel * speed * 0.8;
          play("score");
        }

        // Bottom → lose life
        if (s.by > H) {
          s.lives -= 1;
          setLives(s.lives);
          play("miss");
          if (s.lives <= 0) { endGame(); return; }
          s.bx = W / 2; s.by = H - 60;
          s.vx = speed * 0.7 * (Math.random() > 0.5 ? 1 : -1);
          s.vy = -speed;
        }

        // Bricks
        outer: for (let r = 0; r < ROWS; r++) {
          for (let c = 0; c < COLS; c++) {
            if (!bricks[r][c]) continue;
            const bx = GAP + c * (brickW + GAP);
            const by = GAP + r * (BRICK_H + GAP) + 30;
            if (s.bx > bx && s.bx < bx + brickW && s.by > by && s.by < by + BRICK_H) {
              bricks[r][c] = false;
              remaining--;
              s.vy *= -1;
              s.score += 10;
              setScore(s.score);
              onScore?.(s.score);
              play("pop");
              if (remaining === 0) {
                s.score += 100;
                setScore(s.score);
                play("win");
                endGame();
                return;
              }
              break outer;
            }
          }
        }
      }

      // ── Draw ──
      ctx.fillStyle = "#0f172a";
      ctx.fillRect(0, 0, W, H);

      // Bricks
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          if (!bricks[r][c]) continue;
          const bx = GAP + c * (brickW + GAP);
          const by = GAP + r * (BRICK_H + GAP) + 30;
          ctx.fillStyle = BRICK_COLORS[r];
          ctx.beginPath();
          ctx.roundRect(bx, by, brickW, BRICK_H, 3);
          ctx.fill();
          // Shine
          ctx.fillStyle = "rgba(255,255,255,0.15)";
          ctx.fillRect(bx + 2, by + 2, brickW - 4, 3);
        }
      }

      // Paddle
      ctx.fillStyle = "#e2e8f0";
      ctx.beginPath();
      ctx.roundRect(s.paddleX, H - 20, PADDLE_W, PADDLE_H, 5);
      ctx.fill();

      // Ball with glow
      ctx.shadowColor = "#e2e8f0";
      ctx.shadowBlur = 8;
      ctx.fillStyle = "#e2e8f0";
      ctx.beginPath();
      ctx.arc(s.bx, s.by, BALL_R, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;

      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      canvas.removeEventListener("mousemove", onMouse);
      canvas.removeEventListener("touchmove", onTouch);
      window.removeEventListener("keydown", onKey);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [difficulty]);

  return (
    <div className="flex flex-col items-center gap-2 select-none">
      <div className="flex gap-4 text-sm font-semibold text-foreground">
        <span>Score: {score}</span>
        <span className="text-muted-foreground">Lives: {"❤️".repeat(lives)}</span>
      </div>
      <canvas
        ref={canvasRef}
        width={W}
        height={H}
        className="rounded-lg border border-neutral-700 touch-none max-w-full"
      />
      <p className="text-xs text-muted-foreground">Mouse / touch / arrow keys to move paddle.</p>
    </div>
  );
}
