"use client";

/**
 * Speed Dodge — endless lane-dodging racer. 5 lanes, narrower cars, starts slow.
 * Steer with arrow keys / A-D, tap left/right half of the track, or on-screen buttons.
 * Score climbs with distance. One crash ends the run.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import type { GameEngineProps } from "@/components/games/types";
import { useGameSound } from "@/components/games/useGameSound";

const W = 300;
const H = 460;
const LANES = 5;
const LANE_W = W / LANES;
const CAR_W = Math.round(LANE_W * 0.58);   // narrower — more maneuvering room
const CAR_H = 52;

// Difficulty → initial speed and acceleration
const SPEED_CFG: Record<string, { init: number; accel: number }> = {
  easy:   { init: 1.2, accel: 0.0002 },
  medium: { init: 1.8, accel: 0.0004 },
  hard:   { init: 2.5, accel: 0.0007 },
};

type Obs = { lane: number; y: number; color: string };

const OBS_COLORS = ["#ef4444","#f97316","#eab308","#a855f7","#ec4899"];

export default function CarRacingGame({ onReady, onGameOver, onScore, difficulty = "medium", paused, soundEnabled = true }: GameEngineProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [score, setScore] = useState(0);
  const [over, setOver] = useState(false);
  const pausedRef = useRef(paused);
  const play = useGameSound(soundEnabled ?? true);
  const laneRef = useRef(2); // current lane (0-4), start in middle

  useEffect(() => { pausedRef.current = paused; }, [paused]);

  const moveRef = useRef<(dir: -1 | 1) => void>(() => {});

  useEffect(() => {
    onReady?.();
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    const cfg = SPEED_CFG[difficulty] ?? SPEED_CFG.medium;

    const s = {
      lane: 2,
      obstacles: [] as Obs[],
      speed: cfg.init,
      score: 0,
      dash: 0,
      spawnTimer: 0,
      over: false,
      stars: Array.from({ length: 20 }, () => ({
        x: Math.random() * W,
        y: Math.random() * H,
        speed: Math.random() * 1 + 0.5,
      })),
    };
    laneRef.current = 2;

    const move = (dir: -1 | 1) => {
      const nl = Math.max(0, Math.min(LANES - 1, s.lane + dir));
      if (nl !== s.lane) {
        s.lane = nl;
        laneRef.current = nl;
        play("tap");
      }
    };

    moveRef.current = move;

    const onKey = (e: KeyboardEvent) => {
      if (s.over) return;
      const k = e.key.toLowerCase();
      if (k === "arrowleft" || k === "a") { move(-1); e.preventDefault(); }
      if (k === "arrowright" || k === "d") { move(1); e.preventDefault(); }
    };

    const onTap = (clientX: number) => {
      if (s.over) return;
      const rect = canvas.getBoundingClientRect();
      move(clientX - rect.left < rect.width / 2 ? -1 : 1);
    };

    const onClick = (e: MouseEvent) => onTap(e.clientX);
    const onTouch = (e: TouchEvent) => { onTap(e.touches[0].clientX); e.preventDefault(); };

    window.addEventListener("keydown", onKey);
    canvas.addEventListener("click", onClick);
    canvas.addEventListener("touchstart", onTouch, { passive: false });

    const laneX = (lane: number) => lane * LANE_W + (LANE_W - CAR_W) / 2;

    function drawCar(x: number, y: number, color: string, isPlayer = false) {
      // Body
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.roundRect(x, y + 8, CAR_W, CAR_H - 16, 4);
      ctx.fill();

      // Roof
      ctx.fillStyle = isPlayer ? "#0ea5e9" : "#7f1d1d";
      ctx.beginPath();
      ctx.roundRect(x + CAR_W * 0.15, y + 14, CAR_W * 0.7, CAR_H * 0.45, 3);
      ctx.fill();

      // Headlights / taillights
      ctx.fillStyle = isPlayer ? "#fef08a" : "#f87171";
      const lightY = isPlayer ? y + CAR_H - 6 : y + 4;
      ctx.beginPath(); ctx.arc(x + 5, lightY, 3, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(x + CAR_W - 5, lightY, 3, 0, Math.PI * 2); ctx.fill();

      // Wheels
      ctx.fillStyle = "#1f2937";
      ctx.fillRect(x - 2, y + 10, 4, 10);
      ctx.fillRect(x + CAR_W - 2, y + 10, 4, 10);
      ctx.fillRect(x - 2, y + CAR_H - 20, 4, 10);
      ctx.fillRect(x + CAR_W - 2, y + CAR_H - 20, 4, 10);
    }

    let raf = 0;
    const loop = () => {
      if (s.over) return;

      if (!pausedRef.current) {
        s.speed = cfg.init + s.score * cfg.accel;

        s.spawnTimer--;
        if (s.spawnTimer <= 0) {
          const takenLanes = new Set(
            s.obstacles.filter(o => o.y > -CAR_H * 2 && o.y < H * 0.6).map(o => o.lane)
          );
          let lane = Math.floor(Math.random() * LANES);
          for (let i = 0; i < 5; i++) {
            if (!takenLanes.has(lane)) break;
            lane = Math.floor(Math.random() * LANES);
          }
          s.obstacles.push({
            lane,
            y: -CAR_H,
            color: OBS_COLORS[Math.floor(Math.random() * OBS_COLORS.length)],
          });
          s.spawnTimer = Math.max(25, Math.round(65 - s.score / 300));
        }

        for (const o of s.obstacles) o.y += s.speed;
        s.obstacles = s.obstacles.filter(o => o.y < H + CAR_H);

        // Collision
        const playerY = H - CAR_H - 12;
        for (const o of s.obstacles) {
          if (o.lane === s.lane) {
            const oy = o.y;
            const overlapY = oy + CAR_H > playerY + 4 && oy < playerY + CAR_H - 4;
            if (overlapY) {
              s.over = true;
              setOver(true);
              play("lose");
              onGameOver(Math.round(s.score));
              return;
            }
          }
        }

        s.score += 1;
        if (s.score % 6 === 0) { setScore(Math.round(s.score)); onScore?.(Math.round(s.score)); }

        // Scroll road stars
        for (const star of s.stars) {
          star.y += star.speed * s.speed;
          if (star.y > H) { star.y = 0; star.x = Math.random() * W; }
        }
        s.dash = (s.dash + s.speed) % 40;
      }

      // ── Draw ──
      ctx.fillStyle = "#111827"; ctx.fillRect(0, 0, W, H);

      // Road shoulders
      ctx.fillStyle = "#1c1917";
      ctx.fillRect(0, 0, 8, H);
      ctx.fillRect(W - 8, 0, 8, H);

      // Lane markings
      ctx.strokeStyle = "#374151"; ctx.lineWidth = 1.5;
      for (let l = 1; l < LANES; l++) {
        const lx = l * LANE_W;
        if (l === Math.floor(LANES / 2)) {
          // Center lane marker (solid)
          ctx.strokeStyle = "#4b5563"; ctx.lineWidth = 2;
        } else {
          ctx.strokeStyle = "#374151"; ctx.lineWidth = 1;
        }
        for (let y = -40 + s.dash; y < H; y += 40) {
          ctx.beginPath(); ctx.moveTo(lx, y); ctx.lineTo(lx, y + 20); ctx.stroke();
        }
      }

      // Road stars (ambient)
      ctx.fillStyle = "rgba(255,255,255,0.07)";
      for (const star of s.stars) {
        ctx.beginPath(); ctx.arc(star.x, star.y, 1, 0, Math.PI * 2); ctx.fill();
      }

      // Obstacles
      for (const o of s.obstacles) drawCar(laneX(o.lane), o.y, o.color, false);

      // Player car
      drawCar(laneX(s.lane), H - CAR_H - 12, "#38bdf8", true);

      // Player speed lines
      ctx.strokeStyle = "rgba(56,189,248,0.2)"; ctx.lineWidth = 1;
      const px = laneX(s.lane) + CAR_W / 2;
      for (let i = 0; i < 3; i++) {
        const lx2 = px - CAR_W * 0.3 + i * CAR_W * 0.3;
        ctx.beginPath();
        ctx.moveTo(lx2, H - CAR_H - 12);
        ctx.lineTo(lx2, H - CAR_H - 12 - 20);
        ctx.stroke();
      }

      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onKey);
      canvas.removeEventListener("click", onClick);
      canvas.removeEventListener("touchstart", onTouch);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [difficulty]);

  const steer = useCallback((dir: -1 | 1) => moveRef.current(dir), []);

  return (
    <div className="flex flex-col items-center gap-2 select-none">
      <div className="text-sm font-semibold text-foreground">Score: {score}</div>
      <canvas ref={canvasRef} width={W} height={H} className="rounded-lg border border-neutral-700 touch-none max-w-full" />
      <div className="flex gap-4">
        <button type="button" onClick={() => steer(-1)}
          className="px-6 py-3 rounded-xl bg-neutral-800 text-white font-bold text-xl hover:bg-neutral-700 active:scale-90 transition-transform">
          ◀
        </button>
        <button type="button" onClick={() => steer(1)}
          className="px-6 py-3 rounded-xl bg-neutral-800 text-white font-bold text-xl hover:bg-neutral-700 active:scale-90 transition-transform">
          ▶
        </button>
      </div>
      <p className="text-xs text-muted-foreground">Arrow keys / A-D, tap sides, or use buttons.</p>
    </div>
  );
}
