"use client";

/**
 * Basketball Shot — tap when the pendulum ball is in the sweet spot.
 * 10 shots per game. Sweet spot width varies by difficulty.
 * Perfect (center) = 3pts, Good = 2pts, Close = 1pt, Miss = 0.
 */

import { useEffect, useState, useCallback, useRef } from "react";
import type { GameEngineProps } from "@/components/games/types";
import { useGameSound } from "@/components/games/useGameSound";

const SWEET_SPOT: Record<string, number> = {
  easy:   0.40, // 40% of arc width
  medium: 0.25,
  hard:   0.15,
};

const TOTAL_SHOTS = 10;

type ShotResult = "perfect" | "good" | "close" | "miss";

function getShotResult(normalizedPos: number, sweetSpot: number): ShotResult {
  // normalizedPos: 0 = far left, 0.5 = center, 1 = far right
  const dist = Math.abs(normalizedPos - 0.5); // 0 = dead center, 0.5 = edge
  const half = sweetSpot / 2;
  if (dist < half * 0.3) return "perfect";
  if (dist < half * 0.6) return "good";
  if (dist < half) return "close";
  return "miss";
}

const RESULT_PTS: Record<ShotResult, number> = {
  perfect: 3, good: 2, close: 1, miss: 0,
};

const RESULT_LABEL: Record<ShotResult, string> = {
  perfect: "PERFECT! 🔥", good: "GOOD! 👌", close: "CLOSE! 😬", miss: "MISS! 😔",
};

const RESULT_COLOR: Record<ShotResult, string> = {
  perfect: "text-yellow-400", good: "text-emerald-400", close: "text-blue-400", miss: "text-red-400",
};

