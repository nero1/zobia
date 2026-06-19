"use client";

/**
 * Word Scramble — unscramble letters to form the hidden word.
 * 5 words per game. Score = 200 per correct − seconds_taken.
 */

import { useEffect, useState, useCallback, useRef } from "react";
import type { GameEngineProps } from "@/components/games/types";
import { useGameSound } from "@/components/games/useGameSound";

const WORD_LISTS: Record<string, string[]> = {
  easy: ["APPLE","MANGO","BEACH","DANCE","HAPPY","LIGHT","MUSIC","OCEAN","PLANT","SMILE","WATER","WORLD","BREAD","CLOCK","DREAM"],
  medium: ["JUNGLE","ORANGE","FLOWER","BRIDGE","PURPLE","SILVER","CASTLE","MIRROR","WINTER","BOTTLE","CANDLE","GUITAR","PLANET","ROCKET","SCHOOL"],
  hard: ["KINGDOM","MONSTER","JOURNEY","THUNDER","CRYSTAL","DIAMOND","DOLPHIN","EXPLORE","FANTASY","FREEDOM","HARVEST","MYSTERY","PATTERN","QUARTER","TRIUMPH"],
};
const ROUNDS = 5;

function scramble(word: string): string {
  const a = word.split("");
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  const result = a.join("");
  return result === word ? scramble(word) : result;
}

export default function WordScrambleGame({ onReady, onGameOver, onScore, difficulty = "medium", paused, soundEnabled = true }: GameEngineProps) {
  const wordList = WORD_LISTS[difficulty] ?? WORD_LISTS.medium;
  const [round, setRound] = useState(1);
  const [words] = useState(() => {
    const shuffled = [...wordList].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, ROUNDS);
  });
  const [scrambled, setScrambled] = useState(() => scramble(words[0]));
  const [guess, setGuess] = useState("");
  const [score, setScore] = useState(0);
  const [feedback, setFeedback] = useState<"correct"|"wrong"|"skipped"|null>(null);
  const [done, setDone] = useState(false);
  const [timeLeft, setTimeLeft] = useState(30);
  const scoreRef = useRef(0);
  const roundStartRef = useRef(Date.now());
  const play = useGameSound(soundEnabled ?? true);
  const pausedRef = useRef(paused);

  useEffect(() => { pausedRef.current = paused; }, [paused]);
  useEffect(() => { onReady?.(); }, [onReady]);

  useEffect(() => {
    if (done) return;
    const id = setInterval(() => {
      if (pausedRef.current) return;
      setTimeLeft((t) => {
        if (t <= 1) {
          // Skip
          clearInterval(id);
          advance(false);
          return 30;
        }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round, done]);

  const advance = useCallback((wasCorrect: boolean) => {
    const next = round + 1;
    if (next > ROUNDS) {
      onGameOver(scoreRef.current);
      setDone(true);
    } else {
      setRound(next);
      setScrambled(scramble(words[next - 1]));
      setGuess("");
      setFeedback(null);
      setTimeLeft(30);
      roundStartRef.current = Date.now();
    }
  }, [round, words, onGameOver]);

  const submit = useCallback(() => {
    if (pausedRef.current || done || !guess.trim()) return;
    const target = words[round - 1];
    if (guess.trim().toUpperCase() === target) {
      const elapsed = (Date.now() - roundStartRef.current) / 1000;
      const pts = Math.max(50, 200 - Math.round(elapsed * 2));
      scoreRef.current += pts;
      setScore(scoreRef.current);
      onScore?.(scoreRef.current);
      setFeedback("correct");
      play("match");
      setTimeout(() => advance(true), 700);
    } else {
      setFeedback("wrong");
      play("miss");
      setTimeout(() => setFeedback(null), 600);
    }
  }, [done, guess, round, words, onScore, play, advance]);

  const skip = useCallback(() => {
    if (pausedRef.current || done) return;
    setFeedback("skipped");
    play("miss");
    setTimeout(() => advance(false), 500);
  }, [done, play, advance]);

  return (
    <div className="flex flex-col items-center gap-4 select-none w-full max-w-sm mx-auto">
      <div className="flex w-full items-center justify-between text-sm px-1">
        <span className="text-muted-foreground">Round {round}/{ROUNDS}</span>
        <span className="text-emerald-400 font-semibold">Score: {score}</span>
        <span className={timeLeft <= 10 ? "text-red-400 font-bold animate-pulse" : "text-muted-foreground"}>{timeLeft}s</span>
      </div>

      <div className="w-full h-1.5 bg-neutral-800 rounded-full">
        <div className="h-full bg-primary rounded-full transition-all duration-1000" style={{ width: `${(timeLeft / 30) * 100}%` }} />
      </div>

      <div className={`w-full rounded-2xl p-6 text-center transition-colors border-2 ${
        feedback === "correct" ? "border-emerald-500 bg-emerald-950/30" :
        feedback === "wrong" ? "border-red-500 bg-red-950/30" :
        "border-border bg-card"
      }`}>
        <p className="text-xs text-muted-foreground mb-2">Unscramble this word:</p>
        <p className="text-4xl font-black tracking-widest text-foreground">{scrambled}</p>
        {feedback === "correct" && <p className="text-emerald-400 font-bold mt-2">✅ {words[round - 1]}!</p>}
        {feedback === "skipped" && <p className="text-amber-400 mt-2">Skipped — it was: {words[round - 1]}</p>}
      </div>

      <div className="flex w-full gap-2">
        <input
          type="text"
          value={guess}
          onChange={(e) => setGuess(e.target.value.toUpperCase())}
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
          placeholder="Your answer…"
          maxLength={20}
          className="flex-1 rounded-xl border border-border bg-input px-4 py-3 text-lg font-bold text-foreground uppercase tracking-widest focus:outline-none focus:border-primary"
          disabled={done || !!feedback}
        />
        <button type="button" onClick={submit} disabled={done || !guess.trim() || !!feedback}
          className="px-5 py-3 rounded-xl bg-primary text-primary-foreground font-bold disabled:opacity-40">
          Go!
        </button>
      </div>

      <button type="button" onClick={skip} disabled={done} className="text-xs text-muted-foreground hover:text-foreground underline">Skip word</button>

      {done && <div className="text-emerald-400 font-bold text-lg">Game complete! Final: {score}</div>}
    </div>
  );
}
