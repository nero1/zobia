"use client";

/**
 * Speed Dodge — endless lane-dodging racer. Steer left/right with arrow keys /
 * A-D or by tapping the left/right half of the track. Survive oncoming traffic;
 * score climbs with distance and speeds up over time. One crash ends the run.
 */

import { useEffect, useRef, useState } from "react";
import type { GameEngineProps } from "@/components/games/types";

const W = 300;
const H = 460;
const LANES = 3;
const LANE_W = W / LANES;
const CAR_W = 44;
const CAR_H = 70;

type Obs = { lane: number; y: number };

export default function CarRacingGame({ onReady, onGameOver, onScore }: GameEngineProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [score, setScore] = useState(0);

  useEffect(() => {
    onReady?.();
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;

    const s = {
      lane: 1, obstacles: [] as Obs[], speed: 3, score: 0,
      dash: 0, spawnTimer: 0, over: false,
    };

    const move = (dir: -1 | 1) => {
      s.lane = Math.max(0, Math.min(LANES - 1, s.lane + dir));
    };
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === "arrowleft" || k === "a") move(-1);
      if (k === "arrowright" || k === "d") move(1);
    };
    const onTap = (clientX: number) => {
      const rect = canvas.getBoundingClientRect();
      move(clientX - rect.left < rect.width / 2 ? -1 : 1);
    };
    const onClick = (e: MouseEvent) => onTap(e.clientX);
    const onTouch = (e: TouchEvent) => { onTap(e.touches[0].clientX); e.preventDefault(); };
    window.addEventListener("keydown", onKey);
    canvas.addEventListener("click", onClick);
    canvas.addEventListener("touchstart", onTouch, { passive: false });

    const laneX = (lane: number) => lane * LANE_W + LANE_W / 2 - CAR_W / 2;

    let raf = 0;
    const loop = () => {
      if (s.over) return;
      s.spawnTimer -= 1;
      if (s.spawnTimer <= 0) {
        s.obstacles.push({ lane: Math.floor(Math.random() * LANES), y: -CAR_H });
        s.spawnTimer = Math.max(18, 50 - Math.floor(s.score / 200));
      }
      s.speed = 3 + s.score / 600;
      for (const o of s.obstacles) o.y += s.speed;
      s.obstacles = s.obstacles.filter((o) => o.y < H + CAR_H);

      const playerY = H - CAR_H - 12;
      for (const o of s.obstacles) {
        if (o.lane === s.lane) {
          const oy = o.y;
          if (oy + CAR_H > playerY && oy < playerY + CAR_H) {
            s.over = true;
            onGameOver(s.score);
            return;
          }
        }
      }

      s.score += 1;
      if (s.score % 5 === 0) { setScore(s.score); onScore?.(s.score); }

      // draw road
      ctx.fillStyle = "#1f2937"; ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = "#475569"; ctx.lineWidth = 2;
      s.dash = (s.dash + s.speed) % 40;
      for (let l = 1; l < LANES; l++) {
        for (let y = -40 + s.dash; y < H; y += 40) {
          ctx.beginPath(); ctx.moveTo(l * LANE_W, y); ctx.lineTo(l * LANE_W, y + 20); ctx.stroke();
        }
      }
      // obstacles
      for (const o of s.obstacles) {
        ctx.fillStyle = "#ef4444";
        roundRect(ctx, laneX(o.lane), o.y, CAR_W, CAR_H, 8); ctx.fill();
      }
      // player
      ctx.fillStyle = "#38bdf8";
      roundRect(ctx, laneX(s.lane), playerY, CAR_W, CAR_H, 8); ctx.fill();

      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onKey);
      canvas.removeEventListener("click", onClick);
      canvas.removeEventListener("touchstart", onTouch);
    };
  }, [onGameOver, onReady, onScore]);

  return (
    <div className="flex flex-col items-center gap-2 select-none">
      <div className="text-sm font-semibold text-neutral-200">Score: {score}</div>
      <canvas ref={canvasRef} width={W} height={H} className="rounded-lg border border-neutral-700 touch-none max-w-full" />
      <p className="text-xs text-neutral-400">Arrow keys / A-D, or tap left/right to steer.</p>
    </div>
  );
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
