"use client";

/**
 * Rock Paper Scissors — best of 5 rounds vs AI with subtle pattern.
 * Score = wins × 100 + (streak bonus).
 */

import { useEffect, useState, useCallback, useRef } from "react";
import type { GameEngineProps } from "@/components/games/types";
import { useGameSound } from "@/components/games/useGameSound";

type Move = "rock" | "paper" | "scissors";
type Outcome = "win" | "lose" | "draw";

const MOVES: Move[] = ["rock", "paper", "scissors"];
const EMOJIS: Record<Move, string> = { rock: "✊", paper: "🖐", scissors: "✌️" };
const BEATS: Record<Move, Move> = { rock: "scissors", paper: "rock", scissors: "paper" };

const ROUNDS_TARGET: Record<string, number> = { easy: 3, medium: 5, hard: 7 };

// AI: mostly random but occasionally picks the winning counter
function aiPick(history: Move[], difficulty: string): Move {
  if (difficulty === "easy" || history.length < 2) return MOVES[Math.floor(Math.random() * 3)];
  const cheat = difficulty === "hard" ? 0.4 : 0.25;
  if (Math.random() < cheat) {
    const last = history[history.length - 1];
    // pick what beats the player's last move
    return (Object.keys(BEATS) as Move[]).find((k) => BEATS[k] === last) ?? MOVES[Math.floor(Math.random() * 3)];
  }
  return MOVES[Math.floor(Math.random() * 3)];
}

function outcome(player: Move, ai: Move): Outcome {
  if (player === ai) return "draw";
  if (BEATS[player] === ai) return "win";
  return "lose";
}

export default function RockPaperScissorsGame({ onReady, onGameOver, onScore, difficulty = "medium", paused, soundEnabled = true }: GameEngineProps) {
  const target = ROUNDS_TARGET[difficulty] ?? 5;
  const [playerHistory, setPlayerHistory] = useState<Move[]>([]);
  const [rounds, setRounds] = useState<{ player: Move; ai: Move; outcome: Outcome }[]>([]);
  const [wins, setWins] = useState(0);
  const [losses, setLosses] = useState(0);
  const [draws, setDraws] = useState(0);
  const [streak, setStreak] = useState(0);
  const [done, setDone] = useState(false);
  const [lastOutcome, setLastOutcome] = useState<Outcome | null>(null);
  const [aiChoice, setAiChoice] = useState<Move | null>(null);
  const [animating, setAnimating] = useState(false);
  const play = useGameSound(soundEnabled ?? true);
  const pausedRef = useRef(paused);

  useEffect(() => { pausedRef.current = paused; }, [paused]);
  useEffect(() => { onReady?.(); }, [onReady]);

  const pick = useCallback((move: Move) => {
    if (pausedRef.current || done || animating) return;
    const ai = aiPick(playerHistory, difficulty);
    const out = outcome(move, ai);

    setAiChoice(ai);
    setLastOutcome(out);
    setAnimating(true);

    const newHistory = [...playerHistory, move];
    setPlayerHistory(newHistory);

    const newRounds = [...rounds, { player: move, ai, outcome: out }];
    const newWins = wins + (out === "win" ? 1 : 0);
    const newLosses = losses + (out === "lose" ? 1 : 0);
    const newDraws = draws + (out === "draw" ? 1 : 0);
    const newStreak = out === "win" ? streak + 1 : 0;

    setRounds(newRounds);
    setWins(newWins);
    setLosses(newLosses);
    setDraws(newDraws);
    setStreak(newStreak);

    if (out === "win") play("match");
    else if (out === "lose") play("miss");
    else play("click");

    const score = newWins * 100 + newStreak * 20;
    onScore?.(score);

    const roundsPlayed = newRounds.length;
    if (roundsPlayed >= target || newWins >= Math.ceil(target / 2) + 1 || newLosses >= Math.ceil(target / 2) + 1) {
      setTimeout(() => {
        setDone(true);
        onGameOver(score);
      }, 900);
    }

    setTimeout(() => setAnimating(false), 800);
  }, [done, animating, playerHistory, rounds, wins, losses, draws, streak, difficulty, target, onScore, onGameOver, play]);

  const outcomeColor: Record<Outcome, string> = { win: "text-emerald-400", lose: "text-red-400", draw: "text-amber-400" };
  const outcomeLabel: Record<Outcome, string> = { win: "You win! ✊", lose: "AI wins!", draw: "Draw!" };

  return (
    <div className="flex flex-col items-center gap-4 select-none w-full max-w-sm mx-auto">
      {/* Scoreboard */}
      <div className="flex w-full justify-around text-sm font-semibold border border-border rounded-xl py-2 bg-card">
        <span className="text-emerald-400">You: {wins}</span>
        <span className="text-muted-foreground">Draw: {draws}</span>
        <span className="text-red-400">AI: {losses}</span>
      </div>

      {/* Battle arena */}
      <div className="w-full rounded-2xl border border-border bg-card p-4 flex items-center justify-around min-h-[120px]">
        <div className="text-center">
          <div className={`text-6xl transition-all duration-300 ${animating ? "scale-110" : "scale-100"}`}>
            {lastOutcome ? EMOJIS[playerHistory[playerHistory.length - 1]] : "❓"}
          </div>
          <p className="text-xs text-muted-foreground mt-1">You</p>
        </div>
        <div className="flex flex-col items-center">
          <span className="text-2xl font-black text-muted-foreground">VS</span>
          {lastOutcome && (
            <span className={`font-bold text-sm mt-1 ${outcomeColor[lastOutcome]}`}>{outcomeLabel[lastOutcome]}</span>
          )}
          {streak > 1 && <span className="text-amber-400 text-xs mt-0.5">🔥 ×{streak} streak!</span>}
        </div>
        <div className="text-center">
          <div className={`text-6xl transition-all duration-300 ${animating ? "animate-spin" : ""}`} style={{ animationDuration: "0.4s", animationIterationCount: "2" }}>
            {aiChoice ? EMOJIS[aiChoice] : "❓"}
          </div>
          <p className="text-xs text-muted-foreground mt-1">AI</p>
        </div>
      </div>

      {/* Choices */}
      {!done && (
        <div className="flex gap-4 w-full justify-center">
          {MOVES.map((m) => (
            <button key={m} type="button" onClick={() => pick(m)} disabled={animating || done}
              className="flex-1 h-20 rounded-2xl border-2 border-border bg-card text-4xl hover:border-primary/50 hover:bg-accent active:scale-90 transition-all disabled:opacity-40">
              {EMOJIS[m]}
            </button>
          ))}
        </div>
      )}

      {done && (
        <div className="text-center space-y-1">
          <p className={`text-xl font-bold ${wins > losses ? "text-emerald-400" : wins < losses ? "text-red-400" : "text-amber-400"}`}>
            {wins > losses ? "You Won! 🏆" : wins < losses ? "AI Wins!" : "It's a Draw!"}
          </p>
          <p className="text-muted-foreground text-sm">Score: {wins * 100 + streak * 20}</p>
        </div>
      )}

      {/* Round history */}
      {rounds.length > 0 && (
        <div className="flex gap-1.5 flex-wrap justify-center">
          {rounds.map((r, i) => (
            <span key={i} className={`text-xs px-2 py-0.5 rounded-full font-semibold ${r.outcome === "win" ? "bg-emerald-900/50 text-emerald-300" : r.outcome === "lose" ? "bg-red-900/50 text-red-300" : "bg-neutral-800 text-neutral-400"}`}>
              {EMOJIS[r.player]}vs{EMOJIS[r.ai]}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
