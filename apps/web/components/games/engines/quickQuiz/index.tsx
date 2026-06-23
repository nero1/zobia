"use client";

/**
 * Quick Quiz — 10 multiple-choice general knowledge questions with a countdown timer.
 * Correct = +100 pts + time bonus (remaining_seconds * 5). Wrong = 0.
 */

import { useEffect, useState, useRef, useCallback } from "react";
import type { GameEngineProps } from "@/components/games/types";
import { useGameSound } from "@/components/games/useGameSound";

interface Question { q: string; options: string[]; answer: number }

const ALL_QUESTIONS: Question[] = [
  { q: "What is the capital of France?", options: ["London","Berlin","Paris","Madrid"], answer: 2 },
  { q: "Which planet is closest to the Sun?", options: ["Venus","Mars","Mercury","Earth"], answer: 2 },
  { q: "How many sides does a hexagon have?", options: ["5","6","7","8"], answer: 1 },
  { q: "Who painted the Mona Lisa?", options: ["Van Gogh","Picasso","Da Vinci","Monet"], answer: 2 },
  { q: "What is the largest ocean on Earth?", options: ["Atlantic","Indian","Arctic","Pacific"], answer: 3 },
  { q: "Which element has the symbol 'O'?", options: ["Gold","Oxygen","Silver","Iron"], answer: 1 },
  { q: "How many players are on a standard soccer team?", options: ["9","10","11","12"], answer: 2 },
  { q: "What is the capital of Japan?", options: ["Seoul","Beijing","Tokyo","Bangkok"], answer: 2 },
  { q: "Which animal is the fastest on land?", options: ["Lion","Horse","Cheetah","Leopard"], answer: 2 },
  { q: "What year did World War II end?", options: ["1943","1944","1945","1946"], answer: 2 },
  { q: "How many continents are there?", options: ["5","6","7","8"], answer: 2 },
  { q: "Which country is the largest by area?", options: ["China","USA","Canada","Russia"], answer: 3 },
  { q: "What is the chemical symbol for gold?", options: ["Gd","Go","Au","Ag"], answer: 2 },
  { q: "Who wrote 'Romeo and Juliet'?", options: ["Dickens","Tolkien","Shakespeare","Hemingway"], answer: 2 },
  { q: "Which is the longest river in the world?", options: ["Amazon","Nile","Yangtze","Congo"], answer: 1 },
  { q: "What is the boiling point of water in Celsius?", options: ["90°","95°","100°","110°"], answer: 2 },
  { q: "Which country invented pizza?", options: ["Greece","Spain","France","Italy"], answer: 3 },
  { q: "What is the capital of Australia?", options: ["Sydney","Melbourne","Canberra","Brisbane"], answer: 2 },
  { q: "How many bones are in the adult human body?", options: ["186","196","206","216"], answer: 2 },
  { q: "Which gas do plants absorb from the air?", options: ["Oxygen","Nitrogen","CO2","Hydrogen"], answer: 2 },
  { q: "Who discovered gravity (legend of the apple)?", options: ["Einstein","Newton","Galileo","Darwin"], answer: 1 },
  { q: "What is the largest mammal?", options: ["Elephant","Blue Whale","Giraffe","Hippo"], answer: 1 },
  { q: "How many strings does a standard guitar have?", options: ["4","5","6","7"], answer: 2 },
  { q: "Which country hosted the 2016 Summer Olympics?", options: ["China","UK","Brazil","Japan"], answer: 2 },
  { q: "What is the currency of the UK?", options: ["Euro","Dollar","Pound","Franc"], answer: 2 },
  { q: "Which planet has rings?", options: ["Jupiter","Mars","Saturn","Neptune"], answer: 2 },
  { q: "How many teeth does an adult human have?", options: ["28","30","32","34"], answer: 2 },
  { q: "What color is the sky on a clear day?", options: ["White","Grey","Blue","Cyan"], answer: 2 },
  { q: "What is the capital of Nigeria?", options: ["Lagos","Kano","Abuja","Ibadan"], answer: 2 },
  { q: "Which fruit is known as the 'king of fruits'?", options: ["Mango","Jackfruit","Durian","Papaya"], answer: 2 },
  { q: "What is the speed of light (approx)?", options: ["100k km/s","200k km/s","300k km/s","400k km/s"], answer: 2 },
  { q: "Which country is home to the kangaroo?", options: ["New Zealand","South Africa","Australia","India"], answer: 2 },
  { q: "What is 7 × 8?", options: ["54","56","58","60"], answer: 1 },
  { q: "Who is known as the 'Father of Computers'?", options: ["Turing","Babbage","Gates","Lovelace"], answer: 1 },
  { q: "What is the largest desert in the world?", options: ["Sahara","Gobi","Arctic","Antarctic"], answer: 3 },
  { q: "Which country has the most natural lakes?", options: ["Russia","USA","Brazil","Canada"], answer: 3 },
  { q: "What instrument does a pianist play?", options: ["Guitar","Violin","Piano","Drums"], answer: 2 },
  { q: "How many days are in a leap year?", options: ["364","365","366","367"], answer: 2 },
  { q: "What is the primary language spoken in Brazil?", options: ["Spanish","Portuguese","English","French"], answer: 1 },
  { q: "Which organ pumps blood through the body?", options: ["Liver","Kidney","Lung","Heart"], answer: 3 },
  { q: "What is the capital of South Africa (executive)?", options: ["Cape Town","Johannesburg","Durban","Pretoria"], answer: 3 },
  { q: "What is the hardest natural substance?", options: ["Gold","Steel","Diamond","Quartz"], answer: 2 },
  { q: "Which animal has the longest neck?", options: ["Elephant","Camel","Giraffe","Ostrich"], answer: 2 },
  { q: "How many colors are in a rainbow?", options: ["5","6","7","8"], answer: 2 },
  { q: "What sport uses a shuttlecock?", options: ["Tennis","Squash","Badminton","Pickleball"], answer: 2 },
  { q: "Which country gave the USA the Statue of Liberty?", options: ["UK","France","Canada","Spain"], answer: 1 },
  { q: "What is the freezing point of water?", options: ["-10°C","0°C","5°C","10°C"], answer: 1 },
  { q: "How many minutes are in a day?", options: ["1200","1440","1600","1800"], answer: 1 },
  { q: "Which planet is known as the Red Planet?", options: ["Jupiter","Venus","Mars","Saturn"], answer: 2 },
  { q: "What is the most spoken language in the world?", options: ["English","Spanish","Hindi","Mandarin"], answer: 3 },
];