export default function BasketballShotGame({
  onReady, onGameOver, onScore, difficulty = "medium", paused, soundEnabled = true,
}: GameEngineProps) {
  const sweetSpot = SWEET_SPOT[difficulty] ?? 0.25;

  // pendulum angle: -1 (far left) to +1 (far right)
  const [angle, setAngle] = useState(0);
  const [score, setScore] = useState(0);
  const [shotsTaken, setShotsTaken] = useState(0);
  const [lastResult, setLastResult] = useState<ShotResult | null>(null);
  const [ballAnim, setBallAnim] = useState<{ x: number; y: number } | null>(null);
  const [gameOver, setGameOver] = useState(false);
  const [history, setHistory] = useState<ShotResult[]>([]);

  const play = useGameSound(soundEnabled ?? true);
  const pausedRef = useRef(paused);
  const overRef = useRef(false);
  const angleRef = useRef(0);
  const angleDirRef = useRef(1);
  const scoreRef = useRef(0);
  const shotsRef = useRef(0);
  const showingRef = useRef(false); // true while result is displayed

  useEffect(() => { pausedRef.current = paused; }, [paused]);
  useEffect(() => { onReady?.(); }, [onReady]);

  // Pendulum animation via rAF
  useEffect(() => {
    let rafId: number;
    const SPEED = 0.015 + (difficulty === "hard" ? 0.012 : difficulty === "medium" ? 0.006 : 0);

    const tick = () => {
      if (!pausedRef.current && !overRef.current && !showingRef.current) {
        angleRef.current += angleDirRef.current * SPEED;
        if (angleRef.current >= 1)  { angleRef.current = 1;  angleDirRef.current = -1; }
        if (angleRef.current <= -1) { angleRef.current = -1; angleDirRef.current = 1; }
        setAngle(angleRef.current);
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [difficulty]);

  const handleTap = useCallback(() => {
    if (pausedRef.current || overRef.current || showingRef.current) return;

    const normalized = (angleRef.current + 1) / 2; // 0..1
    const result = getShotResult(normalized, sweetSpot);
    const pts = RESULT_PTS[result];

    showingRef.current = true;
    setLastResult(result);

    // Ball animation: arc from bottom toward hoop
    const bx = normalized * 260 + 10;
    setBallAnim({ x: bx, y: 0 });

    if (result !== "miss") {
      play(result === "perfect" ? "levelUp" : "score");
    } else {
      play("miss");
    }

    scoreRef.current += pts;
    setScore(scoreRef.current);
    onScore?.(scoreRef.current);

    const newShots = shotsRef.current + 1;
    shotsRef.current = newShots;
    setShotsTaken(newShots);
    setHistory((h) => [...h, result]);

    setTimeout(() => {
      setBallAnim(null);
      setLastResult(null);
      showingRef.current = false;
      if (newShots >= TOTAL_SHOTS) {
        overRef.current = true;
        play("win");
        onGameOver(scoreRef.current);
        setGameOver(true);
      }
    }, 900);
  }, [sweetSpot, onScore, onGameOver, play]);

  // Keyboard support
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.code === "Space" || e.key === " ") { e.preventDefault(); handleTap(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleTap]);

  // Arc display: ball position on a semicircle
  const ARC_W = 280;
  const ARC_H = 140;
  const CX = ARC_W / 2;
  const CY = ARC_H;
  const R = ARC_H - 10;
  // angle: -1 → 180°, 0 → 270° (bottom), +1 → 360°
  // Actually pendulum swings LEFT to RIGHT through bottom
  const radians = (Math.PI / 2) * angleRef.current; // -π/2 to +π/2
  const ballX = CX + Math.sin(radians) * R;
  const ballY = CY - Math.cos(radians) * R;

  // Sweet spot arc bounds
  const ssHalf = sweetSpot / 2;
  const ssStartAngle = -ssHalf * (Math.PI / 2);
  const ssEndAngle   =  ssHalf * (Math.PI / 2);
  const ssX1 = CX + Math.sin(ssStartAngle) * R;
  const ssY1 = CY - Math.cos(ssStartAngle) * R;
  const ssX2 = CX + Math.sin(ssEndAngle) * R;
  const ssY2 = CY - Math.cos(ssEndAngle) * R;

  return (
    <div className="flex flex-col items-center gap-3 select-none w-full max-w-sm mx-auto">
      {/* Header */}
      <div className="flex w-full justify-between items-center px-2">
        <span className="text-muted-foreground text-sm">Shot {Math.min(shotsTaken + 1, TOTAL_SHOTS)}/{TOTAL_SHOTS}</span>
        <span className="text-emerald-400 font-bold text-2xl">{score}</span>
        <span className="text-muted-foreground text-sm">Max {TOTAL_SHOTS * 3}</span>
      </div>

      {/* Hoop */}
      <div className="text-3xl text-center">🏀 Hoop</div>

      {/* Arc + ball */}
      <div className="relative w-full flex justify-center">
        <svg width={ARC_W} height={ARC_H + 10} className="overflow-visible">
          {/* Full arc (gray) */}
          <path
            d={`M ${CX - R} ${CY} A ${R} ${R} 0 0 1 ${CX + R} ${CY}`}
            fill="none"
            stroke="#374151"
            strokeWidth={4}
            strokeLinecap="round"
          />

          {/* Sweet spot arc (green glow) */}
          <path
            d={`M ${ssX1} ${ssY1} A ${R} ${R} 0 0 1 ${ssX2} ${ssY2}`}
            fill="none"
            stroke="#22c55e"
            strokeWidth={8}
            strokeLinecap="round"
            opacity={0.7}
          />

          {/* Perfect spot (tiny bright center) */}
          <circle cx={CX} cy={CY - R} r={5} fill="#facc15" />

          {/* Pendulum arm */}
          <line
            x1={CX} y1={CY}
            x2={ballX} y2={ballY}
            stroke="#4b5563"
            strokeWidth={2}
          />

          {/* Ball */}
          <text x={ballX - 10} y={ballY + 8} fontSize={20}>🏀</text>

          {/* Center pivot */}
          <circle cx={CX} cy={CY} r={4} fill="#6b7280" />
        </svg>

        {/* Result flash */}
        {lastResult && (
          <div className={`absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 text-xl font-black animate-bounce pointer-events-none ${RESULT_COLOR[lastResult]}`}>
            {RESULT_LABEL[lastResult]}
          </div>
        )}
      </div>

      {/* Shot history dots */}
      <div className="flex gap-1 flex-wrap justify-center">
        {history.map((r, i) => (
          <span
            key={i}
            className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
              r === "perfect" ? "bg-yellow-400 text-black" :
              r === "good"    ? "bg-emerald-500 text-white" :
              r === "close"   ? "bg-blue-500 text-white" :
              "bg-red-500 text-white"
            }`}
          >
            {RESULT_PTS[r]}
          </span>
        ))}
        {Array.from({ length: TOTAL_SHOTS - history.length }, (_, i) => (
          <span key={`empty-${i}`} className="w-6 h-6 rounded-full bg-neutral-800 border border-border" />
        ))}
      </div>

      {/* Tap button */}
      {!gameOver && (
        <button
          type="button"
          onClick={handleTap}
          className="w-full bg-primary text-primary-foreground rounded-xl py-4 font-bold text-lg active:scale-95 transition-all duration-150"
        >
          🏀 SHOOT! (Space)
        </button>
      )}

      {/* Legend */}
      {!gameOver && (
        <div className="flex gap-3 text-xs text-muted-foreground">
          <span className="text-yellow-400">■ Perfect 3pt</span>
          <span className="text-emerald-400">■ Good 2pt</span>
          <span className="text-blue-400">■ Close 1pt</span>
        </div>
      )}

      {/* Game Over */}
      {gameOver && (
        <div className="flex flex-col items-center gap-2">
          <span className="text-4xl animate-bounce">🎉</span>
          <span className="text-emerald-400 font-bold text-xl">Game Over!</span>
          <span className="text-muted-foreground">Final Score: {score} / {TOTAL_SHOTS * 3}</span>
        </div>
      )}
    </div>
  );
}
