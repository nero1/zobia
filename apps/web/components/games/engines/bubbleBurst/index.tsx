"use client";

/**
 * Bubble Burst — tap floating bubbles before they escape off the top.
 * Miss 5 and it's game over. Bubbles accelerate over time.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import type { GameEngineProps } from "@/components/games/types";
import { useGameSound } from "@/components/games/useGameSound";

const COLORS = ["#f87171","#fb923c","#fbbf24","#4ade80","#38bdf8","#818cf8","#e879f9","#f472b6"];
const MISS_LIMIT: Record<string, number> = { easy: 8, medium: 5, hard: 3 };
const BASE_SPEED: Record<string, number> = { easy: 0.6, medium: 1.0, hard: 1.5 };
const SPAWN_MS: Record<string, number> = { easy: 1800, medium: 1300, hard: 900 };

interface Bubble { id: number; x: number; y: number; r: number; color: string; popped: boolean; burst: boolean }

let nextId = 0;

export default function BubbleBurstGame({ onReady, onGameOver, onScore, difficulty = "medium", paused, soundEnabled = true }: GameEngineProps) {
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [score, setScore] = useState(0);
  const [missed, setMissed] = useState(0);
  const [over, setOver] = useState(false);
  const scoreRef = useRef(0);
  const missedRef = useRef(0);
  const overRef = useRef(false);
  const pausedRef = useRef(paused);
  const play = useGameSound(soundEnabled ?? true);
  const missLimit = MISS_LIMIT[difficulty] ?? 5;
  const baseSpeed = BASE_SPEED[difficulty] ?? 1.0;
  const spawnMs = SPAWN_MS[difficulty] ?? 1300;

  useEffect(() => { pausedRef.current = paused; }, [paused]);
  useEffect(() => { onReady?.(); }, [onReady]);

  const end = useCallback(() => {
    if (overRef.current) return;
    overRef.current = true;
    setOver(true);
    play("lose");
    onGameOver(scoreRef.current);
  }, [onGameOver, play]);

  // Spawn bubbles
  useEffect(() => {
    if (over) return;
    const id = setInterval(() => {
      if (pausedRef.current || overRef.current) return;
      const r = 22 + Math.random() * 20;
      setBubbles((b) => [
        ...b,
        { id: nextId++, x: r + Math.random() * (320 - 2 * r), y: 480 + r, r, color: COLORS[Math.floor(Math.random() * COLORS.length)], popped: false, burst: false },
      ]);
    }, spawnMs);
    return () => clearInterval(id);
  }, [over, spawnMs]);

  // Move bubbles upward
  useEffect(() => {
    if (over) return;
    const id = setInterval(() => {
      if (pausedRef.current || overRef.current) return;
      setBubbles((prev) => {
        const speed = baseSpeed * (1 + scoreRef.current / 300);
        const next: Bubble[] = [];
        let newMiss = 0;
        for (const b of prev) {
          if (b.popped) {
            if (b.burst) continue; // remove burst bubbles after animation
            next.push(b);
            continue;
          }
          const ny = b.y - speed;
          if (ny + b.r < 0) {
            newMiss++;
          } else {
            next.push({ ...b, y: ny });
          }
        }
        if (newMiss > 0) {
          missedRef.current += newMiss;
          setMissed(missedRef.current);
          play("miss");
          if (missedRef.current >= missLimit) {
            setTimeout(end, 50);
          }
        }
        return next;
      });
    }, 33);
    return () => clearInterval(id);
  }, [over, baseSpeed, end, play, missLimit]);

  const popBubble = useCallback((id: number) => {
    if (over) return;
    setBubbles((prev) => prev.map((b) => b.id === id && !b.popped ? { ...b, popped: true, burst: true } : b));
    scoreRef.current += 10;
    setScore(scoreRef.current);
    onScore?.(scoreRef.current);
    play("pop");
    // Remove burst bubble after animation
    setTimeout(() => {
      setBubbles((prev) => prev.filter((b) => b.id !== id));
    }, 300);
  }, [over, onScore, play]);

  return (
    <div className="flex flex-col items-center gap-3 select-none">
      <div className="flex w-full max-w-xs items-center justify-between text-sm font-semibold px-1">
        <span className="text-emerald-400">Score: {score}</span>
        <span className={missedRef.current >= missLimit - 1 ? "text-red-400 animate-pulse" : "text-neutral-400"}>
          Missed: {missed}/{missLimit}
        </span>
      </div>
      <div
        className="relative overflow-hidden rounded-2xl border border-neutral-700 bg-gradient-to-b from-sky-950 to-neutral-950"
        style={{ width: 320, height: 480 }}
      >
        {bubbles.map((b) => (
          <button
            key={b.id}
            type="button"
            onClick={() => popBubble(b.id)}
            className={`absolute rounded-full flex items-center justify-center border-2 border-white/20 transition-transform ${b.burst ? "scale-150 opacity-0 duration-300" : "scale-100 opacity-100"} ${!b.popped ? "hover:scale-110 active:scale-90" : ""}`}
            style={{
              left: b.x - b.r,
              top: b.y - b.r,
              width: b.r * 2,
              height: b.r * 2,
              backgroundColor: b.color + "bb",
              cursor: b.popped ? "default" : "pointer",
            }}
            disabled={b.popped || over}
          >
            <span className="text-white text-xs font-bold select-none">✕</span>
          </button>
        ))}
        {over && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 rounded-2xl">
            <div className="text-4xl mb-2">💥</div>
            <div className="text-white font-bold text-xl">Game Over!</div>
            <div className="text-neutral-300 text-sm mt-1">Final score: {score}</div>
          </div>
        )}
      </div>
      <p className="text-xs text-neutral-400">Tap bubbles before they escape!</p>
    </div>
  );
}
