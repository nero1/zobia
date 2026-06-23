"use client";

/**
 * Anagram Rush — unscramble letters to form the correct word.
 * Tap letter tiles to build answer, or type in input field.
 * Correct = +100 pts + time bonus. 10 words per game.
 */

import { useEffect, useState, useRef, useCallback } from "react";
import type { GameEngineProps } from "@/components/games/types";
import { useGameSound } from "@/components/games/useGameSound";

interface WordEntry { word: string; category: string }

const EASY_WORDS: WordEntry[] = [
  { word: "SMILE", category: "Expression" }, { word: "DANCE", category: "Action" },
  { word: "OCEAN", category: "Nature" }, { word: "BRAVE", category: "Trait" },
  { word: "FLAME", category: "Nature" }, { word: "GRAPE", category: "Food" },
  { word: "LIGHT", category: "Nature" }, { word: "PLANT", category: "Nature" },
  { word: "TIGER", category: "Animal" }, { word: "PEACE", category: "Concept" },
  { word: "BREAD", category: "Food" }, { word: "CLOUD", category: "Nature" },
  { word: "HEART", category: "Body" }, { word: "MUSIC", category: "Art" },
  { word: "EAGLE", category: "Animal" }, { word: "MAGIC", category: "Concept" },
  { word: "RIVER", category: "Nature" }, { word: "SOLAR", category: "Science" },
  { word: "YOUTH", category: "Concept" }, { word: "BEACH", category: "Place" },
];

const MEDIUM_WORDS: WordEntry[] = [
  { word: "JUNGLE", category: "Nature" }, { word: "BRIDGE", category: "Structure" },
  { word: "CASTLE", category: "Place" }, { word: "PURPLE", category: "Color" },
  { word: "WINTER", category: "Season" }, { word: "CANDLE", category: "Object" },
  { word: "PLANET", category: "Science" }, { word: "ROCKET", category: "Science" },
  { word: "SILVER", category: "Material" }, { word: "MIRROR", category: "Object" },
  { word: "FLOWER", category: "Nature" }, { word: "GUITAR", category: "Music" },
  { word: "MUSEUM", category: "Place" }, { word: "BOTTLE", category: "Object" },
  { word: "FALCON", category: "Animal" }, { word: "MARBLE", category: "Material" },
  { word: "FOREST", category: "Nature" }, { word: "WISDOM", category: "Concept" },
  { word: "PUZZLE", category: "Game" }, { word: "DRAGON", category: "Mythical" },
];

const HARD_WORDS: WordEntry[] = [
  { word: "TRIUMPH", category: "Concept" }, { word: "KINGDOM", category: "Place" },
  { word: "THUNDER", category: "Nature" }, { word: "CRYSTAL", category: "Material" },
  { word: "DIAMOND", category: "Gem" }, { word: "DOLPHIN", category: "Animal" },
  { word: "EXPLORE", category: "Action" }, { word: "FANTASY", category: "Genre" },
  { word: "FREEDOM", category: "Concept" }, { word: "HARVEST", category: "Action" },
  { word: "MYSTERY", category: "Concept" }, { word: "PATTERN", category: "Design" },
  { word: "QUARTER", category: "Measurement" }, { word: "CHAPTER", category: "Writing" },
  { word: "MONSTER", category: "Creature" }, { word: "JOURNEY", category: "Action" },
  { word: "FORWARD", category: "Direction" }, { word: "CAPTAIN", category: "Profession" },
  { word: "BLANKET", category: "Object" }, { word: "CHICKEN", category: "Animal" },
];

const TIME_MAP: Record<string, number> = { easy: 30, medium: 20, hard: 15 };
const TOTAL = 10;

const TILE_COLORS = [
  "bg-blue-600/30 border-blue-500 text-blue-300",
  "bg-purple-600/30 border-purple-500 text-purple-300",
  "bg-pink-600/30 border-pink-500 text-pink-300",
  "bg-amber-600/30 border-amber-500 text-amber-300",
  "bg-teal-600/30 border-teal-500 text-teal-300",
  "bg-green-600/30 border-green-500 text-green-300",
  "bg-red-600/30 border-red-500 text-red-300",
  "bg-indigo-600/30 border-indigo-500 text-indigo-300",
];