const TIME_MAP: Record<string, number> = { easy: 20, medium: 15, hard: 10 };
const TOTAL_QUESTIONS = 10;

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export default function QuickQuizGame({
  onReady, onGameOver, onScore, difficulty = "medium", paused, soundEnabled = true,
}: GameEngineProps) {
  const timePerQ = TIME_MAP[difficulty] ?? 15;
  const [questions] = useState<Question[]>(() => shuffle(ALL_QUESTIONS).slice(0, TOTAL_QUESTIONS));
  const [qIndex, setQIndex] = useState(0);
  const [score, setScore] = useState(0);
  const [correct, setCorrect] = useState(0);
  const [timeLeft, setTimeLeft] = useState(timePerQ);
  const [selected, setSelected] = useState<number | null>(null);
  const [flash, setFlash] = useState<"correct" | "wrong" | null>(null);
  const [done, setDone] = useState(false);
  const scoreRef = useRef(0);
  const correctRef = useRef(0);
  const pausedRef = useRef(paused);
  const doneRef = useRef(false);
  const play = useGameSound(soundEnabled ?? true);

  useEffect(() => { pausedRef.current = paused; }, [paused]);
  useEffect(() => { onReady?.(); }, [onReady]);

  // Timer
  useEffect(() => {
    if (done || selected !== null) return;
    const id = setInterval(() => {
      if (pausedRef.current) return;
      setTimeLeft((t) => {
        if (t <= 1) {
          clearInterval(id);
          handleAnswer(-1);
          return timePerQ;
        }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qIndex, done, selected]);

  const handleAnswer = useCallback((optionIndex: number) => {
    if (doneRef.current || selected !== null) return;
    const q = questions[qIndex];
    const isCorrect = optionIndex === q.answer;
    setSelected(optionIndex);
    setFlash(isCorrect ? "correct" : "wrong");

    if (isCorrect) {
      const timeBonus = Math.max(0, timeLeft) * 5;
      const pts = 100 + timeBonus;
      scoreRef.current += pts;
      correctRef.current += 1;
      setScore(scoreRef.current);
      setCorrect(correctRef.current);
      onScore?.(scoreRef.current);
      play("match");
      if (timeBonus > 0) play("score");
    } else {
      play("miss");
    }

    setTimeout(() => {
      const nextIndex = qIndex + 1;
      if (nextIndex >= TOTAL_QUESTIONS) {
        doneRef.current = true;
        setDone(true);
        play("win");
        onGameOver(scoreRef.current);
      } else {
        setQIndex(nextIndex);
        setSelected(null);
        setFlash(null);
        setTimeLeft(timePerQ);
      }
    }, 900);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qIndex, questions, timeLeft, selected, onScore, onGameOver, play, timePerQ]);

  const q = questions[qIndex];
  const timerPct = (timeLeft / timePerQ) * 100;

  if (done) {
    return (
      <div className="flex flex-col items-center gap-4 select-none w-full max-w-sm mx-auto">
        <div className="w-full rounded-2xl border-2 border-border bg-card p-6 text-center flex flex-col gap-3">
          <p className="text-2xl font-black text-foreground">Quiz Complete!</p>
          <p className="text-emerald-400 font-bold text-3xl">{scoreRef.current} pts</p>
          <p className="text-muted-foreground">{correctRef.current} / {TOTAL_QUESTIONS} correct</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3 select-none w-full max-w-sm mx-auto">
      {/* Header */}
      <div className="flex w-full items-center justify-between text-sm px-1">
        <span className="text-muted-foreground">Q {qIndex + 1}/{TOTAL_QUESTIONS}</span>
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

      {/* Question */}
      <div className={`w-full rounded-2xl border-2 p-5 text-center transition-colors ${
        flash === "correct" ? "border-emerald-500 bg-emerald-500/20" :
        flash === "wrong" ? "border-red-500 bg-red-500/20" :
        "border-border bg-card"
      }`}>
        <p className="text-base font-semibold text-foreground leading-snug">{q.q}</p>
      </div>

      {/* Options */}
      <div className="grid grid-cols-2 gap-2 w-full">
        {q.options.map((opt, i) => {
          const isSelected = selected === i;
          const isCorrect = i === q.answer;
          let cls = "rounded-xl py-3 px-4 font-semibold border-2 text-sm transition-all text-left ";
          if (selected !== null) {
            if (isCorrect) cls += "border-emerald-500 bg-emerald-500/20 text-foreground";
            else if (isSelected) cls += "border-red-500 bg-red-500/20 text-foreground";
            else cls += "border-border bg-card text-muted-foreground opacity-60";
          } else {
            cls += "border-border bg-card hover:bg-accent text-foreground cursor-pointer";
          }
          return (
            <button key={i} type="button" className={cls} onClick={() => handleAnswer(i)} disabled={selected !== null}>
              <span className="font-bold mr-2 text-muted-foreground">{String.fromCharCode(65 + i)}.</span>
              {opt}
            </button>
          );
        })}
      </div>
    </div>
  );
}
