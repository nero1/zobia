"use client";

/**
 * Emoji Quiz — guess the word/movie/phrase from emoji sequences.
 * Correct = +100 pts + time bonus (remaining * 4). Wrong/timeout = 0.
 */

import { useEffect, useState, useRef, useCallback } from "react";
import type { GameEngineProps } from "@/components/games/types";
import { useGameSound } from "@/components/games/useGameSound";

interface EmojiPuzzle { emojis: string; answer: string; hints: string[]; category: string }

const ALL_PUZZLES: EmojiPuzzle[] = [
  // Movies
  { emojis: "🦁👑", answer: "LION KING", hints: ["L", "A Disney animated film"], category: "Movie" },
  { emojis: "🕷🕸👨", answer: "SPIDERMAN", hints: ["S", "Marvel superhero"], category: "Movie" },
  { emojis: "❄👸", answer: "FROZEN", hints: ["F", "Disney ice queen"], category: "Movie" },
  { emojis: "🧙🧙‍♂️💍", answer: "LORD OF THE RINGS", hints: ["L", "Epic fantasy trilogy"], category: "Movie" },
  { emojis: "🚢💑🌊", answer: "TITANIC", hints: ["T", "Jack and Rose"], category: "Movie" },
  { emojis: "👽🚲🌕", answer: "ET", hints: ["E", "Spielberg classic"], category: "Movie" },
  { emojis: "🦈🌊🏖", answer: "JAWS", hints: ["J", "Shark attack film"], category: "Movie" },
  { emojis: "🤖🌍⚙️", answer: "TRANSFORMERS", hints: ["T", "Autobots vs Decepticons"], category: "Movie" },
  { emojis: "🦸‍♂️🦸‍♀️🌍", answer: "AVENGERS", hints: ["A", "Marvel superheroes team"], category: "Movie" },
  { emojis: "🍕🐢🥋", answer: "NINJA TURTLES", hints: ["N", "Heroes in half shell"], category: "Movie" },
  { emojis: "🐠🌊🔍", answer: "FINDING NEMO", hints: ["F", "Pixar ocean film"], category: "Movie" },
  { emojis: "👻🚫👋", answer: "GHOSTBUSTERS", hints: ["G", "Who you gonna call?"], category: "Movie" },
  { emojis: "🦁🧙‍♀️🚪", answer: "NARNIA", hints: ["N", "Lion, Witch and Wardrobe"], category: "Movie" },
  { emojis: "🚗⚡🔙", answer: "BACK TO THE FUTURE", hints: ["B", "DeLorean time machine"], category: "Movie" },
  // Animals
  { emojis: "🌊🦈", answer: "SHARK", hints: ["S", "Ocean predator"], category: "Animal" },
  { emojis: "🌳🐒", answer: "MONKEY", hints: ["M", "Swings in trees"], category: "Animal" },
  { emojis: "🌊🐬", answer: "DOLPHIN", hints: ["D", "Intelligent marine mammal"], category: "Animal" },
  { emojis: "🦋🌸", answer: "BUTTERFLY", hints: ["B", "Flying insect with colorful wings"], category: "Animal" },
  { emojis: "🌿🦎", answer: "CHAMELEON", hints: ["C", "Color-changing reptile"], category: "Animal" },
  { emojis: "❄🐻", answer: "POLAR BEAR", hints: ["P", "Arctic animal"], category: "Animal" },
  { emojis: "🌙🦇", answer: "BAT", hints: ["B", "Nocturnal flying mammal"], category: "Animal" },
  { emojis: "🦒🌳", answer: "GIRAFFE", hints: ["G", "Tallest land animal"], category: "Animal" },
  { emojis: "🌊🐳", answer: "WHALE", hints: ["W", "Largest mammal"], category: "Animal" },
  { emojis: "🏜🦂", answer: "SCORPION", hints: ["S", "Desert arachnid with sting"], category: "Animal" },
  // Phrases / Proverbs
  { emojis: "🌧🏆", answer: "SILVER LINING", hints: ["S", "Positive side of bad situation"], category: "Phrase" },
  { emojis: "🥚👤🤩", answer: "EGO", hints: ["E", "Sense of self"], category: "Phrase" },
  { emojis: "🐝🔑", answer: "BE KEY", hints: ["B", "Being essential"], category: "Phrase" },
  { emojis: "🍋→🍹", answer: "LEMONADE", hints: ["L", "Make the best of things"], category: "Phrase" },
  { emojis: "⏰💰", answer: "TIME IS MONEY", hints: ["T", "Classic proverb"], category: "Phrase" },
  { emojis: "🌧☔", answer: "RAINY DAY", hints: ["R", "Save for a bad time"], category: "Phrase" },
  { emojis: "🐌🐢", answer: "SLOW AND STEADY", hints: ["S", "Wins the race"], category: "Phrase" },
  // Countries
  { emojis: "🌡☀🏛", answer: "EGYPT", hints: ["E", "Land of pyramids"], category: "Country" },
  { emojis: "🍁🏔🐻", answer: "CANADA", hints: ["C", "North American country"], category: "Country" },
  { emojis: "🗼🥖🍷", answer: "FRANCE", hints: ["F", "European country, Eiffel Tower"], category: "Country" },
  { emojis: "🌸🗻⛩", answer: "JAPAN", hints: ["J", "Land of the rising sun"], category: "Country" },
  { emojis: "🦘🏄🌏", answer: "AUSTRALIA", hints: ["A", "Land down under"], category: "Country" },
  { emojis: "🌴☀🎸", answer: "JAMAICA", hints: ["J", "Caribbean island nation"], category: "Country" },
  { emojis: "🏰🍺⚽", answer: "GERMANY", hints: ["G", "European powerhouse"], category: "Country" },
  { emojis: "🦁☀🏃", answer: "KENYA", hints: ["K", "East African nation"], category: "Country" },
  // Food
  { emojis: "🍕🇮🇹", answer: "PIZZA", hints: ["P", "Italian flat bread dish"], category: "Food" },
  { emojis: "🍣🇯🇵", answer: "SUSHI", hints: ["S", "Japanese rice roll"], category: "Food" },
  { emojis: "🌯🌮", answer: "TACO", hints: ["T", "Mexican street food"], category: "Food" },
  { emojis: "🍝🍅", answer: "PASTA", hints: ["P", "Italian noodle dish"], category: "Food" },
  { emojis: "🫓🥑🍋", answer: "AVOCADO TOAST", hints: ["A", "Trendy breakfast"], category: "Food" },
  { emojis: "🍩☕", answer: "DONUT", hints: ["D", "Circular fried pastry"], category: "Food" },
  { emojis: "🍗🌶️🍟", answer: "FRIED CHICKEN", hints: ["F", "Southern comfort food"], category: "Food" },
  { emojis: "🍫🥛", answer: "CHOCOLATE MILK", hints: ["C", "Sweet brown drink"], category: "Food" },
  { emojis: "🍔🥓🧀", answer: "BACON CHEESEBURGER", hints: ["B", "Classic American burger"], category: "Food" },
  { emojis: "🥞🍯", answer: "PANCAKES", hints: ["P", "Flat sweet breakfast cakes"], category: "Food" },
  { emojis: "🌽🧈", answer: "POPCORN", hints: ["P", "Movie theater snack"], category: "Food" },
  { emojis: "🍦🍓", answer: "STRAWBERRY ICE CREAM", hints: ["S", "Pink flavored frozen dessert"], category: "Food" },
];

