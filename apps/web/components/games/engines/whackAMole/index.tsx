"use client";

/**
 * Whack-a-Mole — moles pop up from holes, tap/click them before they hide.
 * 9 holes in 3×3 grid. 30 second timer. Score = hits*10, miss penalty -3.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import type { GameEngineProps } from "@/components/games/types";
import { useGameSound } from "@/components/games/useGameSound";

const VISIBLE_MS: Record<string, number> = { easy: 1500, medium: 1000, hard: 700 };
const MAX_ACTIVE: Record<string, number> = { easy: 1, medium: 2, hard: 3 };
const SPAWN_MS: Record<string, number> = { easy: 1200, medium: 800, hard: 600 };

interface Mole {
  active: boolean;
  whacked: boolean;
  timerId: ReturnType<typeof setTimeout> | null;
}

export default function WhackAMole({
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

  const [moles, setMoles] = useState<Mole[]>(
    Array.from({ length: 9 }, () => ({ active: false, whacked: false, timerId: null }))
  );
  const [score, setScore] = useState(0);
  const [timeLeft, setTimeLeft] = useState(30);
  const [over, setOver] = useState(false);

  const scoreRef = useRef(0);
  const overRef = useRef(false);
  const molesRef = useRef(moles);
  molesRef.current = moles;

  const visibleMs = VISIBLE_MS[difficulty] ?? 1000;
  const maxActive = MAX_ACTIVE[difficulty] ?? 2;
  const spawnMs = SPAWN_MS[difficulty] ?? 800;

  const endGame = useCallback(() => {
    if (overRef.current) return;
    overRef.current = true;
    setOver(true);
    // Clear all mole timers
    molesRef.current.forEach((m) => { if (m.timerId) clearTimeout(m.timerId); });
    if (scoreRef.current > 0) play("win");
    else play("lose");
    onGameOver(scoreRef.current);
  }, [onGameOver, play]);

  // Countdown timer
  useEffect(() => {
    if (over) return;
    const id = setInterval(() => {
      if (pausedRef.current || overRef.current) return;
      setTimeLeft((t) => {
        if (t <= 1) {
          setTimeout(endGame, 0);
          return 0;
        }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [over, endGame]);

  // Hide a mole after its visible time (miss)
  const hideMole = useCallback((idx: number) => {
    setMoles((prev) => {
      const next = [...prev];
      if (!next[idx].whacked) {
        // missed — no score penalty here, just hide
        play("miss");
        scoreRef.current = Math.max(0, scoreRef.current - 3);
        setScore(scoreRef.current);
        onScore?.(scoreRef.current);
      }
      next[idx] = { ...next[idx], active: false, whacked: false, timerId: null };
      return next;
    });
  }, [play, onScore]);

  // Spawn moles
  useEffect(() => {
    if (over) return;
    const id = setInterval(() => {
      if (pausedRef.current || overRef.current) return;
      const current = molesRef.current;
      const activeCount = current.filter((m) => m.active).length;
      if (activeCount >= maxActive) return;
      const inactiveIdxs = current
        .map((m, i) => (!m.active ? i : -1))
        .filter((i) => i >= 0);
      if (inactiveIdxs.length === 0) return;
      const idx = inactiveIdxs[Math.floor(Math.random() * inactiveIdxs.length)];
      const tid = setTimeout(() => hideMole(idx), visibleMs);
      setMoles((prev) => {
        const next = [...prev];
        if (next[idx].timerId) clearTimeout(next[idx].timerId!);
        next[idx] = { active: true, whacked: false, timerId: tid };
        return next;
      });
    }, spawnMs);
    return () => clearInterval(id);
  }, [over, maxActive, spawnMs, visibleMs, hideMole]);

  const whackMole = useCallback((idx: number) => {
    if (over || pausedRef.current) return;
    setMoles((prev) => {
      const m = prev[idx];
      if (!m.active || m.whacked) return prev;
      if (m.timerId) clearTimeout(m.timerId);
      const next = [...prev];
      next[idx] = { ...m, whacked: true, timerId: null };
      // hide after whack animation
      setTimeout(() => {
        setMoles((p) => {
          const n = [...p];
          n[idx] = { active: false, whacked: false, timerId: null };
          return n;
        });
      }, 300);
      return next;
    });
    scoreRef.current += 10;
    setScore(scoreRef.current);
    onScore?.(scoreRef.current);
    play("pop");
  }, [over, play, onScore]);

  return (
    <div className="flex flex-col items-center gap-3 select-none w-full max-w-sm mx-auto">
      {/* HUD */}
      <div className="flex w-full items-center justify-between px-2 text-sm font-semibold">
        <span className="text-emerald-400">Score: {score}</span>
        <span className={timeLeft <= 5 ? "text-red-400 animate-pulse" : "text-foreground"}>
          ⏱ {timeLeft}s
        </span>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-3 gap-3 p-4 rounded-2xl border border-border bg-card w-full">
        {moles.map((mole, idx) => (
          <button
            key={idx}
            type="button"
            onClick={() => whackMole(idx)}
            disabled={over || !mole.active}
            className="relative flex items-end justify-center overflow-hidden rounded-full border-2 border-border bg-muted transition-all duration-150 hover:bg-accent active:scale-95"
            style={{ height: 80 }}
          >
            {/* Hole bottom */}
            <div className="absolute bottom-0 w-full h-8 rounded-full bg-neutral-900 border-t-2 border-border" />
            {/* Mole */}
            <span
              className="relative z-10 text-3xl transition-transform duration-200"
              style={{
                transform: mole.active ? "translateY(0)" : "translateY(100%)",
                opacity: mole.active ? 1 : 0,
              }}
            >
              {mole.whacked ? "💫" : "🐭"}
            </span>
          </button>
        ))}
      </div>

      {over && (
        <div className="text-center py-2">
          <div className="text-2xl font-bold text-foreground">
            {score > 0 ? "🎉 Time's Up!" : "😔 Better Luck!"}
          </div>
          <div className="text-emerald-400 font-bold text-lg">Final Score: {score}</div>
        </div>
      )}

      <p className="text-xs text-muted-foreground">Tap the moles before they hide!</p>
    </div>
  );
}
