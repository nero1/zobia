"use client";

/**
 * Speed Tap — circular targets appear at random positions, tap before they shrink.
 * Hit = +10, expire = -5. 30 second timer.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import type { GameEngineProps } from "@/components/games/types";
import { useGameSound } from "@/components/games/useGameSound";

const AREA_W = 300;
const AREA_H = 380;
const TARGET_R = 36;
const TARGET_LIFETIME: Record<string, number> = { easy: 2000, medium: 1200, hard: 800 };
const MAX_TARGETS: Record<string, number> = { easy: 1, medium: 2, hard: 2 };
const SPAWN_MS: Record<string, number> = { easy: 1800, medium: 1100, hard: 750 };
const COLORS = ["#f87171", "#fb923c", "#fbbf24", "#4ade80", "#38bdf8", "#818cf8", "#e879f9", "#f472b6"];

interface Target {
  id: number;
  x: number;
  y: number;
  color: string;
  born: number; // timestamp
  lifetime: number;
  hit: boolean;
}

let tgtId = 0;

export default function SpeedTap({
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

  const lifetime = TARGET_LIFETIME[difficulty] ?? 1200;
  const maxTargets = MAX_TARGETS[difficulty] ?? 2;
  const spawnMs = SPAWN_MS[difficulty] ?? 1100;

  const [targets, setTargets] = useState<Target[]>([]);
  const [score, setScore] = useState(0);
  const [timeLeft, setTimeLeft] = useState(30);
  const [over, setOver] = useState(false);
  const [tick, setTick] = useState(0); // force re-render for scale

  const scoreRef = useRef(0);
  const overRef = useRef(false);
  const targetsRef = useRef<Target[]>([]);
  targetsRef.current = targets;

  const endGame = useCallback(() => {
    if (overRef.current) return;
    overRef.current = true;
    setOver(true);
    play("win");
    onGameOver(scoreRef.current);
  }, [onGameOver, play]);

  // Countdown
  useEffect(() => {
    if (over) return;
    const id = setInterval(() => {
      if (pausedRef.current || overRef.current) return;
      setTimeLeft((t) => {
        if (t <= 1) { setTimeout(endGame, 0); return 0; }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [over, endGame]);

  // Force re-render for scale animation
  useEffect(() => {
    if (over) return;
    const id = setInterval(() => {
      if (!pausedRef.current && !overRef.current) setTick((t) => t + 1);
    }, 50);
    return () => clearInterval(id);
  }, [over]);

  // Spawn targets
  useEffect(() => {
    if (over) return;
    const id = setInterval(() => {
      if (pausedRef.current || overRef.current) return;
      if (targetsRef.current.filter((t) => !t.hit).length >= maxTargets) return;
      const color = COLORS[Math.floor(Math.random() * COLORS.length)];
      const x = TARGET_R + Math.random() * (AREA_W - TARGET_R * 2);
      const y = TARGET_R + Math.random() * (AREA_H - TARGET_R * 2);
      setTargets((prev) => [...prev, { id: tgtId++, x, y, color, born: Date.now(), lifetime, hit: false }]);
    }, spawnMs);
    return () => clearInterval(id);
  }, [over, maxTargets, spawnMs, lifetime]);

  // Expire targets
  useEffect(() => {
    if (over) return;
    const id = setInterval(() => {
      if (pausedRef.current || overRef.current) return;
      const now = Date.now();
      setTargets((prev) => {
        const expired = prev.filter((t) => !t.hit && now - t.born > t.lifetime);
        if (expired.length > 0) {
          scoreRef.current = Math.max(0, scoreRef.current - expired.length * 5);
          setScore(scoreRef.current);
          onScore?.(scoreRef.current);
          play("miss");
        }
        return prev.filter((t) => t.hit || now - t.born <= t.lifetime);
      });
    }, 100);
    return () => clearInterval(id);
  }, [over, onScore, play]);

  const hitTarget = useCallback((id: number) => {
    if (over || pausedRef.current) return;
    setTargets((prev) => {
      const t = prev.find((t) => t.id === id);
      if (!t || t.hit) return prev;
      scoreRef.current += 10;
      setScore(scoreRef.current);
      onScore?.(scoreRef.current);
      play("tap");
      setTimeout(() => setTargets((p) => p.filter((t) => t.id !== id)), 200);
      return prev.map((t) => t.id === id ? { ...t, hit: true } : t);
    });
  }, [over, onScore, play]);

  const now = Date.now();

  return (
    <div className="flex flex-col items-center gap-3 select-none w-full max-w-sm mx-auto">
      <div className="flex w-full items-center justify-between px-2 text-sm font-semibold">
        <span className="text-emerald-400">Score: {score}</span>
        <span className={timeLeft <= 5 ? "text-red-400 animate-pulse" : "text-foreground"}>
          ⏱ {timeLeft}s
        </span>
      </div>

      <div
        className="relative overflow-hidden rounded-2xl border border-border bg-card"
        style={{ width: AREA_W, height: AREA_H }}
      >
        {targets.map((t) => {
          const elapsed = now - t.born;
          const frac = Math.max(0, 1 - elapsed / t.lifetime);
          const scale = t.hit ? 1.4 : frac;
          const opacity = t.hit ? 0 : 1;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => hitTarget(t.id)}
              disabled={t.hit || over}
              className="absolute flex items-center justify-center rounded-full border-4 border-white/30 font-bold text-white text-lg transition-opacity"
              style={{
                left: t.x - TARGET_R,
                top: t.y - TARGET_R,
                width: TARGET_R * 2,
                height: TARGET_R * 2,
                backgroundColor: t.color,
                transform: `scale(${scale})`,
                opacity,
                transition: t.hit ? "transform 0.2s, opacity 0.2s" : undefined,
              }}
            >
              🎯
            </button>
          );
        })}

        {over && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 rounded-2xl">
            <div className="text-4xl mb-2">🎯</div>
            <div className="text-white font-bold text-xl">Time&apos;s Up!</div>
            <div className="text-emerald-400 font-bold text-lg mt-1">Score: {score}</div>
          </div>
        )}
      </div>

      <p className="text-xs text-muted-foreground">Tap targets before they shrink away!</p>
    </div>
  );
}
