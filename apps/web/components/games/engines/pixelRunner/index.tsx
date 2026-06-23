"use client";

/**
 * Pixel Runner — endless side-scrolling runner. Tap to jump over obstacles.
 * Score = distance. Collision = game over.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import type { GameEngineProps } from "@/components/games/types";
import { useGameSound } from "@/components/games/useGameSound";

const W = 320;
const H = 480;
const GROUND_Y = H * 0.78; // ground top y
const CHAR_X = 50;
const CHAR_W = 32;
const CHAR_H = 36;
const JUMP_VEL = -12;
const GRAVITY = 0.6;
const BASE_SPEED: Record<string, number> = { easy: 3, medium: 5, hard: 7.5 };
const SPAWN_DIST: Record<string, [number, number]> = { easy: [280, 450], medium: [200, 360], hard: [140, 280] };

interface Obstacle {
  id: number;
  x: number;
  w: number;
  h: number;
  type: "short" | "tall" | "spike";
  rotation: number; // for spike
}

let obsId = 0;

function makeObstacle(x: number, difficulty: string): Obstacle {
  const types: Array<"short" | "tall" | "spike"> = difficulty === "hard"
    ? ["short", "tall", "spike"]
    : ["short", "tall"];
  const type = types[Math.floor(Math.random() * types.length)];
  return {
    id: obsId++,
    x,
    w: type === "spike" ? 20 : 22,
    h: type === "short" ? 30 : type === "tall" ? 55 : 28,
    type,
    rotation: 0,
  };
}

export default function PixelRunner({
  onReady,
  onGameOver,
  onScore,
  difficulty = "medium",
  paused,
  soundEnabled = true,
}: GameEngineProps) {
  const play = useGameSound(soundEnabled ?? true);
  const pausedRef = useRef(paused);
  useEffect(() => { pausedRef.current = paused; }, [paused]);
  useEffect(() => { onReady?.(); }, [onReady]);

  const baseSpeed = BASE_SPEED[difficulty] ?? 5;
  const spawnDist = SPAWN_DIST[difficulty] ?? [200, 360];

  const [charY, setCharY] = useState(GROUND_Y - CHAR_H);
  const [obstacles, setObstacles] = useState<Obstacle[]>([]);
  const [score, setScore] = useState(0);
  const [over, setOver] = useState(false);
  const [groundX, setGroundX] = useState(0);

  const velY = useRef(0);
  const charYRef = useRef(GROUND_Y - CHAR_H);
  const onGround = useRef(true);
  const obstaclesRef = useRef<Obstacle[]>([]);
  obstaclesRef.current = obstacles;
  const scoreRef = useRef(0);
  const overRef = useRef(false);
  const nextSpawnX = useRef(W + 100);
  const totalDist = useRef(0);
  const lastScoreSound = useRef(0);
  const groundXRef = useRef(0);

  const endGame = useCallback(() => {
    if (overRef.current) return;
    overRef.current = true;
    setOver(true);
    play("lose");
    onGameOver(scoreRef.current);
  }, [onGameOver, play]);

  const jump = useCallback(() => {
    if (overRef.current || pausedRef.current) return;
    if (onGround.current) {
      velY.current = JUMP_VEL;
      onGround.current = false;
      play("pop");
    }
  }, [play]);

  // Key and tap handlers
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.code === "Space") { e.preventDefault(); jump(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [jump]);

  // Game loop
  useEffect(() => {
    if (over) return;
    let rafId: number;

    const tick = () => {
      if (pausedRef.current || overRef.current) { rafId = requestAnimationFrame(tick); return; }

      const speed = baseSpeed + totalDist.current / 5000;

      // Move ground
      groundXRef.current = (groundXRef.current - speed + W) % W;
      setGroundX(groundXRef.current);

      // Character physics
      velY.current += GRAVITY;
      let ny = charYRef.current + velY.current;
      if (ny >= GROUND_Y - CHAR_H) {
        ny = GROUND_Y - CHAR_H;
        velY.current = 0;
        onGround.current = true;
      }
      charYRef.current = ny;
      setCharY(ny);

      // Move obstacles
      totalDist.current += speed;
      scoreRef.current = Math.floor(totalDist.current / 10);
      setScore(scoreRef.current);
      onScore?.(scoreRef.current);

      // Score milestone sound
      const scoreMark = Math.floor(scoreRef.current / 100);
      if (scoreMark > lastScoreSound.current) {
        lastScoreSound.current = scoreMark;
        play("score");
      }

      setObstacles((prev) => {
        let next = prev
          .map((o) => ({ ...o, x: o.x - speed, rotation: o.type === "spike" ? o.rotation + 4 : 0 }))
          .filter((o) => o.x > -50);

        // Spawn new obstacle
        if (obstaclesRef.current.length === 0 || totalDist.current >= nextSpawnX.current) {
          const dist = spawnDist[0] + Math.random() * (spawnDist[1] - spawnDist[0]);
          nextSpawnX.current = totalDist.current + dist;
          next.push(makeObstacle(W + 20, difficulty));
        }

        obstaclesRef.current = next;
        return next;
      });

      // Collision detection
      for (const obs of obstaclesRef.current) {
        const obsY = GROUND_Y - obs.h;
        if (
          CHAR_X + CHAR_W - 6 > obs.x + 4 &&
          CHAR_X + 6 < obs.x + obs.w - 4 &&
          charYRef.current + CHAR_H - 4 > obsY + 4
        ) {
          endGame();
          return;
        }
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [over, baseSpeed, difficulty, endGame, onScore, play, spawnDist]);

  return (
    <div
      className="flex flex-col items-center gap-3 select-none w-full max-w-sm mx-auto"
      onClick={jump}
    >
      <div className="flex w-full items-center justify-between px-2 text-sm font-semibold">
        <span className="text-emerald-400">Score: {score}</span>
        <span className="text-muted-foreground text-xs">Tap / Space to jump</span>
      </div>

      <div
        className="relative overflow-hidden rounded-2xl border border-border bg-gradient-to-b from-sky-950 via-slate-900 to-slate-950"
        style={{ width: W, height: H }}
      >
        {/* Scrolling ground */}
        <div
          className="absolute bottom-0 h-[22%] w-[200%] bg-green-900 border-t-2 border-green-700"
          style={{ left: groundX - W }}
        />

        {/* Character */}
        <div
          className="absolute flex items-center justify-center text-2xl"
          style={{ left: CHAR_X, top: charY, width: CHAR_W, height: CHAR_H }}
        >
          🏃
        </div>

        {/* Obstacles */}
        {obstacles.map((obs) => {
          const obsY = GROUND_Y - obs.h;
          return (
            <div
              key={obs.id}
              className="absolute flex items-end justify-center"
              style={{
                left: obs.x,
                top: obsY,
                width: obs.w,
                height: obs.h,
              }}
            >
              {obs.type === "spike" ? (
                <div
                  className="text-lg"
                  style={{ transform: `rotate(${obs.rotation}deg)` }}
                >
                  ⚡
                </div>
              ) : (
                <div
                  className="w-full h-full rounded-sm"
                  style={{ backgroundColor: obs.type === "short" ? "#ef4444" : "#7c3aed" }}
                />
              )}
            </div>
          );
        })}

        {over && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/70 rounded-2xl">
            <div className="text-5xl mb-3">💥</div>
            <div className="text-white font-bold text-2xl">Game Over!</div>
            <div className="text-emerald-400 font-bold text-lg mt-1">Score: {score}</div>
          </div>
        )}
      </div>

      <p className="text-xs text-muted-foreground">Tap anywhere or press Space to jump!</p>
    </div>
  );
}
