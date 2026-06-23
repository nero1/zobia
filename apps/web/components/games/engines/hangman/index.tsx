"use client";

/**
 * Hangman — classic word guessing game with progressive hangman art.
 * Score = letters_remaining_in_guess_pool * 20 when solved.
 */

import { useEffect, useState, useRef, useCallback } from "react";
import type { GameEngineProps } from "@/components/games/types";
import { useGameSound } from "@/components/games/useGameSound";

interface WordEntry { word: string; category: string }

const WORD_POOL: WordEntry[] = [
  // Animals
  { word: "ELEPHANT", category: "Animal" }, { word: "GIRAFFE", category: "Animal" },
  { word: "CROCODILE", category: "Animal" }, { word: "PENGUIN", category: "Animal" },
  { word: "CHEETAH", category: "Animal" }, { word: "DOLPHIN", category: "Animal" },
  { word: "KANGAROO", category: "Animal" }, { word: "FLAMINGO", category: "Animal" },
  { word: "SCORPION", category: "Animal" }, { word: "PLATYPUS", category: "Animal" },
  { word: "CHAMELEON", category: "Animal" }, { word: "PORCUPINE", category: "Animal" },
  // Countries
  { word: "AUSTRALIA", category: "Country" }, { word: "ARGENTINA", category: "Country" },
  { word: "ETHIOPIA", category: "Country" }, { word: "PORTUGAL", category: "Country" },
  { word: "SINGAPORE", category: "Country" }, { word: "INDONESIA", category: "Country" },
  { word: "ZIMBABWE", category: "Country" }, { word: "CAMBODIA", category: "Country" },
  { word: "VENEZUELA", category: "Country" }, { word: "PHILIPPINES", category: "Country" },
  // Sports
  { word: "BASKETBALL", category: "Sport" }, { word: "VOLLEYBALL", category: "Sport" },
  { word: "BADMINTON", category: "Sport" }, { word: "WRESTLING", category: "Sport" },
  { word: "SWIMMING", category: "Sport" }, { word: "GYMNASTICS", category: "Sport" },
  { word: "MARATHON", category: "Sport" }, { word: "SKATEBOARD", category: "Sport" },
  { word: "CRICKET", category: "Sport" }, { word: "ARCHERY", category: "Sport" },
  // Food
  { word: "CHOCOLATE", category: "Food" }, { word: "SPAGHETTI", category: "Food" },
  { word: "BLUEBERRY", category: "Food" }, { word: "PINEAPPLE", category: "Food" },
  { word: "AVOCADO", category: "Food" }, { word: "BROCCOLI", category: "Food" },
  { word: "CHEESECAKE", category: "Food" }, { word: "HAMBURGER", category: "Food" },
  { word: "CROISSANT", category: "Food" }, { word: "ASPARAGUS", category: "Food" },
  // Science
  { word: "MOLECULE", category: "Science" }, { word: "HYDROGEN", category: "Science" },
  { word: "ELECTRON", category: "Science" }, { word: "TELESCOPE", category: "Science" },
  { word: "CHEMISTRY", category: "Science" }, { word: "PHOTOSYNTHESIS", category: "Science" },
  { word: "EVOLUTION", category: "Science" }, { word: "SATELLITE", category: "Science" },
  // Places
  { word: "MOUNTAINS", category: "Place" }, { word: "CATHEDRAL", category: "Place" },
  { word: "WATERFALL", category: "Place" }, { word: "PENINSULA", category: "Place" },
  { word: "RAINFOREST", category: "Place" }, { word: "ARCHIPELAGO", category: "Place" },
  // Things
  { word: "TELESCOPE", category: "Object" }, { word: "CALCULATOR", category: "Object" },
  { word: "MICROPHONE", category: "Object" }, { word: "HELICOPTER", category: "Object" },
  { word: "SUBMARINE", category: "Object" }, { word: "PARACHUTE", category: "Object" },
  { word: "DICTIONARY", category: "Object" }, { word: "THERMOMETER", category: "Object" },
  // Professions
  { word: "ARCHITECT", category: "Profession" }, { word: "CARPENTER", category: "Profession" },
  { word: "PHARMACIST", category: "Profession" }, { word: "DETECTIVE", category: "Profession" },
  { word: "PLUMBER", category: "Profession" }, { word: "PROFESSOR", category: "Profession" },
  { word: "ASTRONAUT", category: "Profession" }, { word: "JOURNALIST", category: "Profession" },
  { word: "ELECTRICIAN", category: "Profession" }, { word: "VETERINARIAN", category: "Profession" },
  { word: "FIREFIGHTER", category: "Profession" }, { word: "ACCOUNTANT", category: "Profession" },
];

