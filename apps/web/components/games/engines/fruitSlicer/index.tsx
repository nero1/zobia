"use client";

/**
 * Fruit Slicer — fruit falls from top, drag across to slice.
 * 3 lives. Slice = +10, miss = -1 life, bomb hit = -1 life (hard).
 */

import { useEffect, useRef, useState, useCallback } from "react";
import type { GameEngineProps } from "@/components/games/types";
import { useGameSound } from "@/components/games/useGameSound";

const FRUITS = ["🍎", "🍊", "🍋", "🍇", "🍓", "🍌", "🍉", "🍑"];
const FALL_SPEED: Record<string, number> = { easy: 1.5, medium: 2.5, hard: 4.0 };
const SPAWN_MS: Record<string, number> = { easy: 1600, medium: 1100, hard: 750 };
// Difficulty ramp: fruits speed up the longer a round runs, so a high score
// can't be farmed forever at a fixed pace. Interval between speed-ups is
// shorter on harder difficulties (easy every 60s, medium 45s, hard 30s).
const RAMP_INTERVAL_MS: Record<string, number> = { easy: 60_000, medium: 45_000, hard: 30_000 };
const RAMP_MAX_STEPS = 8; // caps the ramp so late-game isn't literally unplayable
const AREA_W = 320;
const AREA_H = 480;

interface FruitObj {
  id: number;
  x: number;
  y: number;
  emoji: string;
  sliced: boolean;
  bomb: boolean;
}

let nextId = 0;

