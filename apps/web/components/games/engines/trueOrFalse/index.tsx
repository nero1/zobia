"use client";

/**
 * True or False — rapid-fire T/F questions with countdown timer.
 * Correct = +50 pts + time bonus (remaining * 3). Wrong = 0.
 */

import { useEffect, useState, useRef, useCallback } from "react";
import type { GameEngineProps } from "@/components/games/types";
import { useGameSound } from "@/components/games/useGameSound";

interface TFStatement { s: string; answer: boolean }

const ALL_STATEMENTS: TFStatement[] = [
  { s: "The Great Wall of China is visible from space with the naked eye.", answer: false },
  { s: "Humans share about 50% of their DNA with bananas.", answer: true },
  { s: "Mount Everest is the tallest mountain on Earth.", answer: true },
  { s: "Lightning never strikes the same place twice.", answer: false },
  { s: "The Sahara Desert is the largest desert in the world.", answer: false },
  { s: "Bats are blind.", answer: false },
  { s: "Water boils at 100°C at sea level.", answer: true },
  { s: "The Amazon River is the longest river in the world.", answer: false },
  { s: "Diamonds are made of carbon.", answer: true },
  { s: "The moon has its own light source.", answer: false },
  { s: "Penguins live in the Arctic.", answer: false },
  { s: "Honey never spoils and has been found in ancient Egyptian tombs.", answer: true },
  { s: "Humans use only 10% of their brains.", answer: false },
  { s: "Sharks are mammals.", answer: false },
  { s: "The Eiffel Tower was originally built as a temporary structure.", answer: true },
  { s: "Sound travels faster than light.", answer: false },
  { s: "Octopuses have three hearts.", answer: true },
  { s: "The cheetah is the fastest land animal.", answer: true },
  { s: "Venus is the closest planet to Earth on average.", answer: true },
  { s: "Spiders are insects.", answer: false },
  { s: "Goldfish have a memory span of only 3 seconds.", answer: false },
  { s: "The human body has 206 bones.", answer: true },
  { s: "Glass is made from sand.", answer: true },
  { s: "Elephants are the only animals that cannot jump.", answer: true },
  { s: "Cucumbers are fruits.", answer: true },
  { s: "The Pacific Ocean is larger than all the land on Earth combined.", answer: true },
  { s: "Butterflies taste with their feet.", answer: true },
  { s: "Mount Kilimanjaro is in Kenya.", answer: false },
  { s: "A group of crows is called a murder.", answer: true },
  { s: "Cleopatra lived closer to the Moon landing than to the building of the Great Pyramid.", answer: true },
  { s: "Chameleons change color mainly to camouflage from predators.", answer: false },
  { s: "The sun is a planet.", answer: false },
  { s: "Flamingos are born pink.", answer: false },
  { s: "The original Olympic Games were held in Greece.", answer: true },
  { s: "A strawberry is not technically a berry, but a banana is.", answer: true },
  { s: "The moon is larger than Pluto.", answer: true },
  { s: "Napoleon Bonaparte was shorter than average for his time.", answer: false },
  { s: "Oxygen is the most abundant element in the Earth's crust.", answer: true },
  { s: "Snakes can hear through their jawbones.", answer: true },
  { s: "The capital of Australia is Sydney.", answer: false },
  { s: "Humans and dogs have been companions for at least 15,000 years.", answer: true },
  { s: "The speed of light is approximately 300,000 km/s.", answer: true },
  { s: "Coffee beans are actually seeds.", answer: true },
  { s: "Crocodiles can live for over 70 years.", answer: true },
  { s: "The Great Barrier Reef is in the Caribbean Sea.", answer: false },
  { s: "All planets in our solar system rotate in the same direction.", answer: false },
  { s: "Copper is used to make bronze.", answer: true },
  { s: "Fish can drown if deprived of oxygen-rich water.", answer: true },
  { s: "The tallest building in the world is in Dubai.", answer: true },
  { s: "Polar bears have white fur.", answer: false },
  { s: "An ostrich's eye is bigger than its brain.", answer: true },
  { s: "Japan has 4 main islands.", answer: true },
  { s: "Tigers are the largest wild cat species.", answer: true },
  { s: "Cats have 5 toes on each paw.", answer: false },
  { s: "The chemical formula for water is H2O.", answer: true },
  { s: "Saturn could float on water because it is less dense.", answer: true },
  { s: "A group of flamingos is called a flamboyance.", answer: true },
  { s: "The Wright Brothers' first flight lasted over an hour.", answer: false },
  { s: "Worms have both male and female reproductive organs.", answer: true },
  { s: "Pluto is still classified as a planet by the IAU.", answer: false },
  { s: "Elephants are the only land animals that cannot jump.", answer: true },
];

