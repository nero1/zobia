"use client";

/**
 * Asteroid Dodge — spaceship at bottom moves left/right, dodge falling asteroids.
 * Score = seconds survived. Hit = game over.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import type { GameEngineProps } from "@/components/games/types";
import { useGameSound } from "@/components/games/useGameSound";

const W = 320;
const H = 460;
const SHIP_W = 40;
const SHIP_H = 40;
const SHIP_Y = H - 60;
const SHIP_SPEED: Record<string, number> = { easy: 6, medium: 8, hard: 10 };
const AST_SPEED: Record<string, [number, number]> = { easy: [1.5, 3], medium: [2.5, 4.5], hard: [4, 7] };
const SPAWN_MS: Record<string, number> = { easy: 1800, medium: 1100, hard: 700 };
const AST_SIZE: Record<string, number> = { easy: 30, medium: 36, hard: 44 };

interface Asteroid {
  id: number;
  x: number;
  y: number;
  speed: number;
  size: number;
  large: boolean;
}

let astId = 0;

export default function AsteroidDodge({
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

  const shipSpeed = SHIP_SPEED[difficulty] ?? 8;
  const [astSpeedMin, astSpeedMax] = AST_SPEED[difficulty] ?? [2.5, 4.5];
  const spawnMs = SPAWN_MS[difficulty] ?? 1100;
  const astSize = AST_SIZE[difficulty] ?? 36;

  const [shipX, setShipX] = useState(W / 2 - SHIP_W / 2);
  const [asteroids, setAsteroids] = useState<Asteroid[]>([]);
  const [score, setScore] = useState(0);
  const [over, setOver] = useState(false);
  const [exploded, setExploded] = useState(false);

  const shipXRef = useRef(W / 2 - SHIP_W / 2);
  const asteroidRef = useRef<Asteroid[]>([]);
  asteroidRef.current = asteroids;
  const scoreRef = useRef(0);
  const overRef = useRef(false);
  const leftRef = useRef(false);
  const rightRef = useRef(false);
  const lastScoreSound = useRef(0);

  const endGame = useCallback((sx: number, sy: number) => {
    if (overRef.current) return;
    overRef.current = true;
    setExploded(true);
    play("lose");
    setTimeout(() => {
      setOver(true);
      onGameOver(scoreRef.current);
    }, 600);
  }, [onGameOver, play]);

  // Keyboard
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

  // Score timer
  useEffect(() => {
    if (over) return;
    const id = setInterval(() => {
      if (pausedRef.current || overRef.current) return;
      scoreRef.current += 1;
      setScore(scoreRef.current);
      onScore?.(scoreRef.current);
      const mark = Math.floor(scoreRef.current / 5);
      if (mark > lastScoreSound.current) {
        lastScoreSound.current = mark;
        play("score");
      }
    }, 1000);
    return () => clearInterval(id);
  }, [over, onScore, play]);

  // Spawn asteroids
  useEffect(() => {
    if (over) return;
    const id = setInterval(() => {
      if (pausedRef.current || overRef.current) return;
      const size = astSize + (difficulty === "hard" && Math.random() < 0.3 ? 20 : 0);
      const large = size > astSize;
      setAsteroids((prev) => [
        ...prev,
        {
          id: astId++,
          x: size / 2 + Math.random() * (W - size),
          y: -size,
          speed: astSpeedMin + Math.random() * (astSpeedMax - astSpeedMin),
          size,
          large,
        },
      ]);
    }, spawnMs);
    return () => clearInterval(id);
  }, [over, spawnMs, astSize, astSpeedMin, astSpeedMax, difficulty]);

  // Game loop
  useEffect(() => {
    if (over) return;
    const id = setInterval(() => {
      if (pausedRef.current || overRef.current) return;

      // Move ship
      let sx = shipXRef.current;
      if (leftRef.current) sx = Math.max(0, sx - shipSpeed);
      if (rightRef.current) sx = Math.min(W - SHIP_W, sx + shipSpeed);
      shipXRef.current = sx;
      setShipX(sx);

      // Move asteroids + collision
      setAsteroids((prev) => {
        const next = prev
          .map((a) => ({ ...a, y: a.y + a.speed }))
          .filter((a) => a.y < H + a.size);

        // Collision check
        for (const a of next) {
          const cx = a.x;
          const cy = a.y;
          const shipCX = sx + SHIP_W / 2;
          const shipCY = SHIP_Y + SHIP_H / 2;
          const dist = Math.sqrt((cx - shipCX) ** 2 + (cy - shipCY) ** 2);
          if (dist < a.size / 2 + SHIP_W / 2 - 8) {
            setTimeout(() => endGame(sx, SHIP_Y), 0);
            break;
          }
        }
        asteroidRef.current = next;
        return next;
      });
    }, 30);
    return () => clearInterval(id);
  }, [over, shipSpeed, endGame]);

  return (
    <div className="flex flex-col items-center gap-3 select-none w-full max-w-sm mx-auto">
      <div className="flex w-full items-center justify-between px-2 text-sm font-semibold">
        <span className="text-emerald-400">Survived: {score}s</span>
        <span className="text-muted-foreground text-xs">← → to dodge</span>
      </div>

      <div
        className="relative overflow-hidden rounded-2xl border border-border bg-gradient-to-b from-slate-950 via-indigo-950 to-slate-950"
        style={{ width: W, height: H }}
      >
        {/* Stars */}
        {[...Array(30)].map((_, i) => (
          <div
            key={i}
            className="absolute rounded-full bg-white"
            style={{
              left: `${(i * 37 + 7) % 100}%`,
              top: `${(i * 53 + 13) % 100}%`,
              width: i % 3 === 0 ? 2 : 1,
              height: i % 3 === 0 ? 2 : 1,
              opacity: 0.3 + (i % 5) * 0.1,
            }}
          />
        ))}

        {/* Asteroids */}
        {asteroids.map((a) => (
          <div
            key={a.id}
            className="absolute flex items-center justify-center"
            style={{
              left: a.x - a.size / 2,
              top: a.y - a.size / 2,
              width: a.size,
              height: a.size,
              fontSize: a.size * 0.7,
            }}
          >
            {a.large ? "🪨" : "☄️"}
          </div>
        ))}

        {/* Ship */}
        <div
          className="absolute flex items-center justify-center text-3xl transition-none"
          style={{
            left: shipX,
            top: SHIP_Y,
            width: SHIP_W,
            height: SHIP_H,
          }}
        >
          {exploded ? "💥" : "🚀"}
        </div>

        {over && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/70 rounded-2xl">
            <div className="text-5xl mb-3">☄️</div>
            <div className="text-white font-bold text-2xl">Destroyed!</div>
            <div className="text-emerald-400 font-bold text-lg mt-1">Survived: {score}s</div>
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
