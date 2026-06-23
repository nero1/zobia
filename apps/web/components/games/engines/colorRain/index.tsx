"use client";

/**
 * Color Rain — colored drops fall, tap only those matching the target color.
 * 4 colors. 3 lives. Correct tap = +10, wrong tap = -1 life, miss = -1 life.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import type { GameEngineProps } from "@/components/games/types";
import { useGameSound } from "@/components/games/useGameSound";

const W = 320;
const H = 420;
const DROP_R = 20;
const COLORS = [
  { key: "red", emoji: "🔴", bg: "#ef4444", label: "Red" },
  { key: "blue", emoji: "🔵", bg: "#3b82f6", label: "Blue" },
  { key: "green", emoji: "🟢", bg: "#22c55e", label: "Green" },
  { key: "yellow", emoji: "🟡", bg: "#eab308", label: "Yellow" },
] as const;
type ColorKey = (typeof COLORS)[number]["key"];

const FALL_SPEED: Record<string, number> = { easy: 1.5, medium: 2.8, hard: 4.5 };
const SPAWN_MS: Record<string, number> = { easy: 1400, medium: 900, hard: 600 };
const TARGET_CHANGE_MS = 6000;

interface Drop {
  id: number;
  x: number;
  y: number;
  color: ColorKey;
  tapped: boolean;
  missed: boolean;
}

let dropId = 0;

export default function ColorRain({
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

  const fallSpeed = FALL_SPEED[difficulty] ?? 2.8;
  const spawnMs = SPAWN_MS[difficulty] ?? 900;

  const [drops, setDrops] = useState<Drop[]>([]);
  const [score, setScore] = useState(0);
  const [lives, setLives] = useState(3);
  const [targetColor, setTargetColor] = useState<ColorKey>("red");
  const [over, setOver] = useState(false);

  const scoreRef = useRef(0);
  const livesRef = useRef(3);
  const overRef = useRef(false);
  const dropsRef = useRef<Drop[]>([]);
  dropsRef.current = drops;
  const targetRef = useRef<ColorKey>("red");
  targetRef.current = targetColor;

  const endGame = useCallback(() => {
    if (overRef.current) return;
    overRef.current = true;
    setOver(true);
    play("lose");
    onGameOver(scoreRef.current);
  }, [onGameOver, play]);

  const loseLife = useCallback(() => {
    livesRef.current -= 1;
    setLives(livesRef.current);
    play("miss");
    if (livesRef.current <= 0) setTimeout(endGame, 100);
  }, [endGame, play]);

  // Target color changes
  useEffect(() => {
    if (over) return;
    const id = setInterval(() => {
      if (pausedRef.current || overRef.current) return;
      const others = COLORS.filter((c) => c.key !== targetRef.current);
      const next = others[Math.floor(Math.random() * others.length)].key;
      setTargetColor(next);
    }, TARGET_CHANGE_MS);
    return () => clearInterval(id);
  }, [over]);

  // Spawn drops
  useEffect(() => {
    if (over) return;
    const id = setInterval(() => {
      if (pausedRef.current || overRef.current) return;
      const color = COLORS[Math.floor(Math.random() * COLORS.length)].key;
      setDrops((prev) => [
        ...prev,
        { id: dropId++, x: DROP_R + Math.random() * (W - DROP_R * 2), y: -DROP_R, color, tapped: false, missed: false },
      ]);
    }, spawnMs);
    return () => clearInterval(id);
  }, [over, spawnMs]);

  // Move drops
  useEffect(() => {
    if (over) return;
    const id = setInterval(() => {
      if (pausedRef.current || overRef.current) return;
      setDrops((prev) => {
        const next: Drop[] = [];
        for (const d of prev) {
          if (d.tapped) { next.push(d); continue; }
          const ny = d.y + fallSpeed;
          if (ny > H + DROP_R) {
            // Missed — lose a life if it was the target color
            if (d.color === targetRef.current) {
              livesRef.current -= 1;
              setLives(livesRef.current);
              play("miss");
              if (livesRef.current <= 0) setTimeout(endGame, 100);
            }
            // Non-target drops just disappear
          } else {
            next.push({ ...d, y: ny });
          }
        }
        dropsRef.current = next;
        return next;
      });
    }, 30);
    return () => clearInterval(id);
  }, [over, fallSpeed, endGame, play]);

  const tapDrop = useCallback((id: number, color: ColorKey) => {
    if (over || pausedRef.current) return;
    if (color === targetRef.current) {
      // Correct!
      scoreRef.current += 10;
      setScore(scoreRef.current);
      onScore?.(scoreRef.current);
      play("match");
      setDrops((prev) => prev.map((d) => d.id === id ? { ...d, tapped: true } : d));
      setTimeout(() => setDrops((p) => p.filter((d) => d.id !== id)), 300);
      play("pop");
    } else {
      // Wrong color
      loseLife();
      setDrops((prev) => prev.map((d) => d.id === id ? { ...d, tapped: true } : d));
      setTimeout(() => setDrops((p) => p.filter((d) => d.id !== id)), 300);
    }
  }, [over, onScore, play, loseLife]);

  const targetDef = COLORS.find((c) => c.key === targetColor)!;

  return (
    <div className="flex flex-col items-center gap-3 select-none w-full max-w-sm mx-auto">
      {/* HUD */}
      <div className="flex w-full items-center justify-between px-2 text-sm font-semibold">
        <span className="text-emerald-400">Score: {score}</span>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground text-xs">Tap:</span>
          <span className="text-2xl">{targetDef.emoji}</span>
          <span className="text-foreground font-bold">{targetDef.label}</span>
        </div>
        <span className="text-red-400">{"❤️".repeat(Math.max(0, lives))}</span>
      </div>

      {/* Play area */}
      <div
        className="relative overflow-hidden rounded-2xl border border-border bg-gradient-to-b from-slate-900 to-slate-950"
        style={{ width: W, height: H }}
      >
        {/* Target color indicator bar at top */}
        <div
          className="absolute top-0 left-0 right-0 h-1 transition-colors duration-500"
          style={{ backgroundColor: targetDef.bg }}
        />

        {drops.map((d) => {
          const def = COLORS.find((c) => c.key === d.color)!;
          const isTarget = d.color === targetColor;
          return (
            <button
              key={d.id}
              type="button"
              onClick={() => tapDrop(d.id, d.color)}
              disabled={d.tapped || over}
              className="absolute flex items-center justify-center rounded-full border-2 border-white/20 transition-all duration-150 hover:scale-110 active:scale-90"
              style={{
                left: d.x - DROP_R,
                top: d.y - DROP_R,
                width: DROP_R * 2,
                height: DROP_R * 2,
                backgroundColor: def.bg,
                opacity: d.tapped ? 0 : 1,
                boxShadow: isTarget ? `0 0 8px ${def.bg}` : undefined,
              }}
            >
              <span className="text-sm">{def.emoji}</span>
            </button>
          );
        })}

        {over && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/70 rounded-2xl">
            <div className="text-5xl mb-3">🌧️</div>
            <div className="text-white font-bold text-2xl">Game Over!</div>
            <div className="text-emerald-400 font-bold text-lg mt-1">Score: {score}</div>
          </div>
        )}
      </div>

      <p className="text-xs text-muted-foreground">Tap only {targetDef.emoji} drops! Wrong color loses a life.</p>
    </div>
  );
}
