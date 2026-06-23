"use client";

/**
 * Flag Quiz — identify countries from flag emojis.
 * 4 multiple-choice options. Correct = +50, Wrong = -10.
 * 15 questions per game.
 */

import { useEffect, useState, useRef, useCallback } from "react";
import type { GameEngineProps } from "@/components/games/types";
import { useGameSound } from "@/components/games/useGameSound";

interface FlagEntry { flag: string; country: string }

// Full flag pool — 55+ countries
const FLAG_POOL: FlagEntry[] = [
  // African flags (prominent)
  { flag: "🇳🇬", country: "Nigeria" },
  { flag: "🇬🇭", country: "Ghana" },
  { flag: "🇰🇪", country: "Kenya" },
  { flag: "🇿🇦", country: "South Africa" },
  { flag: "🇪🇹", country: "Ethiopia" },
  { flag: "🇹🇿", country: "Tanzania" },
  { flag: "🇺🇬", country: "Uganda" },
  { flag: "🇿🇼", country: "Zimbabwe" },
  { flag: "🇷🇼", country: "Rwanda" },
  { flag: "🇸🇳", country: "Senegal" },
  { flag: "🇨🇮", country: "Côte d'Ivoire" },
  { flag: "🇨🇲", country: "Cameroon" },
  { flag: "🇲🇦", country: "Morocco" },
  { flag: "🇪🇬", country: "Egypt" },
  { flag: "🇸🇴", country: "Somalia" },
  { flag: "🇲🇿", country: "Mozambique" },
  { flag: "🇿🇲", country: "Zambia" },
  { flag: "🇲🇱", country: "Mali" },
  { flag: "🇧🇫", country: "Burkina Faso" },
  { flag: "🇦🇴", country: "Angola" },
  // Americas
  { flag: "🇺🇸", country: "United States" },
  { flag: "🇨🇦", country: "Canada" },
  { flag: "🇲🇽", country: "Mexico" },
  { flag: "🇧🇷", country: "Brazil" },
  { flag: "🇦🇷", country: "Argentina" },
  { flag: "🇨🇴", country: "Colombia" },
  { flag: "🇨🇱", country: "Chile" },
  { flag: "🇵🇪", country: "Peru" },
  { flag: "🇨🇺", country: "Cuba" },
  { flag: "🇯🇲", country: "Jamaica" },
  // Europe
  { flag: "🇬🇧", country: "United Kingdom" },
  { flag: "🇫🇷", country: "France" },
  { flag: "🇩🇪", country: "Germany" },
  { flag: "🇮🇹", country: "Italy" },
  { flag: "🇪🇸", country: "Spain" },
  { flag: "🇵🇹", country: "Portugal" },
  { flag: "🇳🇱", country: "Netherlands" },
  { flag: "🇷🇺", country: "Russia" },
  { flag: "🇸🇪", country: "Sweden" },
  { flag: "🇳🇴", country: "Norway" },
  { flag: "🇵🇱", country: "Poland" },
  { flag: "🇬🇷", country: "Greece" },
  { flag: "🇨🇭", country: "Switzerland" },
  { flag: "🇧🇪", country: "Belgium" },
  { flag: "🇦🇹", country: "Austria" },
  // Asia
  { flag: "🇨🇳", country: "China" },
  { flag: "🇯🇵", country: "Japan" },
  { flag: "🇮🇳", country: "India" },
  { flag: "🇰🇷", country: "South Korea" },
  { flag: "🇸🇦", country: "Saudi Arabia" },
  { flag: "🇹🇷", country: "Turkey" },
  { flag: "🇮🇩", country: "Indonesia" },
  { flag: "🇵🇭", country: "Philippines" },
  { flag: "🇹🇭", country: "Thailand" },
  { flag: "🇻🇳", country: "Vietnam" },
  { flag: "🇵🇰", country: "Pakistan" },
  { flag: "🇮🇷", country: "Iran" },
  // Oceania
  { flag: "🇦🇺", country: "Australia" },
  { flag: "🇳🇿", country: "New Zealand" },
];

const TOTAL = 15;

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

interface Question { flag: string; country: string; options: string[] }