const TIME_PER = 30;
const TOTAL = 10;

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function getHint(puzzle: EmojiPuzzle, difficulty: string): string {
  if (difficulty === "easy") return `First letter: ${puzzle.answer[0]}`;
  if (difficulty === "medium") {
    // show masked answer with first letter revealed
    return puzzle.answer.split("").map((c, i) => {
      if (c === " ") return " ";
      if (i === 0) return c;
      return "_";
    }).join("");
  }
  return "";
}

export default function EmojiQuizGame({
  onReady, onGameOver, onScore, difficulty = "medium", paused, soundEnabled = true,
}: GameEngineProps) {
  const [puzzles] = useState<EmojiPuzzle[]>(() => shuffle(ALL_PUZZLES).slice(0, TOTAL));
  const [index, setIndex] = useState(0);
  const [score, setScore] = useState(0);
  const [timeLeft, setTimeLeft] = useState(TIME_PER);
  const [input, setInput] = useState("");
  const [flash, setFlash] = useState<"correct" | "wrong" | null>(null);
  const [done, setDone] = useState(false);
  const [answered, setAnswered] = useState(false);
  const scoreRef = useRef(0);
  const doneRef = useRef(false);
  const pausedRef = useRef(paused);
  const play = useGameSound(soundEnabled ?? true);

  useEffect(() => { pausedRef.current = paused; }, [paused]);
  useEffect(() => { onReady?.(); }, [onReady]);

  useEffect(() => {
    if (done || answered) return;
    const id = setInterval(() => {
      if (pausedRef.current) return;
      setTimeLeft((t) => {
        if (t <= 1) {
          clearInterval(id);
          handleResult(false, 0);
          return TIME_PER;
        }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, done, answered]);

  const handleResult = useCallback((isCorrect: boolean, tl: number) => {
    if (doneRef.current || answered) return;
    setAnswered(true);
    setFlash(isCorrect ? "correct" : "wrong");

    if (isCorrect) {
      const bonus = Math.max(0, tl) * 4;
      const pts = 100 + bonus;
      scoreRef.current += pts;
      setScore(scoreRef.current);
      onScore?.(scoreRef.current);
      play("win");
    } else {
      play("miss");
    }

    setTimeout(() => {
      const next = index + 1;
      if (next >= TOTAL) {
        doneRef.current = true;
        setDone(true);
        onGameOver(scoreRef.current);
      } else {
        setIndex(next);
        setAnswered(false);
        setFlash(null);
        setInput("");
        setTimeLeft(TIME_PER);
      }
    }, 900);
  }, [index, answered, onScore, onGameOver, play]);

  const submit = useCallback(() => {
    if (answered || doneRef.current) return;
    const puzzle = puzzles[index];
    const isCorrect = input.trim().toUpperCase().replace(/\s+/g, " ") === puzzle.answer.toUpperCase();
    handleResult(isCorrect, timeLeft);
  }, [input, index, puzzles, answered, timeLeft, handleResult]);

  const puzzle = puzzles[index];
  const hint = getHint(puzzle, difficulty ?? "medium");
  const timerPct = (timeLeft / TIME_PER) * 100;

  if (done) {
    return (
      <div className="flex flex-col items-center gap-4 select-none w-full max-w-sm mx-auto">
        <div className="w-full rounded-2xl border-2 border-border bg-card p-6 text-center flex flex-col gap-3">
          <p className="text-2xl font-black text-foreground">Quiz Complete!</p>
          <p className="text-emerald-400 font-bold text-3xl">{scoreRef.current} pts</p>
          <p className="text-muted-foreground">Completed {TOTAL} emoji puzzles</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3 select-none w-full max-w-sm mx-auto">
      <div className="flex w-full items-center justify-between text-sm px-1">
        <span className="text-muted-foreground">{index + 1}/{TOTAL}</span>
        <span className="text-emerald-400 font-bold text-xl">{score}</span>
        <span className={timeLeft <= 10 ? "text-red-400 font-bold animate-pulse" : "text-muted-foreground"}>
          {timeLeft}s
        </span>
      </div>

      <div className="w-full h-1.5 bg-neutral-800 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-1000"
          style={{
            width: `${timerPct}%`,
            backgroundColor: timerPct > 50 ? "#10b981" : timerPct > 25 ? "#f59e0b" : "#ef4444",
          }}
        />
      </div>

      <div className={`w-full rounded-2xl border-2 p-5 text-center transition-colors ${
        flash === "correct" ? "border-emerald-500 bg-emerald-500/20" :
        flash === "wrong" ? "border-red-500 bg-red-500/20" :
        "border-border bg-card"
      }`}>
        <p className="text-xs text-muted-foreground mb-1">{puzzle.category}</p>
        <p className="text-5xl mb-3 tracking-wide">{puzzle.emojis}</p>
        {hint && (
          <p className="text-sm text-muted-foreground font-mono tracking-widest">
            Hint: {hint}
          </p>
        )}
        {flash === "correct" && <p className="text-emerald-400 font-bold mt-2">✅ {puzzle.answer}!</p>}
        {flash === "wrong" && <p className="text-red-400 font-bold mt-2">❌ It was: {puzzle.answer}</p>}
      </div>

      <div className="flex w-full gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
          placeholder="Type your answer..."
          className="flex-1 rounded-xl border border-border bg-input px-4 py-3 text-base font-semibold text-foreground uppercase tracking-wide focus:outline-none focus:border-primary"
          disabled={answered}
        />
        <button
          type="button"
          onClick={submit}
          disabled={answered || !input.trim()}
          className="px-5 py-3 rounded-xl bg-primary text-primary-foreground font-bold disabled:opacity-40"
        >
          Go!
        </button>
      </div>
    </div>
  );
}
