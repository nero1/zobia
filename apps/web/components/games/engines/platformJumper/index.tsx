"use client";

/**
 * Platform Jumper — endless vertical jumper (Doodle Jump style).
 * Character auto-bounces on platforms, player moves left/right.
 * Fall below screen = game over. Score = height reached.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import type { GameEngineProps } from "@/components/games/types";
import { useGameSound } from "@/components/games/useGameSound";

const W = 320;
const H = 480;
const CHAR_W = 32;
const CHAR_H = 32;
const PLAT_H = 10;
const GRAVITY = 0.4;
const JUMP_VEL = -10;
const MOVE_SPEED: Record<string, number> = { easy: 3.5, medium: 5, hard: 7 };
const PLAT_W: Record<string, [number, number]> = { easy: [70, 90], medium: [55, 75], hard: [40, 60] };
const PLAT_GAP: Record<string, number> = { easy: 70, medium: 85, hard: 100 };

interface Platform {
  id: number;
  x: number;
  y: number;
  w: number;
  moving?: boolean;
  dir?: 1 | -1;
  speed?: number;
}

let platId = 0;

function generatePlatform(y: number, difficulty: string): Platform {
  const [minW, maxW] = PLAT_W[difficulty] ?? [55, 75];
  const w = minW + Math.random() * (maxW - minW);
  const moving = difficulty === "hard" && Math.random() < 0.3;
  return {
    id: platId++,
    x: Math.random() * (W - w),
    y,
    w,
    moving,
    dir: moving ? (Math.random() < 0.5 ? 1 : -1) : undefined,
    speed: moving ? 1 + Math.random() * 1.5 : undefined,
  };
}

function initPlatforms(difficulty: string): Platform[] {
  const platforms: Platform[] = [];
  // Starting platform under the character
  platforms.push({ id: platId++, x: W / 2 - 50, y: H - 80, w: 100 });
  let y = H - 80;
  while (y > -H) {
    y -= PLAT_GAP[difficulty] ?? 85;
    platforms.push(generatePlatform(y, difficulty));
  }
  return platforms;
}

export default function PlatformJumper({
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

  const moveSpeed = MOVE_SPEED[difficulty] ?? 5;

  const [charX, setCharX] = useState(W / 2 - CHAR_W / 2);
  const [charY, setCharY] = useState(H - 80 - CHAR_H);
  const [platforms, setPlatforms] = useState<Platform[]>(() => initPlatforms(difficulty));
  const [score, setScore] = useState(0);
  const [over, setOver] = useState(false);

  const velY = useRef(JUMP_VEL);
  const charXRef = useRef(W / 2 - CHAR_W / 2);
  const charYRef = useRef(H - 80 - CHAR_H);
  const cameraY = useRef(0); // total scroll
  const scoreRef = useRef(0);
  const overRef = useRef(false);
  const platformsRef = useRef(platforms);
  platformsRef.current = platforms;
  const leftRef = useRef(false);
  const rightRef = useRef(false);
  const lastLevelUp = useRef(0);

  const endGame = useCallback(() => {
    if (overRef.current) return;
    overRef.current = true;
    setOver(true);
    play("lose");
    onGameOver(scoreRef.current);
  }, [onGameOver, play]);

  // Keyboard controls
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") leftRef.current = e.type === "keydown";
      if (e.key === "ArrowRight") rightRef.current = e.type === "keydown";
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
    };
  }, []);

  // Game loop
  useEffect(() => {
    if (over) return;
    let rafId: number;

    const tick = () => {
      if (pausedRef.current || overRef.current) { rafId = requestAnimationFrame(tick); return; }

      // Move character left/right
      let nx = charXRef.current;
      if (leftRef.current) nx -= moveSpeed;
      if (rightRef.current) nx += moveSpeed;
      // Wrap around
      if (nx + CHAR_W < 0) nx = W;
      if (nx > W) nx = -CHAR_W;
      charXRef.current = nx;

      // Apply gravity
      velY.current += GRAVITY;
      let ny = charYRef.current + velY.current;

      // Collision with platforms (only when falling down)
      if (velY.current > 0) {
        for (const plat of platformsRef.current) {
          const px = plat.x;
          const py = plat.y;
          const pw = plat.w;
          // Check if character feet are touching platform
          const charBottom = ny + CHAR_H;
          const prevBottom = charYRef.current + CHAR_H;
          if (
            charBottom >= py &&
            prevBottom <= py + PLAT_H &&
            nx + CHAR_W > px &&
            nx < px + pw
          ) {
            velY.current = JUMP_VEL;
            ny = py - CHAR_H;
            play("score");
            break;
          }
        }
      }

      charYRef.current = ny;

      // Scroll camera up when character is in top half
      let scroll = 0;
      if (ny < H / 2) {
        scroll = H / 2 - ny;
        cameraY.current += scroll;
        charYRef.current = H / 2;
        ny = H / 2;

        // Update score
        const newScore = Math.floor(cameraY.current / 10);
        if (newScore > scoreRef.current) {
          scoreRef.current = newScore;
          setScore(newScore);
          onScore?.(newScore);
          // Level up sound every 500 height
          const levelMark = Math.floor(newScore / 500);
          if (levelMark > lastLevelUp.current) {
            lastLevelUp.current = levelMark;
            play("levelUp");
          }
        }
      }

      // Update platforms
      setPlatforms((prev) => {
        let next = prev.map((p) => {
          let px = p.x;
          if (p.moving && p.dir && p.speed) {
            px += p.dir * p.speed;
            if (px < 0) { px = 0; }
            if (px + p.w > W) { px = W - p.w; }
            return { ...p, x: px, dir: (px <= 0 || px + p.w >= W) ? (-p.dir as 1 | -1) : p.dir };
          }
          return { ...p, y: p.y + scroll };
        });
        // Move all platforms down with scroll
        if (scroll > 0) {
          next = next.map((p) => ({ ...p, y: p.y + scroll }));
        }
        // Remove off-screen platforms
        next = next.filter((p) => p.y < H + 20);
        // Generate new platforms at top
        const topY = Math.min(...next.map((p) => p.y));
        const gap = PLAT_GAP[difficulty] ?? 85;
        let genY = topY;
        while (genY > -50) {
          genY -= gap;
          next.push(generatePlatform(genY, difficulty));
        }
        platformsRef.current = next;
        return next;
      });

      setCharX(charXRef.current);
      setCharY(charYRef.current);

      // Check game over (fell below screen)
      if (charYRef.current > H + 50) {
        endGame();
        return;
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [over, moveSpeed, difficulty, endGame, onScore, play]);

  return (
    <div className="flex flex-col items-center gap-3 select-none w-full max-w-sm mx-auto">
      <div className="flex w-full items-center justify-between px-2 text-sm font-semibold">
        <span className="text-emerald-400">Height: {score}</span>
        <span className="text-muted-foreground text-xs">← → to move</span>
      </div>

      <div
        className="relative overflow-hidden rounded-2xl border border-border bg-gradient-to-b from-slate-900 to-slate-950"
        style={{ width: W, height: H }}
      >
        {/* Platforms */}
        {platforms.map((p) => (
          <div
            key={p.id}
            className="absolute rounded-md"
            style={{
              left: p.x,
              top: p.y,
              width: p.w,
              height: PLAT_H,
              backgroundColor: p.moving ? "#f59e0b" : "#4ade80",
            }}
          />
        ))}

        {/* Character */}
        <div
          className="absolute flex items-center justify-center text-2xl"
          style={{ left: charX, top: charY, width: CHAR_W, height: CHAR_H }}
        >
          🦘
        </div>

        {over && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/70 rounded-2xl">
            <div className="text-5xl mb-3">😵</div>
            <div className="text-white font-bold text-2xl">Game Over!</div>
            <div className="text-emerald-400 font-bold text-lg mt-1">Height: {score}</div>
          </div>
        )}
      </div>

      {/* Mobile controls */}
      <div className="flex gap-6 w-full justify-center">
        <button
          type="button"
          className="rounded-xl border-2 border-border bg-card hover:bg-accent text-foreground px-8 py-3 text-xl font-bold transition-all duration-150 active:scale-95"
          onPointerDown={() => { leftRef.current = true; }}
          onPointerUp={() => { leftRef.current = false; }}
          onPointerLeave={() => { leftRef.current = false; }}
        >
          ◀
        </button>
        <button
          type="button"
          className="rounded-xl border-2 border-border bg-card hover:bg-accent text-foreground px-8 py-3 text-xl font-bold transition-all duration-150 active:scale-95"
          onPointerDown={() => { rightRef.current = true; }}
          onPointerUp={() => { rightRef.current = false; }}
          onPointerLeave={() => { rightRef.current = false; }}
        >
          ▶
        </button>
      </div>
    </div>
  );
}