export default function FruitSlicer({
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

  const [fruits, setFruits] = useState<FruitObj[]>([]);
  const [score, setScore] = useState(0);
  const [lives, setLives] = useState(3);
  const [over, setOver] = useState(false);
  const [slashPath, setSlashPath] = useState<{ x: number; y: number }[]>([]);
  const [slashVisible, setSlashVisible] = useState(false);

  const scoreRef = useRef(0);
  const livesRef = useRef(3);
  const overRef = useRef(false);
  const fruitsRef = useRef<FruitObj[]>([]);
  fruitsRef.current = fruits;
  const isDragging = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const baseFallSpeed = FALL_SPEED[difficulty] ?? 2.5;
  const baseSpawnMs = SPAWN_MS[difficulty] ?? 1100;
  const useBombs = difficulty === "hard";

  // Ramp step increases periodically (see RAMP_INTERVAL_MS) — each step makes
  // fruit fall ~15% faster and spawn ~10% more often, capped at RAMP_MAX_STEPS.
  const [rampStep, setRampStep] = useState(0);
  const fallSpeed = baseFallSpeed * Math.pow(1.15, rampStep);
  const spawnMs = Math.max(300, baseSpawnMs * Math.pow(0.9, rampStep));

  useEffect(() => {
    if (over) return;
    const rampMs = RAMP_INTERVAL_MS[difficulty] ?? 45_000;
    const id = setInterval(() => {
      if (pausedRef.current || overRef.current) return;
      setRampStep((s) => Math.min(s + 1, RAMP_MAX_STEPS));
    }, rampMs);
    return () => clearInterval(id);
  }, [over, difficulty]);

  const endGame = useCallback(() => {
    if (overRef.current) return;
    overRef.current = true;
    setOver(true);
    if (scoreRef.current > 50) play("win");
    else play("lose");
    onGameOver(scoreRef.current);
  }, [onGameOver, play]);

  const loseLife = useCallback(() => {
    livesRef.current -= 1;
    setLives(livesRef.current);
    play("lose");
    if (livesRef.current <= 0) {
      setTimeout(endGame, 100);
    }
  }, [endGame, play]);

  // Spawn fruits
  useEffect(() => {
    if (over) return;
    const id = setInterval(() => {
      if (pausedRef.current || overRef.current) return;
      const isBomb = useBombs && Math.random() < 0.25;
      const emoji = isBomb ? "💣" : FRUITS[Math.floor(Math.random() * FRUITS.length)];
      setFruits((prev) => [
        ...prev,
        { id: nextId++, x: 24 + Math.random() * (AREA_W - 48), y: -30, emoji, sliced: false, bomb: isBomb },
      ]);
    }, spawnMs);
    return () => clearInterval(id);
  }, [over, spawnMs, useBombs]);

  // Move fruits downward
  useEffect(() => {
    if (over) return;
    const id = setInterval(() => {
      if (pausedRef.current || overRef.current) return;
      setFruits((prev) => {
        const next: FruitObj[] = [];
        for (const f of prev) {
          if (f.sliced) {
            // keep briefly for animation, then remove
            next.push(f);
            continue;
          }
          const ny = f.y + fallSpeed;
          if (ny > AREA_H + 30) {
            // missed an unsliced fruit
            if (!f.bomb) {
              // miss — lose a life
              livesRef.current -= 1;
              setLives(livesRef.current);
              play("miss");
              if (livesRef.current <= 0) setTimeout(endGame, 100);
            }
            // bombs just disappear
          } else {
            next.push({ ...f, y: ny });
          }
        }
        return next;
      });
    }, 30);
    return () => clearInterval(id);
  }, [over, fallSpeed, endGame, play]);

  // Slash detection
  const checkSlash = useCallback((path: { x: number; y: number }[]) => {
    if (path.length < 2) return;
    setFruits((prev) => {
      let changed = false;
      const next = prev.map((f) => {
        if (f.sliced) return f;
        // Check if any segment of the path intersects the fruit circle (r=24)
        for (let i = 0; i < path.length - 1; i++) {
          const p1 = path[i];
          const p2 = path[i + 1];
          const dx = p2.x - p1.x;
          const dy = p2.y - p1.y;
          const len = Math.sqrt(dx * dx + dy * dy);
          if (len === 0) continue;
          const t = Math.max(0, Math.min(1, ((f.x - p1.x) * dx + (f.y - p1.y) * dy) / (len * len)));
          const nearX = p1.x + t * dx;
          const nearY = p1.y + t * dy;
          const dist = Math.sqrt((f.x - nearX) ** 2 + (f.y - nearY) ** 2);
          if (dist < 28) {
            changed = true;
            if (f.bomb) {
              // bomb hit
              setTimeout(() => {
                play("miss");
                livesRef.current -= 1;
                setLives(livesRef.current);
                if (livesRef.current <= 0) setTimeout(endGame, 100);
              }, 0);
              return { ...f, sliced: true };
            } else {
              scoreRef.current += 10;
              setTimeout(() => {
                setScore(scoreRef.current);
                onScore?.(scoreRef.current);
                play("score");
              }, 0);
              return { ...f, sliced: true };
            }
          }
        }
        return f;
      });
      if (changed) {
        // Remove sliced fruits after animation
        setTimeout(() => {
          setFruits((p) => p.filter((f) => !f.sliced));
        }, 400);
        return next;
      }
      return prev;
    });
  }, [endGame, onScore, play]);

  const getPos = (e: React.MouseEvent | React.TouchEvent) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return null;
    if ("touches" in e) {
      const t = e.touches[0];
      return { x: t.clientX - rect.left, y: t.clientY - rect.top };
    }
    return { x: (e as React.MouseEvent).clientX - rect.left, y: (e as React.MouseEvent).clientY - rect.top };
  };

  const onPointerDown = (e: React.MouseEvent | React.TouchEvent) => {
    if (over || pausedRef.current) return;
    e.preventDefault();
    const pos = getPos(e);
    if (!pos) return;
    isDragging.current = true;
    setSlashPath([pos]);
    setSlashVisible(true);
  };

  const onPointerMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDragging.current || over) return;
    e.preventDefault();
    const pos = getPos(e);
    if (!pos) return;
    setSlashPath((prev) => {
      const next = [...prev, pos];
      checkSlash(next.slice(-8));
      return next.slice(-20);
    });
  };

  const onPointerUp = () => {
    isDragging.current = false;
    setTimeout(() => { setSlashVisible(false); setSlashPath([]); }, 150);
  };

  return (
    <div className="flex flex-col items-center gap-3 select-none w-full max-w-sm mx-auto">
      <div className="flex w-full items-center justify-between px-2 text-sm font-semibold">
        <span className="text-emerald-400">Score: {score}</span>
        <span className="text-red-400">{"❤️".repeat(Math.max(0, lives))}</span>
      </div>

      <div
        ref={containerRef}
        className="relative overflow-hidden rounded-2xl border border-border bg-gradient-to-b from-neutral-900 to-neutral-950 cursor-crosshair touch-none"
        style={{ width: AREA_W, height: AREA_H }}
        onMouseDown={onPointerDown}
        onMouseMove={onPointerMove}
        onMouseUp={onPointerUp}
        onMouseLeave={onPointerUp}
        onTouchStart={onPointerDown}
        onTouchMove={onPointerMove}
        onTouchEnd={onPointerUp}
      >
        {/* Slash trail SVG */}
        {slashVisible && slashPath.length > 1 && (
          <svg className="absolute inset-0 pointer-events-none" width={AREA_W} height={AREA_H}>
            <polyline
              points={slashPath.map((p) => `${p.x},${p.y}`).join(" ")}
              fill="none"
              stroke="white"
              strokeWidth={3}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={0.7}
            />
          </svg>
        )}

        {fruits.map((f) => (
          <div
            key={f.id}
            className="absolute flex items-center justify-center pointer-events-none"
            style={{
              left: f.x - 24,
              top: f.y - 24,
              width: 48,
              height: 48,
              fontSize: 32,
              transition: f.sliced ? "transform 0.3s, opacity 0.3s" : undefined,
              transform: f.sliced ? "scale(1.5)" : "scale(1)",
              opacity: f.sliced ? 0 : 1,
            }}
          >
            {f.sliced && !f.bomb ? "✨" : f.emoji}
          </div>
        ))}

        {over && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/70 rounded-2xl">
            <div className="text-5xl mb-3">🍉</div>
            <div className="text-white font-bold text-2xl">Game Over!</div>
            <div className="text-emerald-400 font-bold text-lg mt-1">Score: {score}</div>
          </div>
        )}
      </div>

      <p className="text-xs text-muted-foreground">Drag to slice fruit! Avoid 💣 bombs!</p>
    </div>
  );
}