const TIME_MAP: Record<string, number> = { easy: 10, medium: 8, hard: 5 };
const TOTAL = 15;

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export default function TrueOrFalseGame({
  onReady, onGameOver, onScore, difficulty = "medium", paused, soundEnabled = true,
}: GameEngineProps) {
  const timePerQ = TIME_MAP[difficulty] ?? 8;
  const [statements] = useState<TFStatement[]>(() => shuffle(ALL_STATEMENTS).slice(0, TOTAL));
  const [index, setIndex] = useState(0);
  const [score, setScore] = useState(0);
  const [timeLeft, setTimeLeft] = useState(timePerQ);
  const [flash, setFlash] = useState<"correct" | "wrong" | null>(null);
  const [done, setDone] = useState(false);
  const [answered, setAnswered] = useState(false);
  const scoreRef = useRef(0);
  const doneRef = useRef(false);
  const pausedRef = useRef(paused);
  const play = useGameSound(soundEnabled ?? true);

  useEffect(() => { pausedRef.current = paused; }, [paused]);
  useEffect(() => { onReady?.(); }, [onReady]);

  // Timer per question
  useEffect(() => {
    if (done || answered) return;
    const id = setInterval(() => {
      if (pausedRef.current) return;
      setTimeLeft((t) => {
        if (t <= 1) {
          clearInterval(id);
          handleAnswer(null);
          return timePerQ;
        }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, done, answered]);

  const handleAnswer = useCallback((choice: boolean | null) => {
    if (doneRef.current || answered) return;
    setAnswered(true);
    const stmt = statements[index];
    const isCorrect = choice === stmt.answer;
    setFlash(isCorrect ? "correct" : "wrong");

    if (isCorrect && choice !== null) {
      const bonus = Math.max(0, timeLeft) * 3;
      const pts = 50 + bonus;
      scoreRef.current += pts;
      setScore(scoreRef.current);
      onScore?.(scoreRef.current);
      play("match");
    } else {
      play("miss");
    }

    setTimeout(() => {
      const next = index + 1;
      if (next >= TOTAL) {
        doneRef.current = true;
        setDone(true);
        play("win");
        onGameOver(scoreRef.current);
      } else {
        setIndex(next);
        setAnswered(false);
        setFlash(null);
        setTimeLeft(timePerQ);
      }
    }, 800);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, statements, timeLeft, answered, onScore, onGameOver, play, timePerQ]);

  const stmt = statements[index];
  const timerPct = (timeLeft / timePerQ) * 100;

  if (done) {
    return (
      <div className="flex flex-col items-center gap-4 select-none w-full max-w-sm mx-auto">
        <div className="w-full rounded-2xl border-2 border-border bg-card p-6 text-center flex flex-col gap-3">
          <p className="text-2xl font-black text-foreground">Quiz Complete!</p>
          <p className="text-emerald-400 font-bold text-3xl">{scoreRef.current} pts</p>
          <p className="text-muted-foreground">Completed {TOTAL} questions</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3 select-none w-full max-w-sm mx-auto">
      {/* Header */}
      <div className="flex w-full items-center justify-between text-sm px-1">
        <span className="text-muted-foreground">{index + 1} / {TOTAL}</span>
        <span className="text-emerald-400 font-bold text-xl">{score}</span>
        <span className={timeLeft <= 3 ? "text-red-400 font-bold animate-pulse" : "text-muted-foreground"}>
          {timeLeft}s
        </span>
      </div>

      {/* Timer bar */}
      <div className="w-full h-1.5 bg-neutral-800 rounded-full overflow-hidden">
        <div
          className="h-full h-1.5 rounded-full bg-emerald-500 transition-all duration-1000"
          style={{
            width: `${timerPct}%`,
            backgroundColor: timerPct > 50 ? "#10b981" : timerPct > 25 ? "#f59e0b" : "#ef4444",
          }}
        />
      </div>

      {/* Statement */}
      <div className={`w-full rounded-2xl border-2 p-6 text-center min-h-[120px] flex items-center justify-center transition-colors ${
        flash === "correct" ? "border-emerald-500 bg-emerald-500/20" :
        flash === "wrong" ? "border-red-500 bg-red-500/20" :
        "border-border bg-card"
      }`}>
        <p className="text-base font-semibold text-foreground leading-snug">{stmt.s}</p>
      </div>

      {flash && (
        <p className={`font-bold text-lg ${flash === "correct" ? "text-emerald-400" : "text-red-400"}`}>
          {flash === "correct" ? "✅ Correct!" : `❌ Wrong! It was ${stmt.answer ? "TRUE" : "FALSE"}`}
        </p>
      )}

      {/* Buttons */}
      <div className="grid grid-cols-2 gap-3 w-full">
        <button
          type="button"
          disabled={answered}
          onClick={() => handleAnswer(true)}
          className="rounded-xl py-4 px-4 font-bold text-lg border-2 border-emerald-600 bg-emerald-600/20 hover:bg-emerald-600/40 text-emerald-400 transition-all disabled:opacity-40"
        >
          ✅ TRUE
        </button>
        <button
          type="button"
          disabled={answered}
          onClick={() => handleAnswer(false)}
          className="rounded-xl py-4 px-4 font-bold text-lg border-2 border-red-600 bg-red-600/20 hover:bg-red-600/40 text-red-400 transition-all disabled:opacity-40"
        >
          ❌ FALSE
        </button>
      </div>
    </div>
  );
}
