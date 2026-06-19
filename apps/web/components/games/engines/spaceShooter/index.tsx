"use client";

/**
 * Star Blaster — arcade space shooter. Move with arrow keys / A-D or drag; fire
 * with space or tap. Destroy asteroids (+20). A rock reaching the bottom or
 * hitting your ship ends the run.
 */

import { useEffect, useRef, useState } from "react";
import type { GameEngineProps } from "@/components/games/types";

const W = 320;
const H = 460;
const SHIP_W = 30;
const SHIP_H = 24;

type Rock = { x: number; y: number; r: number; vy: number };
type Bullet = { x: number; y: number };

export default function SpaceShooterGame({ onReady, onGameOver, onScore }: GameEngineProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [score, setScore] = useState(0);

  useEffect(() => {
    onReady?.();
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;

    const s = {
      x: W / 2, rocks: [] as Rock[], bullets: [] as Bullet[],
      score: 0, spawn: 0, cooldown: 0, over: false,
      left: false, right: false,
    };

    const fire = () => {
      if (s.cooldown <= 0) {
        s.bullets.push({ x: s.x, y: H - SHIP_H - 14 });
        s.cooldown = 10;
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === "arrowleft" || k === "a") s.left = true;
      if (k === "arrowright" || k === "d") s.right = true;
      if (k === " " || k === "spacebar") { fire(); e.preventDefault(); }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === "arrowleft" || k === "a") s.left = false;
      if (k === "arrowright" || k === "d") s.right = false;
    };
    const aim = (clientX: number) => {
      const rect = canvas.getBoundingClientRect();
      s.x = Math.max(SHIP_W / 2, Math.min(W - SHIP_W / 2, ((clientX - rect.left) / rect.width) * W));
    };
    const onTouch = (e: TouchEvent) => { aim(e.touches[0].clientX); fire(); e.preventDefault(); };
    const onMove = (e: TouchEvent) => { aim(e.touches[0].clientX); e.preventDefault(); };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    canvas.addEventListener("touchstart", onTouch, { passive: false });
    canvas.addEventListener("touchmove", onMove, { passive: false });

    const end = () => { if (!s.over) { s.over = true; onGameOver(s.score); } };

    let raf = 0;
    const loop = () => {
      if (s.over) return;
      if (s.left) s.x = Math.max(SHIP_W / 2, s.x - 5);
      if (s.right) s.x = Math.min(W - SHIP_W / 2, s.x + 5);
      if (s.cooldown > 0) s.cooldown -= 1;

      s.spawn -= 1;
      if (s.spawn <= 0) {
        const r = 12 + Math.random() * 14;
        s.rocks.push({ x: r + Math.random() * (W - 2 * r), y: -r, r, vy: 1.5 + Math.random() * 1.5 + s.score / 1500 });
        s.spawn = Math.max(20, 60 - Math.floor(s.score / 100));
      }

      for (const b of s.bullets) b.y -= 7;
      s.bullets = s.bullets.filter((b) => b.y > -10);
      for (const rk of s.rocks) rk.y += rk.vy;

      // collisions
      for (const rk of s.rocks) {
        for (const b of s.bullets) {
          if (Math.hypot(b.x - rk.x, b.y - rk.y) < rk.r) {
            rk.y = H + 999; b.y = -999;
            s.score += 20; setScore(s.score); onScore?.(s.score);
          }
        }
        const shipY = H - SHIP_H - 8;
        if (rk.y + rk.r > shipY && Math.abs(rk.x - s.x) < rk.r + SHIP_W / 2) { end(); return; }
        if (rk.y - rk.r > H) { end(); return; }
      }
      s.rocks = s.rocks.filter((rk) => rk.y < H + 50);

      // draw
      ctx.fillStyle = "#0b1020"; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = "#cbd5e1";
      for (const b of s.bullets) ctx.fillRect(b.x - 1.5, b.y, 3, 8);
      for (const rk of s.rocks) {
        ctx.fillStyle = "#a16207";
        ctx.beginPath(); ctx.arc(rk.x, rk.y, rk.r, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = "#34d399";
      const sy = H - SHIP_H - 8;
      ctx.beginPath();
      ctx.moveTo(s.x, sy);
      ctx.lineTo(s.x - SHIP_W / 2, sy + SHIP_H);
      ctx.lineTo(s.x + SHIP_W / 2, sy + SHIP_H);
      ctx.closePath(); ctx.fill();

      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      canvas.removeEventListener("touchstart", onTouch);
      canvas.removeEventListener("touchmove", onMove);
    };
  }, [onGameOver, onReady, onScore]);

  return (
    <div className="flex flex-col items-center gap-2 select-none">
      <div className="text-sm font-semibold text-neutral-200">Score: {score}</div>
      <canvas ref={canvasRef} width={W} height={H} className="rounded-lg border border-neutral-700 touch-none max-w-full" />
      <p className="text-xs text-neutral-400">Arrow keys / A-D to move, Space to fire. Tap to move + shoot.</p>
    </div>
  );
}
