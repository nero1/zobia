"use client";

/**
 * Tap Frenzy — tap the button as many times as you can in 15 seconds.
 * Score = total taps. Gentle ripple animation on each tap.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import type { GameEngineProps } from "@/components/games/types";
import { useGameSound } from "@/components/games/useGameSound";

const DURATIONS: Record<string, number> = { easy: 20, medium: 15, hard: 10 };

export default function TapFrenzyGame({ onReady, onGameOver, onScore, difficulty = "medium", paused, soundEnabled = true }: GameEngineProps) {
  const dur = DURATIONS[difficulty] ?? 15;
  const [taps, setTaps] = useState(0);
  const [timeLeft, setTimeLeft] = useState(dur);
  const [started, setStarted] = useState(false);
  const [done, setDone] = useState(false);
  const [ripples, setRipples] = useState<{ id: number; x: number; y: number }[]>([]);
  const tapsRef = useRef(0);
  const doneRef = useRef(false);
  const pausedRef = useRef(paused);
  const play = useGameSound(soundEnabled ?? true);
  const rippleId = useRef(0);

  useEffect(() => { pausedRef.current = paused; }, [paused]);

  useEffect(() => {
    onReady?.();
  }, [onReady]);

  useEffect(() => {
    if (!started || done) return;
    const id = setInterval(() => {
      if (pausedRef.current) return;
      setTimeLeft((t) => {
        if (t <= 1) {
          clearInterval(id);
          if (!doneRef.current) {
            doneRef.current = true;
            setDone(true);
            onGameOver(tapsRef.current);
          }
          return 0;
        }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [started, done, onGameOver]);

  const handleTap = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (done || (paused && started)) return;
    if (!started) setStarted(true);

    tapsRef.current += 1;
    setTaps(tapsRef.current);
    onScore?.(tapsRef.current);
    play("tap");

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const clientX = "touches" in e ? e.touches[0]?.clientX ?? rect.left + rect.width / 2 : e.clientX;
    const clientY = "touches" in e ? e.touches[0]?.clientY ?? rect.top + rect.height / 2 : e.clientY;
    const x = ((clientX - rect.left) / rect.width) * 100;
    const y = ((clientY - rect.top) / rect.height) * 100;

    const id = rippleId.current++;
    setRipples((r) => [...r.slice(-8), { id, x, y }]);
    setTimeout(() => setRipples((r) => r.filter((rp) => rp.id !== id)), 500);
  }, [done, paused, started, onScore, play]);

  const progress = ((dur - timeLeft) / dur) * 100;
  const urgency = timeLeft <= 5;

  return (
    <div className="flex flex-col items-center gap-4 select-none w-full max-w-sm mx-auto">
      <div className="flex w-full items-center justify-between text-sm font-semibold text-neutral-200 px-1">
        <span>Taps: <span className="text-emerald-400 text-lg">{taps}</span></span>
        <span className={urgency ? "text-red-400 animate-pulse" : "text-neutral-300"}>
          {started ? `${timeLeft}s` : "Tap to start!"}
        </span>
      </div>

      {/* Progress bar */}
      <div className="w-full h-2 bg-neutral-800 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-1000 ${urgency ? "bg-red-500" : "bg-emerald-500"}`}
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Tap zone */}
      <button
        type="button"
        onMouseDown={handleTap}
        onTouchStart={handleTap}
        disabled={done}
        className="relative overflow-hidden w-full h-64 rounded-2xl bg-gradient-to-br from-purple-700 to-indigo-900 border-2 border-purple-500/40 flex items-center justify-center cursor-pointer active:scale-95 transition-transform disabled:opacity-60"
        aria-label="Tap here"
      >
        {ripples.map((r) => (
          <span
            key={r.id}
            className="pointer-events-none absolute rounded-full bg-white/20 animate-ping"
            style={{
              left: `${r.x}%`,
              top: `${r.y}%`,
              width: 60,
              height: 60,
              transform: "translate(-50%,-50%)",
              animationDuration: "0.5s",
              animationIterationCount: 1,
            }}
          />
        ))}
        <div className="flex flex-col items-center gap-2 pointer-events-none">
          <span className="text-6xl">{done ? "🏁" : "👆"}</span>
          <span className="text-white font-bold text-lg">
            {done ? "Time's up!" : started ? "KEEP TAPPING!" : "TAP TO START"}
          </span>
          {!started && (
            <span className="text-purple-300 text-sm">Tap as fast as you can!</span>
          )}
        </div>
      </button>

      {done && (
        <div className="text-center text-sm text-neutral-300">
          Final score: <span className="text-emerald-400 font-bold text-xl">{taps} taps</span>
          {" "}in {dur} seconds
          {taps > 5 && <span className="ml-1 text-neutral-400">({(taps / dur).toFixed(1)} taps/sec)</span>}
        </div>
      )}
    </div>
  );
}
