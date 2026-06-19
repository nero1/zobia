"use client";

/**
 * Star Blaster — arcade space shooter. Move with arrow keys / A-D or drag/tap.
 * Fire with Space or tap. Destroy asteroids (+20 each). A rock hitting your ship
 * ends the run. Rocks that pass below the screen are removed (no penalty).
 */

import { useEffect, useRef, useState } from "react";
import type { GameEngineProps } from "@/components/games/types";
import { useGameSound } from "@/components/games/useGameSound";

const W = 320;
const H = 460;
const SHIP_W = 32;
const SHIP_H = 26;

// Difficulty → rock speed multiplier and spawn rate
const DIFF: Record<string, { speedMul: number; spawnBase: number }> = {
  easy:   { speedMul: 0.7, spawnBase: 80 },
  medium: { speedMul: 1.0, spawnBase: 55 },
  hard:   { speedMul: 1.5, spawnBase: 35 },
};

type Rock = { x: number; y: number; r: number; vy: number; exploding: number };
type Bullet = { x: number; y: number };
type Particle = { x: number; y: number; vx: number; vy: number; life: number; color: string };

export default function SpaceShooterGame({ onReady, onGameOver, onScore, difficulty = "medium", paused, soundEnabled = true }: GameEngineProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [score, setScore] = useState(0);
  const pausedRef = useRef(paused);
  const play = useGameSound(soundEnabled ?? true);

  useEffect(() => { pausedRef.current = paused; }, [paused]);

  useEffect(() => {
    onReady?.();
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    const diff = DIFF[difficulty] ?? DIFF.medium;

    const s = {
      x: W / 2,
      rocks: [] as Rock[],
      bullets: [] as Bullet[],
      particles: [] as Particle[],
      score: 0,
      spawn: diff.spawnBase,
      cooldown: 0,
      over: false,
      left: false,
      right: false,
      stars: Array.from({ length: 60 }, () => ({
        x: Math.random() * W,
        y: Math.random() * H,
        r: Math.random() * 1.5 + 0.3,
        speed: Math.random() * 0.5 + 0.2,
      })),
    };

    const fire = () => {
      if (s.cooldown <= 0 && !s.over) {
        s.bullets.push({ x: s.x, y: H - SHIP_H - 16 });
        s.cooldown = 12;
        play("score");
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
      const scale = W / rect.width;
      s.x = Math.max(SHIP_W / 2, Math.min(W - SHIP_W / 2, (clientX - rect.left) * scale));
    };

    const onMouseMove = (e: MouseEvent) => aim(e.clientX);
    const onMouseClick = () => fire();
    const onTouch = (e: TouchEvent) => { aim(e.touches[0].clientX); fire(); e.preventDefault(); };
    const onTouchMove = (e: TouchEvent) => { aim(e.touches[0].clientX); e.preventDefault(); };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    canvas.addEventListener("mousemove", onMouseMove);
    canvas.addEventListener("click", onMouseClick);
    canvas.addEventListener("touchstart", onTouch, { passive: false });
    canvas.addEventListener("touchmove", onTouchMove, { passive: false });

    const spawnParticles = (x: number, y: number, color: string) => {
      for (let i = 0; i < 8; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = Math.random() * 3 + 1;
        s.particles.push({
          x, y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: 1,
          color,
        });
      }
    };

    const end = () => {
      if (!s.over) {
        s.over = true;
        play("lose");
        onGameOver(s.score);
      }
    };

    const drawShip = (x: number, y: number, exploding = false) => {
      if (exploding) {
        ctx.fillStyle = "#ef4444";
        ctx.beginPath();
        ctx.arc(x, y + SHIP_H / 2, SHIP_W / 1.5, 0, Math.PI * 2);
        ctx.fill();
        return;
      }
      // Body
      ctx.fillStyle = "#34d399";
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - SHIP_W / 2, y + SHIP_H);
      ctx.lineTo(x - SHIP_W / 4, y + SHIP_H * 0.75);
      ctx.lineTo(x, y + SHIP_H * 0.85);
      ctx.lineTo(x + SHIP_W / 4, y + SHIP_H * 0.75);
      ctx.lineTo(x + SHIP_W / 2, y + SHIP_H);
      ctx.closePath();
      ctx.fill();
      // Engine glow
      ctx.fillStyle = "#fbbf24";
      ctx.beginPath();
      ctx.arc(x, y + SHIP_H * 0.85, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowColor = "#fbbf24";
      ctx.shadowBlur = 10;
      ctx.fill();
      ctx.shadowBlur = 0;
    };

    let raf = 0;
    let shipExploding = 0;

    const loop = () => {
      if (s.over && shipExploding <= 0) return;

      if (!pausedRef.current) {
        if (!s.over) {
          // Move ship
          if (s.left) s.x = Math.max(SHIP_W / 2, s.x - 6);
          if (s.right) s.x = Math.min(W - SHIP_W / 2, s.x + 6);
          if (s.cooldown > 0) s.cooldown--;

          // Spawn rocks
          s.spawn--;
          if (s.spawn <= 0) {
            const r = 10 + Math.random() * 14;
            const vy = (1.2 + Math.random() * 1.2 + s.score / 2000) * diff.speedMul;
            s.rocks.push({ x: r + Math.random() * (W - 2 * r), y: -r, r, vy, exploding: 0 });
            s.spawn = Math.max(15, diff.spawnBase - Math.floor(s.score / 150));
          }

          // Move bullets
          for (const b of s.bullets) b.y -= 9;
          s.bullets = s.bullets.filter(b => b.y > -10);

          // Move rocks
          for (const rk of s.rocks) {
            if (rk.exploding > 0) { rk.exploding--; continue; }
            rk.y += rk.vy;
          }

          // Bullet ↔ rock collisions
          for (const rk of s.rocks) {
            if (rk.exploding > 0) continue;
            for (const b of s.bullets) {
              if (Math.hypot(b.x - rk.x, b.y - rk.y) < rk.r + 4) {
                rk.exploding = 8;
                b.y = -999;
                s.score += 20;
                setScore(s.score);
                onScore?.(s.score);
                play("match");
                spawnParticles(rk.x, rk.y, "#f97316");
              }
            }
          }

          // Rock ↔ ship collision (only non-exploding rocks)
          const shipY = H - SHIP_H - 10;
          for (const rk of s.rocks) {
            if (rk.exploding > 0) continue;
            const hit =
              rk.y + rk.r > shipY &&
              rk.y - rk.r < shipY + SHIP_H &&
              Math.abs(rk.x - s.x) < rk.r * 0.8 + SHIP_W * 0.4;
            if (hit) {
              spawnParticles(s.x, shipY, "#34d399");
              shipExploding = 40;
              end();
              break;
            }
          }

          // Remove rocks that left screen OR finished exploding
          s.rocks = s.rocks.filter(rk => rk.y < H + rk.r + 10 && !(rk.exploding <= 0 && rk.y > H));

          // Particles
          for (const p of s.particles) {
            p.x += p.vx;
            p.y += p.vy;
            p.vy += 0.08;
            p.life -= 0.04;
          }
          s.particles = s.particles.filter(p => p.life > 0);
        }

        if (shipExploding > 0) shipExploding--;

        // Scroll stars
        for (const star of s.stars) {
          star.y += star.speed;
          if (star.y > H) { star.y = 0; star.x = Math.random() * W; }
        }
      }

      // ── Draw ──
      ctx.fillStyle = "#07080f";
      ctx.fillRect(0, 0, W, H);

      // Stars
      for (const star of s.stars) {
        ctx.fillStyle = `rgba(255,255,255,${0.3 + star.r * 0.3})`;
        ctx.beginPath();
        ctx.arc(star.x, star.y, star.r, 0, Math.PI * 2);
        ctx.fill();
      }

      // Bullets
      ctx.shadowColor = "#e2e8f0";
      ctx.shadowBlur = 4;
      ctx.fillStyle = "#e2e8f0";
      for (const b of s.bullets) {
        ctx.fillRect(b.x - 1.5, b.y, 3, 10);
      }
      ctx.shadowBlur = 0;

      // Rocks
      for (const rk of s.rocks) {
        if (rk.exploding > 0) {
          const alpha = rk.exploding / 8;
          ctx.fillStyle = `rgba(249,115,22,${alpha})`;
          ctx.beginPath();
          ctx.arc(rk.x, rk.y, rk.r * (1 + (1 - alpha) * 1.5), 0, Math.PI * 2);
          ctx.fill();
          continue;
        }
        ctx.fillStyle = "#a16207";
        ctx.strokeStyle = "#92400e";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(rk.x, rk.y, rk.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        // craters
        ctx.fillStyle = "#78350f";
        ctx.beginPath();
        ctx.arc(rk.x - rk.r * 0.2, rk.y - rk.r * 0.2, rk.r * 0.25, 0, Math.PI * 2);
        ctx.fill();
      }

      // Particles
      for (const p of s.particles) {
        ctx.globalAlpha = p.life;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3 * p.life, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // Ship
      if (!s.over) {
        drawShip(s.x, H - SHIP_H - 10, false);
      } else if (shipExploding > 0) {
        drawShip(s.x, H - SHIP_H - 10, true);
      }

      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      canvas.removeEventListener("mousemove", onMouseMove);
      canvas.removeEventListener("click", onMouseClick);
      canvas.removeEventListener("touchstart", onTouch);
      canvas.removeEventListener("touchmove", onTouchMove);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [difficulty]);

  return (
    <div className="flex flex-col items-center gap-2 select-none">
      <div className="text-sm font-semibold text-foreground">Score: {score}</div>
      <canvas
        ref={canvasRef}
        width={W}
        height={H}
        className="rounded-lg border border-neutral-700 touch-none"
        style={{ maxWidth: "min(320px, calc(100vw - 32px))" }}
      />
      <p className="text-xs text-muted-foreground">Mouse/drag to aim · Click/Space/tap to shoot</p>
    </div>
  );
}