const MAX_WRONG_MAP: Record<string, number> = { easy: 8, medium: 6, hard: 5 };
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

// SVG hangman stages — 0 = empty gallows, 7 = complete hangman
function HangmanSVG({ stage }: { stage: number }) {
  return (
    <svg viewBox="0 0 120 130" className="w-32 h-36" strokeLinecap="round" strokeLinejoin="round">
      {/* Gallows */}
      <line x1="10" y1="125" x2="110" y2="125" stroke="#6b7280" strokeWidth="3" />
      <line x1="30" y1="125" x2="30" y2="10" stroke="#6b7280" strokeWidth="3" />
      <line x1="30" y1="10" x2="75" y2="10" stroke="#6b7280" strokeWidth="3" />
      <line x1="75" y1="10" x2="75" y2="25" stroke="#6b7280" strokeWidth="3" />
      {/* Head */}
      {stage >= 1 && <circle cx="75" cy="35" r="10" stroke="#f59e0b" strokeWidth="2.5" fill="none" />}
      {/* Body */}
      {stage >= 2 && <line x1="75" y1="45" x2="75" y2="80" stroke="#f59e0b" strokeWidth="2.5" />}
      {/* Left arm */}
      {stage >= 3 && <line x1="75" y1="55" x2="55" y2="70" stroke="#f59e0b" strokeWidth="2.5" />}
      {/* Right arm */}
      {stage >= 4 && <line x1="75" y1="55" x2="95" y2="70" stroke="#f59e0b" strokeWidth="2.5" />}
      {/* Left leg */}
      {stage >= 5 && <line x1="75" y1="80" x2="55" y2="105" stroke="#f59e0b" strokeWidth="2.5" />}
      {/* Right leg */}
      {stage >= 6 && <line x1="75" y1="80" x2="95" y2="105" stroke="#f59e0b" strokeWidth="2.5" />}
      {/* Face (only when almost dead) */}
      {stage >= 7 && (
        <>
          <line x1="70" y1="32" x2="72" y2="34" stroke="#ef4444" strokeWidth="1.5" />
          <line x1="72" y1="32" x2="70" y2="34" stroke="#ef4444" strokeWidth="1.5" />
          <line x1="78" y1="32" x2="80" y2="34" stroke="#ef4444" strokeWidth="1.5" />
          <line x1="80" y1="32" x2="78" y2="34" stroke="#ef4444" strokeWidth="1.5" />
          <path d="M70 40 Q75 37 80 40" stroke="#ef4444" strokeWidth="1.5" fill="none" />
        </>
      )}
    </svg>
  );
}

