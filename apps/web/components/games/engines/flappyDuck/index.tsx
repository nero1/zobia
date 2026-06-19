"use client";

/**
 * Flappy Duck — tap to flap through pipe gaps. One hit ends the run.
 * Canvas-based with gentle wing animation.
 */

import { useEffect, useRef, useState } from "react";
import type { GameEngineProps } from "@/components/games/types";
import { useGameSound } from "@/components/games/useGameSound";

const W = 320, H = 480;
const GRAVITY_MAP: Record<string, number> = { easy: 0.28, medium: 0.38, hard: 0.50 };
const FLAP_MAP:    Record<string, number> = { easy: -5.5, medium: -7, hard: -8.5 };
const SPEED_MAP:   Record<string, number> = { easy: 1.8,  medium: 2.5, hard: 3.5 };
const GAP_MAP:     Record<string, number> = { easy: 160,  medium: 130, hard: 105 };

interface Pipe { x: number; topH: number }

export default function FlappyDuckGame({ onReady, onGameOver, onScore, difficulty = "medium", paused, soundEnabled = true }: GameEngineProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [score, setScore] = useState(0);
  const [started, setStarted] = useState(false);
  const play = useGameSound(soundEnabled ?? true);

  useEffect(() => {
    onReady?.();
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    const GRAVITY = GRAVITY_MAP[difficulty] ?? 0.38;
    const FLAP = FLAP_MAP[difficulty] ?? -7;
    const SPEED = SPEED_MAP[difficulty] ?? 2.5;
    const GAP = GAP_MAP[difficulty] ?? 130;

    const s = {
      y: H / 2, vy: 0,
      pipes: [] as Pipe[],
      score: 0, frame: 0, over: false, started: false,
      wing: 0,
    };

    const flap = () => {
      if (s.over) return;
      if (!s.started) s.started = true;
      s.vy = FLAP;
      play("tap");
    };

    const onKey = (e: KeyboardEvent) => { if (e.code === "Space" || e.code === "ArrowUp") { flap(); e.preventDefault(); } };
    const onTouch = (e: TouchEvent) => { flap(); e.preventDefault(); };
    const onClick = () => flap();
    window.addEventListener("keydown", onKey);
    canvas.addEventListener("touchstart", onTouch, { passive: false });
    canvas.addEventListener("click", onClick);

    const drawDuck = (y: number, wing: number) => {
      ctx.save();
      ctx.translate(80, y);
      // Body
      ctx.fillStyle = "#fbbf24";
      ctx.beginPath(); ctx.ellipse(0, 0, 18, 14, 0, 0, Math.PI * 2); ctx.fill();
      // Wing
      const wAngle = Math.sin(wing) * 0.5;
      ctx.fillStyle = "#f59e0b";
      ctx.save(); ctx.rotate(wAngle);
      ctx.beginPath(); ctx.ellipse(-4, 6, 12, 6, 0.4, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      // Beak
      ctx.fillStyle = "#f97316";
      ctx.beginPath(); ctx.moveTo(16, -2); ctx.lineTo(26, 0); ctx.lineTo(16, 4); ctx.closePath(); ctx.fill();
      // Eye
      ctx.fillStyle = "#1e293b";
      ctx.beginPath(); ctx.arc(10, -4, 3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "white";
      ctx.beginPath(); ctx.arc(11, -5, 1, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    };

    const drawPipe = (pipe: Pipe) => {
      const color = "#16a34a";
      const dark  = "#166534";
      // Top pipe
      ctx.fillStyle = color; ctx.fillRect(pipe.x, 0, 52, pipe.topH);
      ctx.fillStyle = dark;  ctx.fillRect(pipe.x - 4, pipe.topH - 24, 60, 24);
      // Bottom pipe
      const botY = pipe.topH + GAP;
      ctx.fillStyle = color; ctx.fillRect(pipe.x, botY, 52, H - botY);
      ctx.fillStyle = dark;  ctx.fillRect(pipe.x - 4, botY, 60, 24);
    };

    let raf = 0;
    const loop = () => {
      if (paused) { raf = requestAnimationFrame(loop); return; }
      if (s.over) return;
      s.frame++;
      s.wing += 0.25;

      if (s.started) {
        s.vy += GRAVITY;
        s.y += s.vy;
      }

      // Spawn pipes
      if (s.frame % Math.round(90 / (SPEED / 2.5)) === 0) {
        const topH = 60 + Math.random() * (H - GAP - 120);
        s.pipes.push({ x: W, topH });
      }

      for (const p of s.pipes) p.x -= SPEED;
      s.pipes = s.pipes.filter((p) => p.x > -60);

      // Score: passed a pipe
      for (const p of s.pipes) {
        if (Math.abs(p.x - 80 + SPEED) < SPEED + 1) {
          s.score++;
          setScore(s.score);
          onScore?.(s.score);
          play("score");
        }
      }

      // Collision: floor/ceiling
      if (s.y - 14 < 0 || s.y + 14 > H) {
        s.over = true; play("lose"); onGameOver(s.score); return;
      }

      // Pipe collision
      for (const p of s.pipes) {
        if (p.x < 80 + 18 && p.x + 52 > 80 - 18) {
          if (s.y - 14 < p.topH || s.y + 14 > p.topH + GAP) {
            s.over = true; play("lose"); onGameOver(s.score); return;
          }
        }
      }

      // Draw
      ctx.fillStyle = "#0c1a2e"; ctx.fillRect(0, 0, W, H);
      // Stars
      ctx.fillStyle = "rgba(255,255,255,0.4)";
      for (let i = 0; i < 20; i++) {
        ctx.fillRect((i * 53 + s.frame * 0.3) % W, (i * 37) % (H * 0.6), 1.5, 1.5);
      }
      // Ground
      ctx.fillStyle = "#451a03"; ctx.fillRect(0, H - 20, W, 20);
      ctx.fillStyle = "#78350f"; ctx.fillRect(0, H - 20, W, 4);

      s.pipes.forEach(drawPipe);
      drawDuck(s.y, s.wing);

      if (!s.started) {
        ctx.fillStyle = "rgba(255,255,255,0.7)";
        ctx.font = "bold 16px system-ui";
        ctx.textAlign = "center";
        ctx.fillText("Tap or press Space to start", W / 2, H / 2 - 10);
        ctx.textAlign = "left";
      }

      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onKey);
      canvas.removeEventListener("touchstart", onTouch);
      canvas.removeEventListener("click", onClick);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [difficulty]);

  return (
    <div className="flex flex-col items-center gap-2 select-none">
      <div className="text-sm font-semibold text-foreground">Score: <span className="text-emerald-400">{score}</span></div>
      <canvas
        ref={canvasRef} width={W} height={H}
        className="rounded-xl border border-border touch-none max-w-full cursor-pointer"
      />
      <p className="text-xs text-muted-foreground">Tap / Space to flap. Avoid the pipes!</p>
    </div>
  );
}
