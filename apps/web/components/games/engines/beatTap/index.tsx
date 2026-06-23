"use client";

/**
 * Beat Tap — 4-lane rhythm game. Notes fall from top; tap when they hit the zone.
 * Timing: Perfect ±80ms = 15pts, Good ±200ms = 10pts, Miss = 0.
 * Keys: A S D F or lane buttons. 30 seconds of play.
 */

import { useEffect, useState, useCallback, useRef } from "react";
import type { GameEngineProps } from "@/components/games/types";
import { useGameSound } from "@/components/games/useGameSound";

// ── Note patterns (time in ms from start) ──────────────────────────────────
const BEAT_MS = 500; // 120 BPM

function gen(pattern: Array<[number, number]>): Array<{ lane: number; time: number }> {
  return pattern.map(([lane, beat]) => ({ lane, time: beat * BEAT_MS }));
}

const PATTERNS: Record<string, Array<{ lane: number; time: number }>> = {
  easy: gen([
    [0,2],[2,4],[1,6],[3,8],
    [0,10],[1,12],[2,14],[3,16],
    [0,18],[2,20],[1,22],[3,24],
    [0,26],[1,28],[2,30],[3,32],
    [0,34],[2,36],[1,38],[3,40],
    [0,42],[2,44],[1,46],[3,48],
    [0,50],[1,52],[2,54],[3,56],
  ]),
  medium: gen([
    [0,1],[1,2],[2,3],[3,4],
    [0,5],[2,6],[1,7],[3,8],
    [0,9],[1,9.5],[2,10],[3,10.5],
    [0,11],[2,12],[3,13],[1,14],
    [0,15],[1,15.5],[2,16],[3,16.5],
    [0,17],[3,18],[1,19],[2,20],
    [0,21],[1,21.5],[2,22],[3,22.5],
    [0,23],[2,24],[1,25],[3,26],
    [0,27],[1,27.5],[2,28],[3,28.5],
    [0,29],[2,30],[3,31],[1,32],
    [0,33],[1,34],[2,34.5],[3,35],
    [0,36],[2,37],[1,38],[3,39],
    [0,40],[1,41],[2,42],[3,43],
    [0,44],[2,45],[1,46],[3,47],
    [0,48],[1,49],[2,50],[3,51],
    [0,52],[2,53],[1,54],[3,55],
    [0,56],[1,57],[2,58],[3,59],
  ]),
  hard: gen([
    [0,0.5],[1,1],[2,1.5],[3,2],
    [0,2.5],[1,3],[2,3.5],[3,4],
    [0,4],[1,4.5],[2,5],[3,5.5],
    [0,6],[1,6.25],[2,6.5],[3,6.75],
    [0,7],[2,7.25],[1,7.5],[3,7.75],
    [0,8],[1,8.5],[2,9],[3,9.5],
    [0,10],[1,10.25],[2,10.5],[3,10.75],
    [0,11],[2,11.5],[1,12],[3,12.5],
    [0,13],[1,13.25],[2,13.5],[3,13.75],
    [0,14],[2,14.5],[1,15],[3,15.5],
    [0,16],[1,16.5],[2,17],[3,17.5],
    [0,18],[1,18.25],[2,18.5],[3,18.75],
    [0,19],[2,19.5],[1,20],[3,20.5],
    [0,21],[1,21.25],[2,21.5],[3,21.75],
    [0,22],[2,22.5],[1,23],[3,23.5],
    [0,24],[1,24.5],[2,25],[3,25.5],
    [0,26],[1,26.25],[2,26.5],[3,26.75],
    [0,27],[2,27.5],[1,28],[3,28.5],
    [0,29],[1,29.5],[2,30],[3,30.5],
    [0,31],[1,31.25],[2,31.5],[3,31.75],
    [0,32],[2,32.5],[1,33],[3,33.5],
    [0,34],[1,34.5],[2,35],[3,35.5],
    [0,36],[1,36.25],[2,36.5],[3,36.75],
    [0,37],[2,37.5],[1,38],[3,38.5],
    [0,39],[1,39.5],[2,40],[3,40.5],
    [0,41],[1,41.25],[2,41.5],[3,41.75],
    [0,42],[2,42.5],[1,43],[3,43.5],
    [0,44],[1,44.5],[2,45],[3,45.5],
    [0,46],[1,46.25],[2,46.5],[3,46.75],
    [0,47],[2,47.5],[1,48],[3,48.5],
    [0,49],[1,49.5],[2,50],[3,50.5],
    [0,51],[1,51.25],[2,51.5],[3,51.75],
    [0,52],[2,52.5],[1,53],[3,53.5],
    [0,54],[1,54.5],[2,55],[3,55.5],
    [0,56],[1,56.5],[2,57],[3,57.5],
    [0,58],[1,58.25],[2,58.5],[3,58.75],
  ]),
};

