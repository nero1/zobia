"use client";

/**
 * Word Guess — Wordle-style 5-letter word guessing game.
 * 6 attempts. Score = (6 - attempts_used) * 100 + 50.
 */

import { useEffect, useState, useRef, useCallback } from "react";
import type { GameEngineProps } from "@/components/games/types";
import { useGameSound } from "@/components/games/useGameSound";

const WORD_POOL = [
  "APPLE","BRAIN","CHAIR","DANCE","EARTH","FLAME","GRACE","HEART","IRONY","JOKER",
  "KNEEL","LEMON","MAGIC","NIGHT","OLIVE","PIANO","QUEEN","RIVER","SMILE","TIGER",
  "UMBRA","VALOR","WITCH","XENON","YACHT","ZEBRA","BRAVE","CLOCK","DREAM","EAGLE",
  "FROST","GLOBE","HAVEN","INPUT","JEWEL","KARMA","LASER","MAPLE","NOBLE","ORBIT",
  "PROUD","QUEST","RALLY","SHARK","TREND","ULTRA","VIVID","WHALE","EXTRA","YODEL",
  "BLAZE","CRISP","DEPTH","EVENT","FABLE","GIANT","HINGE","INDEX","JUDGE","KNACK",
  "LIGHT","MERCY","NERVE","OCEAN","PATCH","QUIRK","REIGN","STEAK","TOWER","UNIFY",
  "VIBES","WEIRD","AXIOM","AZURE","BEACH","CABIN","DAILY","EAGER","FAIRY","GRANT",
  "HABIT","IDEAL","JUICE","KNOCK","LEVEL","MINOR","NORTH","OUTER","PLANT","QUIET",
  "ROUGH","SQUAD","THEME","UPPER","VOICE","WORLD","XENON","YOUNG","ZONED","BLUNT",
  "CARGO","DENSE","ENVY","FIXED","GROWN","HARSH","INLET","JAUNT","KITTY","LUNAR",
];

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
const MAX_GUESSES = 6;
const WORD_LENGTH = 5;

type LetterState = "correct" | "present" | "absent" | "unused";

interface GuessRow { letters: string[]; states: LetterState[] }

function evaluateGuess(guess: string, target: string): LetterState[] {
  const result: LetterState[] = Array(WORD_LENGTH).fill("absent");
  const targetArr = target.split("");
  const guessArr = guess.split("");
  const usedTarget: boolean[] = Array(WORD_LENGTH).fill(false);
  // First pass: correct positions
  for (let i = 0; i < WORD_LENGTH; i++) {
    if (guessArr[i] === targetArr[i]) {
      result[i] = "correct";
      usedTarget[i] = true;
    }
  }
  // Second pass: present (wrong position)
  for (let i = 0; i < WORD_LENGTH; i++) {
    if (result[i] === "correct") continue;
    for (let j = 0; j < WORD_LENGTH; j++) {
      if (!usedTarget[j] && guessArr[i] === targetArr[j]) {
        result[i] = "present";
        usedTarget[j] = true;
        break;
      }
    }
  }
  return result;
}

function stateColor(state: LetterState, used: boolean) {
  if (state === "correct") return "bg-emerald-600 border-emerald-600 text-white";
  if (state === "present") return "bg-amber-500 border-amber-500 text-white";
  if (state === "absent") return "bg-neutral-700 border-neutral-700 text-white";
  if (used) return "border-border bg-neutral-800 text-muted-foreground";
  return "border-border bg-card text-foreground";
}