function buildQuestions(difficulty: string): Question[] {
  const pool = shuffle(FLAG_POOL);
  const questions: Question[] = [];
  for (let i = 0; i < TOTAL && i < pool.length; i++) {
    const correct = pool[i];
    const distractors = pool.filter((_, j) => j !== i).slice(0, 20);
    const shuffledDistractors = shuffle(distractors).slice(0, 3);
    const options = shuffle([correct.country, ...shuffledDistractors.map((d) => d.country)]);
    questions.push({ flag: correct.flag, country: correct.country, options });
  }
  return questions;
}

export default function FlagQuizGame({
  onReady, onGameOver, onScore, difficulty = "medium", paused, soundEnabled = true,
}: GameEngineProps) {
  const [questions] = useState<Question[]>(() => buildQuestions(difficulty ?? "medium"));
  const [index, setIndex] = useState(0);
  const [score, setScore] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [flash, setFlash] = useState<"correct" | "wrong" | null>(null);
  const [done, setDone] = useState(false);
  const scoreRef = useRef(0);
  const doneRef = useRef(false);
  const pausedRef = useRef(paused);
  const play = useGameSound(soundEnabled ?? true);

  useEffect(() => { pausedRef.current = paused; }, [paused]);
  useEffect(() => { onReady?.(); }, [onReady]);

  const handleAnswer = useCallback((choice: string) => {
    if (doneRef.current || selected !== null || pausedRef.current) return;
    const q = questions[index];
    const isCorrect = choice === q.country;
    setSelected(choice);
    setFlash(isCorrect ? "correct" : "wrong");

    if (isCorrect) {
      scoreRef.current += 50;
      play("match");
    } else {
      scoreRef.current = Math.max(0, scoreRef.current - 10);
      play("miss");
    }
    setScore(scoreRef.current);
    onScore?.(scoreRef.current);

    setTimeout(() => {
      const next = index + 1;
      if (next >= TOTAL) {
        doneRef.current = true;
        setDone(true);
        play("win");
        onGameOver(scoreRef.current);
      } else {
        setIndex(next);
        setSelected(null);
        setFlash(null);
      }
    }, 900);
  }, [index, questions, selected, onScore, onGameOver, play]);

  const q = questions[index];

  if (done) {
    return (
      <div className="flex flex-col items-center gap-4 select-none w-full max-w-sm mx-auto">
        <div className="w-full rounded-2xl border-2 border-border bg-card p-6 text-center flex flex-col gap-3">
          <p className="text-2xl font-black text-foreground">Quiz Complete!</p>
          <p className="text-emerald-400 font-bold text-3xl">{scoreRef.current} pts</p>
          <p className="text-muted-foreground">Identified {TOTAL} flags</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-4 select-none w-full max-w-sm mx-auto">
      <div className="flex w-full items-center justify-between text-sm px-1">
        <span className="text-muted-foreground">Flag {index + 1}/{TOTAL}</span>
        <span className="text-emerald-400 font-bold text-xl">{score}</span>
      </div>

      {/* Flag display */}
      <div className={`w-full rounded-2xl border-2 p-6 text-center transition-colors ${
        flash === "correct" ? "border-emerald-500 bg-emerald-500/20" :
        flash === "wrong" ? "border-red-500 bg-red-500/20" :
        "border-border bg-card"
      }`}>
        <p className="text-8xl leading-none">{q.flag}</p>
        {flash === "correct" && <p className="text-emerald-400 font-bold mt-3">✅ {q.country}!</p>}
        {flash === "wrong" && selected && (
          <p className="text-red-400 font-bold mt-3">❌ It was {q.country}</p>
        )}
      </div>

      {/* Options */}
      <div className="grid grid-cols-2 gap-2 w-full">
        {q.options.map((opt) => {
          const isSelected = selected === opt;
          const isCorrect = opt === q.country;
          let cls = "rounded-xl py-3 px-3 font-semibold border-2 text-sm transition-all text-center ";
          if (selected !== null) {
            if (isCorrect) cls += "border-emerald-500 bg-emerald-500/20 text-foreground";
            else if (isSelected) cls += "border-red-500 bg-red-500/20 text-foreground";
            else cls += "border-border bg-card text-muted-foreground opacity-50";
          } else {
            cls += "border-border bg-card hover:bg-accent text-foreground cursor-pointer";
          }
          return (
            <button key={opt} type="button" className={cls} onClick={() => handleAnswer(opt)} disabled={selected !== null}>
              {opt}
            </button>
          );
        })}
      </div>
    </div>
  );
}
