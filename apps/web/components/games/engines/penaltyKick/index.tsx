"use client";

/**
 * Penalty Kick — 5-kick penalty shootout.
 * Phase 1: cursor sweeps across a 3×3 goal, tap to aim.
 * Phase 2: power bar sweeps up/down, tap to shoot.
 * Goalkeeper dives to a random section.
 */

import { useEffect, useState, useCallback, useRef } from "react";
import type { GameEngineProps } from "@/components/games/types";
import { useGameSound } from "@/components/games/useGameSound";

type Phase = "aim" | "power" | "result" | "done";

interface KickResult {
  aim: number;       // 0-8 (3×3 grid index)
  power: number;     // 0-100
  gkDiv: number;     // goalkeeper section(s)
  goal: boolean;
}

const GK_SECTIONS: Record<string, number> = { easy: 1, medium: 2, hard: 3 };

// Goal section labels
const SECTION_LABELS = ["↖", "↑", "↗", "←", "●", "→", "↙", "↓", "↘"];

export default function PenaltyKickGame({
  onReady, onGameOver, onScore, difficulty = "medium", paused, soundEnabled = true,
}: GameEngineProps) {
  const gkCover = GK_SECTIONS[difficulty] ?? 2;

  const [phase, setPhase] = useState<Phase>("aim");
  const [cursorPos, setCursorPos] = useState(0);  // 0-2 column
  const [aimCol, setAimCol] = useState<number | null>(null);
  const [aimRow, setAimRow] = useState<number | null>(null);
  const [power, setPower] = useState(0);
  const [powerDir, setPowerDir] = useState(1);
  const [kick, setKick] = useState(0); // 0-4
  const [results, setResults] = useState<KickResult[]>([]);
  const [goals, setGoals] = useState(0);
  const [gkPos, setGkPos] = useState<number>(4);
  const [animBall, setAnimBall] = useState(false);
  const [flashText, setFlashText] = useState<string | null>(null);

  const play = useGameSound(soundEnabled ?? true);
  const pausedRef = useRef(paused);
  const overRef = useRef(false);
  const phaseRef = useRef<Phase>("aim");
  const powerRef = useRef(0);
  const powerDirRef = useRef(1);
  const cursorRef = useRef(0);
  const cursorDirRef = useRef(1);

  useEffect(() => { pausedRef.current = paused; }, [paused]);
  useEffect(() => { onReady?.(); }, [onReady]);

  // Cursor sweep (aim phase)
  useEffect(() => {
    if (phaseRef.current !== "aim") return;
    const id = setInterval(() => {
      if (pausedRef.current) return;
      cursorRef.current += cursorDirRef.current;
      if (cursorRef.current >= 2) cursorDirRef.current = -1;
      if (cursorRef.current <= 0) cursorDirRef.current = 1;
      setCursorPos(cursorRef.current);
    }, 120);
    return () => clearInterval(id);
  }, [phase]);

  // Power bar sweep (power phase)
  useEffect(() => {
    if (phaseRef.current !== "power") return;
    const id = setInterval(() => {
      if (pausedRef.current) return;
      powerRef.current += powerDirRef.current * 3;
      if (powerRef.current >= 100) { powerRef.current = 100; powerDirRef.current = -1; }
      if (powerRef.current <= 0)   { powerRef.current = 0;   powerDirRef.current = 1; }
      setPower(powerRef.current);
    }, 30);
    return () => clearInterval(id);
  }, [phase]);

  const handleTap = useCallback(() => {
    if (pausedRef.current || overRef.current) return;

    if (phaseRef.current === "aim") {
      // Lock in column + random row
      const col = cursorRef.current;
      const row = Math.floor(Math.random() * 3);
      setAimCol(col);
      setAimRow(row);
      phaseRef.current = "power";
      setPhase("power");
      powerRef.current = 0;
      powerDirRef.current = 1;
      setPower(0);
      setPowerDir(1);
    } else if (phaseRef.current === "power") {
      const pwr = powerRef.current;
      const col = cursorRef.current; // carry from aim
      const row = aimRow ?? 1;
      const aimIdx = (row ?? 1) * 3 + (aimCol ?? 1);

      // Goalkeeper picks random section(s)
      const gkCenter = Math.floor(Math.random() * 9);
      setGkPos(gkCenter);
      phaseRef.current = "result";
      setPhase("result");

      // Build list of sections GK covers
      const covered = new Set<number>();
      covered.add(gkCenter);
      // Hard covers adjacent sections too
      if (gkCover >= 2) {
        const adj = [gkCenter - 1, gkCenter + 1, gkCenter - 3, gkCenter + 3];
        adj.forEach((s) => { if (s >= 0 && s < 9) covered.add(s); });
      }
      if (gkCover >= 3) {
        const adj2 = [gkCenter - 4, gkCenter + 4, gkCenter - 2, gkCenter + 2];
        adj2.forEach((s) => { if (s >= 0 && s < 9) covered.add(s); });
      }

      const isGoal = !covered.has(aimIdx) && pwr > 30;

      setAnimBall(true);
      setTimeout(() => setAnimBall(false), 600);

      const newGoals = goals + (isGoal ? 1 : 0);
      const newResults = [...results, { aim: aimIdx, power: pwr, gkDiv: gkCenter, goal: isGoal }];
      setResults(newResults);

      if (isGoal) {
        play("score");
        setFlashText("GOAL! ⚽");
        setGoals(newGoals);
        onScore?.(newGoals * 100);
      } else {
        play("miss");
        setFlashText("SAVED! 🧤");
      }

      setTimeout(() => {
        setFlashText(null);
        const nextKick = kick + 1;
        if (nextKick >= 5) {
          overRef.current = true;
          const finalScore = newGoals * 100;
          if (newGoals >= 3) play("win"); else play("lose");
          onGameOver(finalScore);
          phaseRef.current = "done";
          setPhase("done");
          setKick(5);
        } else {
          setKick(nextKick);
          setAimCol(null);
          setAimRow(null);
          phaseRef.current = "aim";
          setPhase("aim");
          cursorRef.current = 0;
          cursorDirRef.current = 1;
          setCursorPos(0);
        }
      }, 1500);
    }
  }, [aimRow, aimCol, goals, kick, results, gkCover, onScore, onGameOver, play]);

  return (
    <div className="flex flex-col items-center gap-4 select-none w-full max-w-sm mx-auto">
      {/* Header */}
      <div className="flex w-full justify-between items-center px-2">
        <span className="text-muted-foreground text-sm">Kick {Math.min(kick + 1, 5)}/5</span>
        <span className="text-2xl font-bold text-emerald-400">{goals * 100}</span>
        <div className="flex gap-1">
          {results.map((r, i) => (
            <span key={i} className="text-lg">{r.goal ? "✅" : "❌"}</span>
          ))}
          {Array.from({ length: 5 - results.length }, (_, i) => (
            <span key={`empty-${i}`} className="text-lg opacity-30">⚽</span>
          ))}
        </div>
      </div>

      {/* Stadium emoji */}
      <div className="text-2xl text-center">🏟️</div>

      {/* Goal grid 3×3 */}
      <div className="relative w-full">
        <div
          className="grid gap-1 rounded-xl overflow-hidden border-2 border-white/30 bg-green-900/40 p-2"
          style={{ gridTemplateColumns: "repeat(3, 1fr)" }}
        >
          {Array.from({ length: 9 }, (_, i) => {
            const isAim = phase === "result" || phase === "done"
              ? aimRow !== null && aimCol !== null && i === (aimRow * 3 + aimCol)
              : false;
            const isGk = (phase === "result" || phase === "done") && i === gkPos;
            const isCursorCol = phase === "aim" && i % 3 === cursorPos;
            return (
              <div
                key={i}
                className={`
                  h-14 rounded-lg flex items-center justify-center text-xl font-bold border transition-all duration-150
                  ${isCursorCol ? "bg-yellow-400/40 border-yellow-400" : "bg-white/10 border-white/20"}
                  ${isAim && !isGk ? "bg-emerald-500/60 border-emerald-400" : ""}
                  ${isGk && !isAim ? "bg-red-500/60 border-red-400" : ""}
                  ${isAim && isGk ? "bg-orange-500/60 border-orange-400" : ""}
                `}
              >
                {isGk ? "🧤" : isAim ? "⚽" : <span className="text-white/40 text-xs">{SECTION_LABELS[i]}</span>}
              </div>
            );
          })}
        </div>

        {/* Flash text overlay */}
        {flashText && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span className="text-3xl font-black text-white drop-shadow-lg animate-bounce bg-black/60 px-4 py-2 rounded-xl">
              {flashText}
            </span>
          </div>
        )}

        {/* Animated ball */}
        {animBall && (
          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 text-3xl animate-bounce pointer-events-none">
            ⚽
          </div>
        )}
      </div>

      {/* Power bar (only in power phase) */}
      {phase === "power" && (
        <div className="w-full space-y-1">
          <div className="flex justify-between text-xs text-muted-foreground px-1">
            <span>Power</span>
            <span className="font-bold text-foreground">{Math.round(power)}%</span>
          </div>
          <div className="w-full h-5 bg-neutral-800 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-none ${
                power > 70 ? "bg-red-500" : power > 40 ? "bg-emerald-500" : "bg-yellow-500"
              }`}
              style={{ width: `${power}%` }}
            />
          </div>
          <div className="text-xs text-center text-muted-foreground">Sweet spot: 40–80%</div>
        </div>
      )}

      {/* Aim instruction */}
      {phase === "aim" && (
        <p className="text-sm text-muted-foreground text-center">
          Tap to aim — pick your column!
        </p>
      )}

      {/* Tap button */}
      {(phase === "aim" || phase === "power") && (
        <button
          type="button"
          onClick={handleTap}
          className="w-full bg-primary text-primary-foreground rounded-xl py-4 font-bold text-lg active:scale-95 transition-all duration-150"
        >
          {phase === "aim" ? "🎯 AIM!" : "⚽ SHOOT!"}
        </button>
      )}

      {/* Done */}
      {phase === "done" && (
        <div className="flex flex-col items-center gap-2">
          <span className="text-4xl animate-bounce">{goals >= 3 ? "🎉" : "😔"}</span>
          <span className={`font-bold text-xl ${goals >= 3 ? "text-emerald-400" : "text-red-400"}`}>
            {goals} / 5 Goals
          </span>
          <span className="text-muted-foreground">Final Score: {goals * 100}</span>
        </div>
      )}
    </div>
  );
}