export default function WordGuessGame({
  onReady, onGameOver, onScore, difficulty = "medium", paused, soundEnabled = true,
}: GameEngineProps) {
  const [target] = useState(() => WORD_POOL[Math.floor(Math.random() * WORD_POOL.length)]);
  const [guesses, setGuesses] = useState<GuessRow[]>([]);
  const [current, setCurrent] = useState("");
  const [done, setDone] = useState(false);
  const [won, setWon] = useState(false);
  const [shake, setShake] = useState(false);
  const [letterMap, setLetterMap] = useState<Record<string, LetterState>>({});
  const doneRef = useRef(false);
  const pausedRef = useRef(paused);
  const play = useGameSound(soundEnabled ?? true);

  // Easy mode: reveal first letter as hint
  const [hint] = useState(() => difficulty === "easy" ? target[0] : "");

  useEffect(() => { pausedRef.current = paused; }, [paused]);
  useEffect(() => { onReady?.(); }, [onReady]);

  const submitGuess = useCallback(() => {
    if (pausedRef.current || done || current.length !== WORD_LENGTH) return;
    const states = evaluateGuess(current, target);

    // Animate reveals
    states.forEach((_, i) => {
      setTimeout(() => play("flip"), i * 100);
    });

    const row: GuessRow = { letters: current.split(""), states };
    const newGuesses = [...guesses, row];
    setGuesses(newGuesses);

    // Update letter map
    setLetterMap((prev) => {
      const updated = { ...prev };
      current.split("").forEach((ch, i) => {
        const prev_state = updated[ch] ?? "unused";
        const new_state = states[i];
        const priority: LetterState[] = ["correct", "present", "absent", "unused"];
        if (priority.indexOf(new_state) < priority.indexOf(prev_state)) {
          updated[ch] = new_state;
        }
      });
      return updated;
    });

    const isWin = states.every((s) => s === "correct");
    setCurrent("");

    setTimeout(() => {
      if (isWin) {
        const attemptsUsed = newGuesses.length;
        const score = (MAX_GUESSES - attemptsUsed) * 100 + 50;
        doneRef.current = true;
        setDone(true);
        setWon(true);
        play("win");
        onScore?.(score);
        onGameOver(score);
      } else if (newGuesses.length >= MAX_GUESSES) {
        doneRef.current = true;
        setDone(true);
        setWon(false);
        play("miss");
        onGameOver(0);
      } else {
        play("miss");
      }
    }, WORD_LENGTH * 100 + 200);
  }, [current, guesses, target, done, play, onScore, onGameOver]);

  const handleKey = useCallback((key: string) => {
    if (pausedRef.current || done) return;
    if (key === "BACKSPACE" || key === "⌫") {
      setCurrent((c) => c.slice(0, -1));
    } else if (key === "ENTER" || key === "↵") {
      submitGuess();
    } else if (/^[A-Z]$/.test(key) && current.length < WORD_LENGTH) {
      setCurrent((c) => c + key);
    }
  }, [done, current, submitGuess]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Backspace") handleKey("BACKSPACE");
      else if (e.key === "Enter") handleKey("ENTER");
      else if (/^[a-zA-Z]$/.test(e.key)) handleKey(e.key.toUpperCase());
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleKey]);

  // Build display grid
  const displayRows: Array<{ letters: string[]; states: LetterState[]; isCurrent: boolean }> = [];
  for (let i = 0; i < MAX_GUESSES; i++) {
    if (i < guesses.length) {
      displayRows.push({ ...guesses[i], isCurrent: false });
    } else if (i === guesses.length && !done) {
      const letters = current.split("").concat(Array(WORD_LENGTH - current.length).fill(""));
      displayRows.push({ letters, states: Array(WORD_LENGTH).fill("unused"), isCurrent: true });
    } else {
      displayRows.push({ letters: Array(WORD_LENGTH).fill(""), states: Array(WORD_LENGTH).fill("unused"), isCurrent: false });
    }
  }

  // Hard mode: don't show keyboard letter states
  const showLetterStates = difficulty !== "hard";

  const KEYBOARD_ROWS = [
    ["Q","W","E","R","T","Y","U","I","O","P"],
    ["A","S","D","F","G","H","J","K","L"],
    ["↵","Z","X","C","V","B","N","M","⌫"],
  ];

  return (
    <div className="flex flex-col items-center gap-3 select-none w-full max-w-sm mx-auto">
      {/* Header */}
      <div className="flex w-full items-center justify-between text-sm px-1">
        <span className="text-muted-foreground">Guesses: {guesses.length}/{MAX_GUESSES}</span>
        {hint && <span className="text-amber-400 text-xs">Hint: starts with <strong>{hint}</strong></span>}
        {done && won && <span className="text-emerald-400 font-bold">🎉 You got it!</span>}
        {done && !won && <span className="text-red-400 font-bold">Word: {target}</span>}
      </div>

      {/* Grid */}
      <div className="flex flex-col gap-1.5 w-full">
        {displayRows.map((row, ri) => (
          <div key={ri} className={`grid gap-1.5 ${shake && ri === guesses.length ? "animate-bounce" : ""}`}
            style={{ gridTemplateColumns: `repeat(${WORD_LENGTH}, 1fr)` }}>
            {row.letters.map((letter, li) => {
              const isGuessed = ri < guesses.length;
              return (
                <div key={li} className={`aspect-square rounded-lg border-2 flex items-center justify-center text-lg font-black uppercase transition-all duration-300 ${
                  isGuessed ? stateColor(row.states[li], false) :
                  (letter ? "border-primary bg-card text-foreground" : "border-border bg-card text-foreground")
                }`}>
                  {letter}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* Virtual keyboard */}
      <div className="flex flex-col gap-1 w-full mt-1">
        {KEYBOARD_ROWS.map((row, ri) => (
          <div key={ri} className="flex justify-center gap-1">
            {row.map((key) => {
              const state = showLetterStates ? (letterMap[key] ?? "unused") : "unused";
              const isUsed = ALPHABET.includes(key) && letterMap[key] !== undefined;
              const isSpecial = key === "↵" || key === "⌫";
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => handleKey(key)}
                  className={`rounded-md font-bold text-xs border transition-all ${
                    isSpecial ? "px-2 py-3 min-w-[36px]" : "w-8 py-3"
                  } ${
                    state === "correct" ? "bg-emerald-600 border-emerald-600 text-white" :
                    state === "present" ? "bg-amber-500 border-amber-500 text-white" :
                    state === "absent" ? "bg-neutral-700 border-neutral-700 text-neutral-400" :
                    "border-border bg-card text-foreground hover:bg-accent"
                  }`}
                >
                  {key}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
