"use client";

/**
 * Memory Match — classic card-flip matching game. Find all pairs.
 * Score = 1000 * pairs / max - moves_penalty. Fewer moves = higher score.
 */

import { useEffect, useState, useCallback, useRef } from "react";
import type { GameEngineProps } from "@/components/games/types";
import { useGameSound } from "@/components/games/useGameSound";

const EMOJIS = ["🐶","🐱","🐭","🐹","🐰","🦊","🐻","🐼","🐨","🦁","🐮","🐷","🐸","🐵","🐔","🐧","🐦","🦆","🦅","🦉","🐺","🦄","🐴","🐝"];
const GRID_MAP: Record<string, { cols: number; pairs: number }> = {
  easy:   { cols: 4, pairs: 6 },
  medium: { cols: 4, pairs: 8 },
  hard:   { cols: 6, pairs: 12 },
};

interface Card { id: number; emoji: string; flipped: boolean; matched: boolean }

function buildDeck(pairs: number): Card[] {
  const emojis = EMOJIS.slice(0, pairs);
  const deck = [...emojis, ...emojis].map((emoji, i) => ({ id: i, emoji, flipped: false, matched: false }));
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

export default function MemoryMatchGame({ onReady, onGameOver, onScore, difficulty = "medium", paused, soundEnabled = true }: GameEngineProps) {
  const { cols, pairs } = GRID_MAP[difficulty] ?? GRID_MAP.medium;
  const [cards, setCards] = useState<Card[]>(() => buildDeck(pairs));
  const [selected, setSelected] = useState<number[]>([]);
  const [moves, setMoves] = useState(0);
  const [matched, setMatched] = useState(0);
  const [done, setDone] = useState(false);
  const [checking, setChecking] = useState(false);
  const play = useGameSound(soundEnabled ?? true);
  const doneRef = useRef(false);
  const pausedRef = useRef(paused);

  useEffect(() => { pausedRef.current = paused; }, [paused]);
  useEffect(() => { onReady?.(); }, [onReady]);

  const flip = useCallback((idx: number) => {
    if (pausedRef.current || checking || done) return;
    const card = cards[idx];
    if (card.flipped || card.matched || selected.includes(idx)) return;

    play("flip");
    const newSelected = [...selected, idx];
    const newCards = cards.map((c, i) => i === idx ? { ...c, flipped: true } : c);
    setCards(newCards);
    setSelected(newSelected);

    if (newSelected.length === 2) {
      setChecking(true);
      setMoves((m) => m + 1);
      const [a, b] = newSelected;
      if (newCards[a].emoji === newCards[b].emoji) {
        play("match");
        setTimeout(() => {
          setCards((prev) => prev.map((c, i) => i === a || i === b ? { ...c, matched: true } : c));
          const newMatched = matched + 1;
          setMatched(newMatched);
          const score = Math.max(0, Math.round((newMatched / pairs) * 1000 - moves * 5));
          onScore?.(score);
          if (newMatched >= pairs) {
            const finalScore = Math.max(0, Math.round(1000 - (moves + 1) * 5));
            onGameOver(finalScore);
            doneRef.current = true;
            setDone(true);
            play("win");
          }
          setSelected([]);
          setChecking(false);
        }, 500);
      } else {
        play("miss");
        setTimeout(() => {
          setCards((prev) => prev.map((c, i) => i === a || i === b ? { ...c, flipped: false } : c));
          setSelected([]);
          setChecking(false);
        }, 900);
      }
    }
  }, [cards, selected, checking, done, matched, pairs, moves, onScore, onGameOver, play]);

  const score = Math.max(0, Math.round((matched / pairs) * 1000 - moves * 5));

  return (
    <div className="flex flex-col items-center gap-3 select-none w-full max-w-sm mx-auto">
      <div className="flex w-full items-center justify-between text-sm px-1">
        <span className="text-muted-foreground">Moves: <span className="text-foreground font-semibold">{moves}</span></span>
        <span className="text-emerald-400 font-semibold">{matched}/{pairs} pairs</span>
        <span className="text-muted-foreground">Score: <span className="text-foreground font-semibold">{score}</span></span>
      </div>

      <div
        className="grid gap-2 w-full"
        style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}
      >
        {cards.map((card, i) => (
          <button
            key={card.id}
            type="button"
            onClick={() => flip(i)}
            className={`aspect-square rounded-xl text-2xl flex items-center justify-center border-2 transition-all duration-300 ${
              card.matched ? "border-emerald-500/50 bg-emerald-950/30 scale-95" :
              card.flipped ? "border-primary/50 bg-primary/10" :
              "border-border bg-card hover:border-primary/30 hover:bg-accent cursor-pointer"
            }`}
          >
            {(card.flipped || card.matched) ? card.emoji : "❓"}
          </button>
        ))}
      </div>

      {done && <div className="text-center text-emerald-400 font-bold">All pairs found! 🎉</div>}
    </div>
  );
}