const LANE_COLORS = [
  { bg: "bg-red-500",    light: "bg-red-300",   glow: "shadow-red-500/70"    },
  { bg: "bg-blue-500",   light: "bg-blue-300",  glow: "shadow-blue-500/70"   },
  { bg: "bg-green-500",  light: "bg-green-300", glow: "shadow-green-500/70"  },
  { bg: "bg-yellow-400", light: "bg-yellow-200",glow: "shadow-yellow-400/70" },
];
const LANE_KEYS = ["A", "S", "D", "F"];

const GAME_DURATION = 30_000; // 30s
const NOTE_TRAVEL_MS = 1500;  // time for note to travel from top to hit zone
const LANE_HEIGHT = 300;      // px
const HIT_ZONE_Y = LANE_HEIGHT - 40; // px from top of lane
const PERFECT_MS = 80;
const GOOD_MS    = 200;

interface Note {
  id: number;
  lane: number;
  time: number;   // ms from start when it should hit the zone
  hit: boolean;
  missed: boolean;
}

type Feedback = { lane: number; label: string; color: string; key: number };

let noteIdCounter = 0;

export default function BeatTapGame({
  onReady, onGameOver, onScore, difficulty = "medium", paused, soundEnabled = true,
}: GameEngineProps) {
  const pattern = PATTERNS[difficulty] ?? PATTERNS.medium;

  const [notes, setNotes] = useState<Note[]>([]);
  const [score, setScore] = useState(0);
  const [timeLeft, setTimeLeft] = useState(30);
  const [feedbacks, setFeedbacks] = useState<Feedback[]>([]);
  const [laneActive, setLaneActive] = useState([false, false, false, false]);
  const [gameOver, setGameOver] = useState(false);
  const [started, setStarted] = useState(false);

  const play = useGameSound(soundEnabled ?? true);
  const pausedRef = useRef(paused);
  const overRef = useRef(false);
  const scoreRef = useRef(0);
  const startTimeRef = useRef<number>(0);
  const notesRef = useRef<Note[]>([]);
  const spawnedRef = useRef<Set<number>>(new Set());
  const fbKeyRef = useRef(0);

  useEffect(() => { pausedRef.current = paused; }, [paused]);
  useEffect(() => { onReady?.(); }, [onReady]);

  const addFeedback = useCallback((lane: number, label: string, color: string) => {
    const key = fbKeyRef.current++;
    setFeedbacks((prev) => [...prev, { lane, label, color, key }]);
    setTimeout(() => setFeedbacks((prev) => prev.filter((f) => f.key !== key)), 600);
  }, []);

  const endGame = useCallback(() => {
    if (overRef.current) return;
    overRef.current = true;
    play("win");
    setGameOver(true);
    onGameOver(scoreRef.current);
  }, [onGameOver, play]);

  // Main game loop via rAF
  useEffect(() => {
    if (!started) return;
    let rafId: number;

    const tick = () => {
      if (overRef.current) return;
      if (!pausedRef.current) {
        const elapsed = performance.now() - startTimeRef.current;

        // Spawn notes
        pattern.forEach((n) => {
          const spawnTime = n.time - NOTE_TRAVEL_MS;
          if (elapsed >= spawnTime && !spawnedRef.current.has(n.time * 100 + n.lane)) {
            spawnedRef.current.add(n.time * 100 + n.lane);
            const note: Note = { id: noteIdCounter++, lane: n.lane, time: n.time, hit: false, missed: false };
            notesRef.current = [...notesRef.current, note];
            setNotes([...notesRef.current]);
          }
        });

        // Mark missed notes (past hit window)
        let changed = false;
        notesRef.current = notesRef.current.map((note) => {
          if (!note.hit && !note.missed && elapsed > note.time + GOOD_MS) {
            changed = true;
            return { ...note, missed: true };
          }
          return note;
        });
        if (changed) setNotes([...notesRef.current]);

        // Clean up old notes
        const before = notesRef.current.length;
        notesRef.current = notesRef.current.filter(
          (n) => !(n.missed && elapsed > n.time + 800) && !(n.hit && elapsed > n.time + 300)
        );
        if (notesRef.current.length !== before) setNotes([...notesRef.current]);

        // End game
        if (elapsed >= GAME_DURATION) { endGame(); return; }
        setTimeLeft(Math.max(0, Math.ceil((GAME_DURATION - elapsed) / 1000)));
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [started, pattern, endGame]);

  const tapLane = useCallback(
    (lane: number) => {
      if (!started || pausedRef.current || overRef.current) return;
      const elapsed = performance.now() - startTimeRef.current;

      // Find closest unhit note in this lane
      let best: Note | null = null;
      let bestDiff = Infinity;
      for (const note of notesRef.current) {
        if (note.lane !== lane || note.hit || note.missed) continue;
        const diff = Math.abs(elapsed - note.time);
        if (diff < bestDiff) { bestDiff = diff; best = note; }
      }

      // Highlight lane
      setLaneActive((prev) => { const n = [...prev]; n[lane] = true; return n; });
      setTimeout(() => setLaneActive((prev) => { const n = [...prev]; n[lane] = false; return n; }), 120);

      if (best && bestDiff <= GOOD_MS) {
        // Hit!
        notesRef.current = notesRef.current.map((n) => n.id === best!.id ? { ...n, hit: true } : n);
        setNotes([...notesRef.current]);
        let pts = 0;
        let label = "";
        let color = "";
        if (bestDiff <= PERFECT_MS) {
          pts = 15; label = "PERFECT!"; color = "text-yellow-400";
          play("tap");
        } else {
          pts = 10; label = "GOOD!"; color = "text-emerald-400";
          play("tap");
        }
        scoreRef.current += pts;
        setScore(scoreRef.current);
        onScore?.(scoreRef.current);
        addFeedback(lane, label, color);
      } else {
        // Miss (tap with no note)
        play("miss");
        addFeedback(lane, "MISS!", "text-red-400");
      }
    },
    [started, onScore, play, addFeedback]
  );

  // Keyboard support
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const map: Record<string, number> = { a: 0, s: 1, d: 2, f: 3 };
      const lane = map[e.key.toLowerCase()];
      if (lane !== undefined) { e.preventDefault(); tapLane(lane); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [tapLane]);

  const handleStart = () => {
    startTimeRef.current = performance.now();
    setStarted(true);
  };

  // Note visual position: top = 0 (just spawned), bottom = HIT_ZONE_Y (should tap now)
  const getNoteY = (note: Note): number => {
    if (!started) return 0;
    const elapsed = performance.now() - startTimeRef.current;
    const progress = (elapsed - (note.time - NOTE_TRAVEL_MS)) / NOTE_TRAVEL_MS;
    return Math.min(1, Math.max(0, progress)) * HIT_ZONE_Y;
  };

  const urgency = timeLeft <= 5;

  return (
    <div className="flex flex-col items-center gap-3 select-none w-full max-w-sm mx-auto">
      {/* Header */}
      <div className="flex w-full justify-between items-center px-2">
        <span className="text-emerald-400 font-bold text-2xl">{score}</span>
        <span className={`font-bold ${urgency ? "text-red-400 animate-pulse" : "text-muted-foreground"}`}>
          {timeLeft}s
        </span>
        <span className="text-xs text-muted-foreground">A S D F</span>
      </div>

      {/* Timer bar */}
      <div className="w-full h-1.5 bg-neutral-800 rounded-full">
        <div
          className={`h-full rounded-full transition-none ${urgency ? "bg-red-500" : "bg-emerald-500"}`}
          style={{ width: `${(timeLeft / 30) * 100}%` }}
        />
      </div>

      {/* Lanes */}
      {!started && !gameOver ? (
        <button
          type="button"
          onClick={handleStart}
          className="w-full bg-primary text-primary-foreground rounded-xl py-5 font-bold text-xl active:scale-95 transition-all duration-150"
        >
          🎵 TAP TO START
        </button>
      ) : (
        <>
          <div className="flex gap-1 w-full" style={{ height: LANE_HEIGHT }}>
            {[0, 1, 2, 3].map((lane) => {
              const laneNotes = notes.filter((n) => n.lane === lane && !n.hit && !n.missed);
              const laneColor = LANE_COLORS[lane];
              const fb = feedbacks.find((f) => f.lane === lane);
              return (
                <div
                  key={lane}
                  className="relative flex-1 rounded-t-lg overflow-hidden border border-border bg-neutral-900/80"
                  style={{ height: LANE_HEIGHT }}
                >
                  {/* Notes */}
                  {laneNotes.map((note) => {
                    const y = getNoteY(note);
                    return (
                      <div
                        key={note.id}
                        className={`absolute left-1 right-1 h-7 rounded-md ${laneColor.bg} opacity-90 transition-none`}
                        style={{ top: y, zIndex: 10 }}
                      />
                    );
                  })}

                  {/* Feedback text */}
                  {fb && (
                    <div
                      className={`absolute top-1/2 left-0 right-0 text-center text-xs font-black ${fb.color} pointer-events-none animate-bounce`}
                      style={{ zIndex: 20 }}
                    >
                      {fb.label}
                    </div>
                  )}

                  {/* Hit zone */}
                  <div
                    className={`absolute left-0 right-0 h-8 border-t-2 ${
                      laneActive[lane]
                        ? `${laneColor.bg} border-white shadow-lg ${laneColor.glow}`
                        : "bg-white/10 border-white/40"
                    } transition-all duration-75`}
                    style={{ bottom: 0 }}
                  />
                </div>
              );
            })}
          </div>

          {/* Tap buttons */}
          <div className="flex gap-1 w-full">
            {[0, 1, 2, 3].map((lane) => {
              const laneColor = LANE_COLORS[lane];
              return (
                <button
                  key={lane}
                  type="button"
                  onPointerDown={(e) => { e.preventDefault(); tapLane(lane); }}
                  className={`flex-1 py-4 rounded-xl font-bold text-white text-lg active:scale-95 transition-all duration-75 ${laneColor.bg} ${laneActive[lane] ? "brightness-150" : ""}`}
                >
                  {LANE_KEYS[lane]}
                </button>
              );
            })}
          </div>
        </>
      )}

      {gameOver && (
        <div className="flex flex-col items-center gap-2">
          <span className="text-4xl animate-bounce">🎉</span>
          <span className="text-emerald-400 font-bold text-xl">Great performance!</span>
          <span className="text-muted-foreground">Final Score: {score}</span>
        </div>
      )}
    </div>
  );
}