function scramble(word: string): string {
  const a = word.split("");
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  const result = a.join("");
  return result === word && word.length > 1 ? scramble(word) : result;
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

interface TileState { letter: string; used: boolean; id: number }

export default function AnagramRushGame({
  onReady, onGameOver, onScore, difficulty = "medium", paused, soundEnabled = true,
}: GameEngineProps) {
  const timePerWord = TIME_MAP[difficulty ?? "medium"] ?? 20;
  const wordList = difficulty === "easy" ? EASY_WORDS : difficulty === "hard" ? HARD_WORDS : MEDIUM_WORDS;

  const [words] = useState<WordEntry[]>(() => shuffle(wordList).slice(0, TOTAL));
  const [wordIndex, setWordIndex] = useState(0);
  const [score, setScore] = useState(0);
  const [timeLeft, setTimeLeft] = useState(timePerWord);
  const [tiles, setTiles] = useState<TileState[]>(() => {
    const scrambled = scramble(words[0].word);
    return scrambled.split("").map((l, i) => ({ letter: l, used: false, id: i }));
  });
  const [answer, setAnswer] = useState<Array<{ letter: string; tileId: number }>>([]);
  const [flash, setFlash] = useState<"correct" | "wrong" | null>(null);
  const [done, setDone] = useState(false);
  const [answered, setAnswered] = useState(false);
  const scoreRef = useRef(0);
  const doneRef = useRef(false);
  const pausedRef = useRef(paused);
  const play = useGameSound(soundEnabled ?? true);

  useEffect(() => { pausedRef.current = paused; }, [paused]);
  useEffect(() => { onReady?.(); }, [onReady]);

  const advanceWord = useCallback((wasCorrect: boolean, tl: number) => {
    if (doneRef.current) return;
    if (wasCorrect) {
      const bonus = Math.max(0, tl) * 5;
      const pts = 100 + bonus;
      scoreRef.current += pts;
      setScore(scoreRef.current);
      onScore?.(scoreRef.current);
    }
    setTimeout(() => {
      const next = wordIndex + 1;
      if (next >= TOTAL) {
        doneRef.current = true;
        setDone(true);
        play("win");
        onGameOver(scoreRef.current);
      } else {
        setWordIndex(next);
        const scrambled = scramble(words[next].word);
        setTiles(scrambled.split("").map((l, i) => ({ letter: l, used: false, id: i })));
        setAnswer([]);
        setFlash(null);
        setAnswered(false);
        setTimeLeft(timePerWord);
      }
    }, 800);
  }, [wordIndex, words, timePerWord, onScore, onGameOver, play]);

  // Timer
  useEffect(() => {
    if (done || answered) return;
    const id = setInterval(() => {
      if (pausedRef.current) return;
      setTimeLeft((t) => {
        if (t <= 1) {
          clearInterval(id);
          setFlash("wrong");
          setAnswered(true);
          play("miss");
          advanceWord(false, 0);
          return timePerWord;
        }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wordIndex, done, answered]);

  const submitAnswer = useCallback(() => {
    if (answered || doneRef.current) return;
    const guess = answer.map((a) => a.letter).join("");
    const isCorrect = guess === words[wordIndex].word;
    setFlash(isCorrect ? "correct" : "wrong");
    setAnswered(true);
    if (isCorrect) {
      play("match");
      advanceWord(true, timeLeft);
    } else {
      play("miss");
      advanceWord(false, timeLeft);
    }
  }, [answer, wordIndex, words, answered, timeLeft, play, advanceWord]);

  const tapTile = useCallback((tile: TileState) => {
    if (answered || tile.used) return;
    play("tap");
    setTiles((prev) => prev.map((t) => t.id === tile.id ? { ...t, used: true } : t));
    setAnswer((prev) => [...prev, { letter: tile.letter, tileId: tile.id }]);
  }, [answered, play]);

  const removeLast = useCallback(() => {
    if (answered || answer.length === 0) return;
    const last = answer[answer.length - 1];
    setTiles((prev) => prev.map((t) => t.id === last.tileId ? { ...t, used: false } : t));
    setAnswer((prev) => prev.slice(0, -1));
  }, [answered, answer]);

  const skip = useCallback(() => {
    if (answered || doneRef.current) return;
    setAnswered(true);
    setFlash(null);
    play("miss");
    advanceWord(false, 0);
  }, [answered, play, advanceWord]);

  const timerPct = (timeLeft / timePerWord) * 100;
  const word = words[wordIndex];

  if (done) {
    return (
      <div className="flex flex-col items-center gap-4 select-none w-full max-w-sm mx-auto">
        <div className="w-full rounded-2xl border-2 border-border bg-card p-6 text-center flex flex-col gap-3">
          <p className="text-2xl font-black text-foreground">Game Complete!</p>
          <p className="text-emerald-400 font-bold text-3xl">{scoreRef.current} pts</p>
          <p className="text-muted-foreground">Unscrambled {TOTAL} words</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3 select-none w-full max-w-sm mx-auto">
      {/* Header */}
      <div className="flex w-full items-center justify-between text-sm px-1">
        <span className="text-muted-foreground">Word {wordIndex + 1}/{TOTAL}</span>
        <span className="text-emerald-400 font-bold text-xl">{score}</span>
        <span className={timeLeft <= 5 ? "text-red-400 font-bold animate-pulse" : "text-muted-foreground"}>
          {timeLeft}s
        </span>
      </div>

      {/* Timer bar */}
      <div className="w-full h-1.5 bg-neutral-800 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-1000"
          style={{
            width: `${timerPct}%`,
            backgroundColor: timerPct > 50 ? "#10b981" : timerPct > 25 ? "#f59e0b" : "#ef4444",
          }}
        />
      </div>

      {/* Category */}
      <p className="text-xs text-muted-foreground">Category: <span className="text-amber-400 font-semibold">{word.category}</span></p>

      {/* Answer area */}
      <div className={`w-full min-h-[56px] rounded-xl border-2 flex items-center justify-center gap-1.5 p-2 transition-colors ${
        flash === "correct" ? "border-emerald-500 bg-emerald-500/20" :
        flash === "wrong" ? "border-red-500 bg-red-500/20" :
        "border-border bg-card"
      }`}>
        {answer.length === 0 ? (
          <span className="text-muted-foreground text-sm">Tap letters below to build your answer</span>
        ) : (
          answer.map((a, i) => (
            <div key={i} className="w-9 h-9 rounded-lg bg-primary/20 border-2 border-primary flex items-center justify-center font-black text-primary text-lg">
              {a.letter}
            </div>
          ))
        )}
      </div>

      {flash === "wrong" && !answered && (
        <p className="text-red-400 text-sm font-semibold">Word was: <span className="font-black">{word.word}</span></p>
      )}
      {flash === "correct" && (
        <p className="text-emerald-400 text-sm font-bold">✅ Correct!</p>
      )}

      {/* Scrambled tiles */}
      <div className="flex flex-wrap justify-center gap-2 min-h-[52px]">
        {tiles.map((tile) => (
          <button
            key={tile.id}
            type="button"
            onClick={() => tapTile(tile)}
            disabled={tile.used || answered}
            className={`w-10 h-10 rounded-lg border-2 font-black text-lg transition-all ${
              tile.used
                ? "opacity-30 cursor-default border-border bg-card text-muted-foreground"
                : `${TILE_COLORS[tile.id % TILE_COLORS.length]} cursor-pointer hover:scale-110 active:scale-95`
            }`}
          >
            {tile.letter}
          </button>
        ))}
      </div>

      {/* Action buttons */}
      <div className="flex gap-2 w-full">
        <button
          type="button"
          onClick={removeLast}
          disabled={answered || answer.length === 0}
          className="flex-1 rounded-xl py-2.5 border-2 border-border bg-card text-foreground font-semibold text-sm hover:bg-accent disabled:opacity-40 transition-all"
        >
          ⌫ Undo
        </button>
        <button
          type="button"
          onClick={submitAnswer}
          disabled={answered || answer.length !== word.word.length}
          className="flex-1 rounded-xl py-2.5 bg-primary text-primary-foreground font-bold text-sm disabled:opacity-40 transition-all"
        >
          Submit
        </button>
        <button
          type="button"
          onClick={skip}
          disabled={answered}
          className="flex-1 rounded-xl py-2.5 border-2 border-border bg-card text-muted-foreground font-semibold text-sm hover:bg-accent disabled:opacity-40 transition-all"
        >
          Skip
        </button>
      </div>
    </div>
  );
}