export default function HangmanGame({
  onReady, onGameOver, onScore, difficulty = "medium", paused, soundEnabled = true,
}: GameEngineProps) {
  const maxWrong = MAX_WRONG_MAP[difficulty ?? "medium"] ?? 6;
  const showCategory = difficulty !== "hard";
  const [entry] = useState<WordEntry>(() => WORD_POOL[Math.floor(Math.random() * WORD_POOL.length)]);
  const [guessed, setGuessed] = useState<Set<string>>(new Set());
  const [done, setDone] = useState(false);
  const [won, setWon] = useState(false);
  const doneRef = useRef(false);
  const pausedRef = useRef(paused);
  const play = useGameSound(soundEnabled ?? true);

  useEffect(() => { pausedRef.current = paused; }, [paused]);
  useEffect(() => { onReady?.(); }, [onReady]);

  const { word, category } = entry;
  const wrongLetters = [...guessed].filter((l) => !word.includes(l));
  const correctLetters = [...guessed].filter((l) => word.includes(l));
  const wrongCount = wrongLetters.length;

  // Map to visual stages (clamp to 7 for SVG)
  const stage = Math.min(7, Math.round((wrongCount / maxWrong) * 7));

  const handleGuess = useCallback((letter: string) => {
    if (pausedRef.current || done || guessed.has(letter)) return;
    const newGuessed = new Set(guessed);
    newGuessed.add(letter);
    setGuessed(newGuessed);

    const isCorrect = word.includes(letter);
    if (isCorrect) {
      play("match");
      // Check win
      const allRevealed = word.split("").every((c) => newGuessed.has(c));
      if (allRevealed) {
        const guessPoolRemaining = ALPHABET.length - newGuessed.size;
        const score = Math.max(0, guessPoolRemaining * 20);
        doneRef.current = true;
        setDone(true);
        setWon(true);
        play("win");
        onScore?.(score);
        onGameOver(score);
      }
    } else {
      play("miss");
      const newWrong = [...newGuessed].filter((l) => !word.includes(l)).length;
      if (newWrong >= maxWrong) {
        doneRef.current = true;
        setDone(true);
        setWon(false);
        play("lose");
        onGameOver(0);
      }
    }
  }, [guessed, word, done, maxWrong, play, onScore, onGameOver]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (/^[a-zA-Z]$/.test(e.key)) handleGuess(e.key.toUpperCase());
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleGuess]);

  const KEYBOARD_ROWS = [
    "QWERTYUIOP".split(""),
    "ASDFGHJKL".split(""),
    "ZXCVBNM".split(""),
  ];

  return (
    <div className="flex flex-col items-center gap-3 select-none w-full max-w-sm mx-auto">
      {/* Status */}
      <div className="flex w-full items-center justify-between text-sm px-1">
        {showCategory && <span className="text-amber-400 font-semibold text-xs">{category}</span>}
        <span className={`font-semibold text-sm ml-auto ${wrongCount >= maxWrong - 1 ? "text-red-400" : "text-muted-foreground"}`}>
          {wrongCount}/{maxWrong} wrong
        </span>
      </div>

      {/* Hangman art */}
      <div className="flex items-center justify-center">
        <HangmanSVG stage={stage} />
      </div>

      {/* Word display */}
      <div className="flex gap-2 flex-wrap justify-center">
        {word.split("").map((letter, i) => (
          <div key={i} className={`w-9 h-10 border-b-2 flex items-center justify-center text-xl font-black uppercase ${
            guessed.has(letter) ? "text-foreground border-emerald-500" : "text-transparent border-border"
          }`}>
            {guessed.has(letter) ? letter : "_"}
          </div>
        ))}
      </div>

      {/* Wrong letters */}
      {wrongLetters.length > 0 && (
        <div className="text-center">
          <p className="text-xs text-muted-foreground mb-1">Wrong letters:</p>
          <p className="text-red-400 font-bold tracking-widest">{wrongLetters.join(" ")}</p>
        </div>
      )}

      {/* Outcome */}
      {done && (
        <div className={`w-full rounded-xl border-2 p-3 text-center font-bold ${
          won ? "border-emerald-500 bg-emerald-500/20 text-emerald-400" : "border-red-500 bg-red-500/20 text-red-400"
        }`}>
          {won ? "🎉 You won!" : `💀 Game over! Word was: ${word}`}
        </div>
      )}

      {/* Keyboard */}
      {!done && (
        <div className="flex flex-col gap-1 w-full">
          {KEYBOARD_ROWS.map((row, ri) => (
            <div key={ri} className="flex justify-center gap-1">
              {row.map((key) => {
                const isGuessed = guessed.has(key);
                const isCorrect = isGuessed && word.includes(key);
                const isWrong = isGuessed && !word.includes(key);
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => handleGuess(key)}
                    disabled={isGuessed || done}
                    className={`w-8 py-2.5 rounded-md font-bold text-xs border transition-all ${
                      isCorrect ? "bg-emerald-600 border-emerald-600 text-white" :
                      isWrong ? "bg-neutral-700 border-neutral-700 text-neutral-500 line-through" :
                      "border-border bg-card text-foreground hover:bg-accent cursor-pointer"
                    } disabled:cursor-default`}
                  >
                    {key}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
