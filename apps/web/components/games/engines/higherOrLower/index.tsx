"use client";

/**
 * Higher or Lower — guess if the next card is higher or lower.
 * Streak × 10 per correct guess. One wrong guess ends the run.
 */

import { useEffect, useState, useCallback, useRef } from "react";
import type { GameEngineProps } from "@/components/games/types";
import { useGameSound } from "@/components/games/useGameSound";

const SUITS = ["♠","♥","♦","♣"];
const VALUES = ["2","3","4","5","6","7","8","9","10","J","Q","K","A"];
const NUM_VAL: Record<string, number> = Object.fromEntries(VALUES.map((v, i) => [v, i + 2]));

interface Card { suit: string; value: string }

function newDeck(): Card[] {
  const d: Card[] = [];
  for (const s of SUITS) for (const v of VALUES) d.push({ suit: s, value: v });
  for (let i = d.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [d[i], d[j]] = [d[j], d[i]]; }
  return d;
}

const isRed = (s: string) => s === "♥" || s === "♦";

export default function HigherOrLowerGame({ onReady, onGameOver, onScore, difficulty = "medium", paused, soundEnabled = true }: GameEngineProps) {
  const [deck, setDeck] = useState<Card[]>(() => newDeck());
  const [current, setCurrent] = useState<Card | null>(null);
  const [next, setNext] = useState<Card | null>(null);
  const [streak, setStreak] = useState(0);
  const [score, setScore] = useState(0);
  const [over, setOver] = useState(false);
  const [reveal, setReveal] = useState(false);
  const [flash, setFlash] = useState<"correct"|"wrong"|null>(null);
  const deckRef = useRef([...deck]);
  const streakRef = useRef(0);
  const play = useGameSound(soundEnabled ?? true);
  const pausedRef = useRef(paused);

  useEffect(() => { pausedRef.current = paused; }, [paused]);
  useEffect(() => {
    onReady?.();
    const d = newDeck();
    deckRef.current = d;
    setDeck(d);
    const c = d.pop()!;
    const n = d.pop()!;
    setCurrent(c);
    setNext(n);
  }, [onReady]);

  const guess = useCallback((guess: "higher" | "lower") => {
    if (pausedRef.current || over || !current || !next || reveal) return;
    const cv = NUM_VAL[current.value];
    const nv = NUM_VAL[next.value];
    const correct =
      (guess === "higher" && nv > cv) ||
      (guess === "lower" && nv < cv) ||
      nv === cv; // tie counts as correct

    setReveal(true);
    setFlash(correct ? "correct" : "wrong");

    if (correct) {
      play("score");
      streakRef.current++;
      setStreak(streakRef.current);
      const sc = streakRef.current * 10 * (difficulty === "hard" ? 2 : difficulty === "easy" ? 0.5 : 1);
      setScore(Math.round(sc));
      onScore?.(Math.round(sc));
    } else {
      play("lose");
    }

    setTimeout(() => {
      if (!correct) {
        onGameOver(Math.round(streakRef.current * 10));
        setOver(true);
        return;
      }
      const d = [...deckRef.current];
      if (d.length < 2) {
        const sc = streakRef.current * 10;
        onGameOver(Math.round(sc));
        setOver(true);
        return;
      }
      const newCurrent = next;
      const newNext = d.pop()!;
      deckRef.current = d;
      setCurrent(newCurrent);
      setNext(newNext);
      setReveal(false);
      setFlash(null);
    }, 900);
  }, [current, next, over, reveal, difficulty, onScore, onGameOver, play]);

  const CardFace = ({ card }: { card: Card | null }) => card ? (
    <div className={`w-24 h-36 rounded-xl border-2 border-border bg-card flex flex-col items-center justify-center gap-1 shadow-lg ${isRed(card.suit) ? "text-red-500" : "text-foreground"}`}>
      <span className="text-3xl font-black">{card.value}</span>
      <span className="text-3xl">{card.suit}</span>
    </div>
  ) : <div className="w-24 h-36 rounded-xl border-2 border-border bg-primary/10 flex items-center justify-center text-4xl">🂠</div>;

  return (
    <div className="flex flex-col items-center gap-5 select-none w-full max-w-xs mx-auto">
      <div className="flex w-full items-center justify-between text-sm px-1">
        <span className="text-amber-400 font-bold">Streak: {streak}</span>
        <span className="text-emerald-400">Score: {score}</span>
        <span className="text-muted-foreground">{deckRef.current.length} cards left</span>
      </div>

      <div className="flex items-center gap-6">
        <div>
          <p className="text-xs text-muted-foreground text-center mb-1">Current</p>
          <CardFace card={current} />
        </div>
        <div>
          <p className="text-xs text-muted-foreground text-center mb-1">{reveal ? "Next" : "Hidden"}</p>
          {reveal ? <CardFace card={next} /> : <div className="w-24 h-36 rounded-xl border-2 border-dashed border-border/50 flex items-center justify-center text-4xl">❓</div>}
        </div>
      </div>

      {flash && (
        <div className={`text-lg font-bold ${flash === "correct" ? "text-emerald-400" : "text-red-400"}`}>
          {flash === "correct" ? "✅ Correct!" : "❌ Wrong!"}
        </div>
      )}

      {!over && !reveal && (
        <div className="flex gap-4 w-full">
          <button type="button" onClick={() => guess("lower")}
            className="flex-1 py-4 rounded-xl border-2 border-blue-500/50 bg-blue-950/30 text-blue-300 font-bold hover:bg-blue-950/50 text-lg">
            ⬇ Lower
          </button>
          <button type="button" onClick={() => guess("higher")}
            className="flex-1 py-4 rounded-xl border-2 border-amber-500/50 bg-amber-950/30 text-amber-300 font-bold hover:bg-amber-950/50 text-lg">
            ⬆ Higher
          </button>
        </div>
      )}

      {over && <div className="text-red-400 font-bold text-lg">Game Over — Streak: {streak}</div>}
    </div>
  );
}
