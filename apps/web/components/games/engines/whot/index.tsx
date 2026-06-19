"use client";

/**
 * Whot! — popular West African card game vs AI.
 * Suits: Circle, Triangle, Cross, Square, Star. Special cards: 1 (Whot), 2 (Pick Two), 5 (Pick Three), 8 (Suspension), 14 (General Market).
 * Score = points remaining in AI's hand when player empties theirs.
 */

import { useEffect, useState, useCallback, useRef } from "react";
import type { GameEngineProps } from "@/components/games/types";
import { useGameSound } from "@/components/games/useGameSound";

type Suit = "circle" | "triangle" | "cross" | "square" | "star";
const SUITS: Suit[] = ["circle","triangle","cross","square","star"];
const SUIT_EMOJI: Record<Suit, string> = { circle: "⭕", triangle: "🔺", cross: "✚", square: "🟦", star: "⭐" };
const SUIT_COLOR: Record<Suit, string> = { circle: "#ef4444", triangle: "#f97316", cross: "#3b82f6", square: "#a855f7", star: "#eab308" };
const SPECIALS: Record<number, string> = { 1: "WHOT", 2: "Pick 2", 5: "Pick 3", 8: "Hold On", 14: "Mkt" };

interface WhotCard { suit: Suit | null; value: number; id: number }

let _cid = 0;
function mkCard(suit: Suit | null, value: number): WhotCard { return { suit, value, id: _cid++ }; }

function buildDeck(): WhotCard[] {
  const deck: WhotCard[] = [];
  for (const suit of SUITS) {
    const nums = [1,2,3,4,5,6,7,8,10,11,12,13,14];
    for (const n of nums) deck.push(mkCard(suit, n));
  }
  // Add extra Whot cards
  deck.push(mkCard(null, 20), mkCard(null, 20));
  for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]]; }
  return deck;
}

function canPlay(card: WhotCard, top: WhotCard, calledSuit: Suit | null): boolean {
  if (card.value === 20 || card.value === 1) return true; // Whot always playable
  const activeSuit = top.value === 20 || top.value === 1 ? calledSuit : top.suit;
  if (card.suit === activeSuit) return true;
  if (card.value === top.value) return true;
  return false;
}

function cardPoints(c: WhotCard): number {
  if (c.value === 20) return 20;
  if (c.value === 14) return 14;
  if (c.value === 1) return 1;
  return c.value;
}

function CardView({ card, onClick, disabled, small = false }: { card: WhotCard; onClick?: () => void; disabled?: boolean; small?: boolean }) {
  const isWhot = card.value === 20 || card.value === 1;
  const label = SPECIALS[card.value] ?? String(card.value);
  const color = card.suit ? SUIT_COLOR[card.suit] : "#94a3b8";
  const emoji = card.suit ? SUIT_EMOJI[card.suit] : "🃏";

  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className={`flex-shrink-0 rounded-xl border-2 flex flex-col items-center justify-center font-bold transition-all ${small ? "w-10 h-14 text-[10px]" : "w-14 h-20 text-xs"} ${disabled ? "opacity-50 cursor-default border-border bg-card" : "border-border bg-card hover:scale-110 hover:-translate-y-2 active:scale-95 cursor-pointer hover:border-primary/50 hover:shadow-lg"}`}
      style={{ borderColor: disabled ? undefined : color + "80" }}
    >
      <span className="text-base leading-none">{emoji}</span>
      <span className="leading-none mt-0.5 text-foreground">{label}</span>
      {isWhot && <span className="text-[8px] text-amber-400 leading-none">WHOT</span>}
    </button>
  );
}

type Phase = "player" | "ai" | "calling" | "over";

export default function WhotGame({ onReady, onGameOver, onScore, difficulty = "medium", soundEnabled = true, paused }: GameEngineProps) {
  const [deck, setDeck] = useState<WhotCard[]>([]);
  const [playerHand, setPlayerHand] = useState<WhotCard[]>([]);
  const [aiHand, setAiHand] = useState<WhotCard[]>([]);
  const [pile, setPile] = useState<WhotCard[]>([]);
  const [phase, setPhase] = useState<Phase>("player");
  const [calledSuit, setCalledSuit] = useState<Suit | null>(null);
  const [message, setMessage] = useState("Your turn!");
  const [penaltyPending, setPenaltyPending] = useState(0);
  const deckRef = useRef(deck);
  const play = useGameSound(soundEnabled ?? true);
  const pausedRef = useRef(paused);

  useEffect(() => { pausedRef.current = paused; }, [paused]);

  useEffect(() => {
    onReady?.();
    const d = buildDeck();
    const ph = d.splice(0, 7);
    const ah = d.splice(0, 7);
    // Find first non-special card for starter
    let topIdx = d.findIndex((c) => c.value !== 20 && c.value !== 1 && c.value !== 2 && c.value !== 5 && c.value !== 8 && c.value !== 14);
    if (topIdx < 0) topIdx = 0;
    const [top] = d.splice(topIdx, 1);
    deckRef.current = d;
    setDeck(d);
    setPlayerHand(ph);
    setAiHand(ah);
    setPile([top]);
  }, [onReady]);

  const draw = useCallback((n: number, hand: WhotCard[]): [WhotCard[], WhotCard[]] => {
    const d = [...deckRef.current];
    const drawn: WhotCard[] = [];
    for (let i = 0; i < n; i++) {
      if (d.length === 0) break;
      drawn.push(d.pop()!);
    }
    deckRef.current = d;
    setDeck([...d]);
    return [hand.concat(drawn), drawn];
  }, []);

  // AI turn
  const aiTurn = useCallback((aiH: WhotCard[], topCard: WhotCard, cSuit: Suit | null, penalty: number) => {
    setTimeout(() => {
      if (pausedRef.current) { setTimeout(() => aiTurn(aiH, topCard, cSuit, penalty), 500); return; }

      let newAiH = [...aiH];
      let newPile = pile;
      let newDeck = [...deckRef.current];
      let msg = "";
      let newCalledSuit = cSuit;
      let nextPenalty = 0;

      // Must draw penalty if any
      if (penalty > 0) {
        const [h2] = draw(penalty, newAiH);
        newAiH = h2;
        msg = `AI picks ${penalty}. Your turn!`;
        play("card");
        setAiHand(newAiH);
        setMessage(msg);
        setPhase("player");
        setPenaltyPending(0);
        return;
      }

      // Find playable card
      const playable = newAiH.filter((c) => canPlay(c, topCard, cSuit));
      if (playable.length === 0) {
        // Draw and check
        if (newDeck.length > 0) {
          const drawn = newDeck.pop()!;
          deckRef.current = newDeck;
          setDeck([...newDeck]);
          newAiH = [...newAiH, drawn];
          if (canPlay(drawn, topCard, cSuit)) playable.push(drawn);
          else {
            setAiHand(newAiH);
            setMessage("AI draws. Your turn!");
            setPhase("player");
            return;
          }
        } else {
          setMessage("AI passes. Your turn!");
          setPhase("player");
          return;
        }
      }

      // Prefer special cards on hard
      const chosen = difficulty === "hard"
        ? (playable.find((c) => c.value === 2 || c.value === 5 || c.value === 14) ?? playable[0])
        : playable[Math.floor(Math.random() * playable.length)];

      newAiH = newAiH.filter((c) => c.id !== chosen.id);

      if (chosen.value === 2) { nextPenalty = 2; msg = "AI plays Pick 2! Pick 2 cards!"; }
      else if (chosen.value === 5) { nextPenalty = 3; msg = "AI plays Pick 3! Pick 3 cards!"; }
      else if (chosen.value === 14) { nextPenalty = newAiH.length; msg = "AI: General Market! Everyone picks!"; }
      else if (chosen.value === 8) { msg = "AI: Suspension! You're skipped!"; }
      else if (chosen.value === 20 || chosen.value === 1) {
        const suits: Suit[] = ["circle","triangle","cross","square","star"];
        // AI calls the suit it has most of
        const counts: Partial<Record<Suit, number>> = {};
        for (const c of newAiH) if (c.suit) counts[c.suit] = (counts[c.suit] ?? 0) + 1;
        const called = (Object.entries(counts).sort((a,b)=>b[1]-a[1])[0]?.[0] as Suit) ?? suits[Math.floor(Math.random()*5)];
        newCalledSuit = called;
        msg = `AI calls ${SUIT_EMOJI[called]}! Your turn!`;
      }

      play("card");
      newPile = [...pile, chosen];
      setPile(newPile);
      setAiHand(newAiH);
      setCalledSuit(chosen.suit ? null : newCalledSuit);

      if (newAiH.length === 0) {
        const pts = playerHand.reduce((s,c) => s + cardPoints(c), 0);
        setMessage(`AI wins! 😔 AI emptied hand first.`);
        setPhase("over");
        onGameOver(0);
        return;
      }

      if (chosen.value === 8) {
        // Skip player: AI goes again
        msg += " AI plays again!";
        setMessage(msg);
        setTimeout(() => aiTurn(newAiH, chosen, newCalledSuit, 0), 1000);
        return;
      }

      setPenaltyPending(nextPenalty);
      setMessage(msg || "Your turn!");
      setPhase("player");
    }, 900);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pile, playerHand, difficulty, draw, onGameOver, play]);

  const playCard = useCallback((card: WhotCard) => {
    if (pausedRef.current || phase !== "player") return;
    const top = pile[pile.length - 1];
    if (!top) return;

    if (penaltyPending > 0) {
      // Player must draw penalty instead of playing
      if (card.value !== 2 && card.value !== 5) {
        const [newHand] = draw(penaltyPending, playerHand);
        setPlayerHand(newHand);
        setMessage(`You pick ${penaltyPending}. AI's turn!`);
        setPenaltyPending(0);
        play("miss");
        setPhase("ai");
        aiTurn(aiHand, top, calledSuit, 0);
        return;
      }
    }

    if (!canPlay(card, top, calledSuit)) { play("miss"); return; }

    play("card");
    const newPlayerHand = playerHand.filter((c) => c.id !== card.id);
    const newPile = [...pile, card];
    setPile(newPile);
    setPlayerHand(newPlayerHand);

    if (newPlayerHand.length === 0) {
      const pts = aiHand.reduce((s,c) => s + cardPoints(c), 0);
      setMessage(`You win! 🎉 AI had ${pts} points.`);
      setPhase("over");
      play("win");
      onScore?.(pts);
      onGameOver(pts);
      return;
    }

    if (card.value === 20 || card.value === 1) {
      setPhase("calling");
      return;
    }

    let penalty = 0;
    let msg = "AI's turn!";
    if (card.value === 2) { penalty = 2; msg = "Pick 2 on AI!"; }
    else if (card.value === 5) { penalty = 3; msg = "Pick 3 on AI!"; }
    else if (card.value === 14) { penalty = aiHand.length; msg = "General Market! AI picks!"; }
    else if (card.value === 8) {
      // AI is suspended — player plays again
      setMessage("Hold On! Play again!");
      return;
    }

    setCalledSuit(null);
    setPenaltyPending(0);
    setMessage(msg);
    setPhase("ai");
    aiTurn(aiHand, card, null, penalty);
  }, [phase, pile, playerHand, aiHand, calledSuit, penaltyPending, draw, aiTurn, onScore, onGameOver, play]);

  const callSuit = useCallback((suit: Suit) => {
    setCalledSuit(suit);
    setPhase("ai");
    setMessage(`You called ${SUIT_EMOJI[suit]}! AI's turn!`);
    aiTurn(aiHand, pile[pile.length - 1], suit, 0);
  }, [aiHand, pile, aiTurn]);

  const drawCard = useCallback(() => {
    if (pausedRef.current || phase !== "player") return;
    if (penaltyPending > 0) {
      const [newHand] = draw(penaltyPending, playerHand);
      setPlayerHand(newHand);
      play("card");
      setPenaltyPending(0);
      const top = pile[pile.length - 1];
      setPhase("ai");
      setMessage("AI's turn!");
      aiTurn(aiHand, top, calledSuit, 0);
    } else {
      const [newHand, drawn] = draw(1, playerHand);
      setPlayerHand(newHand);
      play("card");
      const top = pile[pile.length - 1];
      if (drawn.length > 0 && canPlay(drawn[0], top, calledSuit)) {
        setMessage("You drew a playable card!");
      } else {
        setPhase("ai");
        setMessage("AI's turn!");
        aiTurn(aiHand, top, calledSuit, 0);
      }
    }
  }, [phase, playerHand, aiHand, pile, calledSuit, penaltyPending, draw, aiTurn, play]);

  const top = pile[pile.length - 1];
  const activeSuit = top?.value === 20 || top?.value === 1 ? calledSuit : top?.suit ?? null;

  return (
    <div className="flex flex-col items-center gap-3 select-none w-full max-w-sm mx-auto">
      {/* Status */}
      <div className="flex w-full items-center justify-between text-xs px-1">
        <span className="text-muted-foreground">AI: {aiHand.length} cards</span>
        <span className={`font-semibold text-sm ${phase === "player" ? "text-emerald-400" : phase === "ai" ? "text-amber-400" : phase === "over" ? "text-purple-400" : "text-blue-400"}`}>
          {message}
        </span>
        <span className="text-muted-foreground">You: {playerHand.length}</span>
      </div>

      {/* Pile */}
      <div className="flex items-center gap-3">
        <div className="text-center">
          <p className="text-xs text-muted-foreground mb-1">Top card</p>
          {top && <CardView card={top} disabled />}
          {activeSuit && top && (top.value === 20 || top.value === 1) && (
            <p className="text-xs mt-1" style={{ color: SUIT_COLOR[activeSuit] }}>{SUIT_EMOJI[activeSuit]} Called</p>
          )}
        </div>
        <button type="button" onClick={drawCard} disabled={phase !== "player" || phase === "over" as Phase}
          className="px-3 py-8 rounded-xl border-2 border-dashed border-border bg-card hover:border-primary/50 disabled:opacity-40 text-xs text-muted-foreground flex flex-col items-center gap-1">
          <span className="text-2xl">🂠</span>
          <span>{penaltyPending > 0 ? `Draw ${penaltyPending}` : "Draw"}</span>
          <span className="text-[10px]">{deck.length} left</span>
        </button>
      </div>

      {/* Suit caller */}
      {phase === "calling" && (
        <div className="w-full">
          <p className="text-sm text-center text-foreground mb-2">Call a suit:</p>
          <div className="flex gap-2 justify-center">
            {SUITS.map((s) => (
              <button key={s} type="button" onClick={() => callSuit(s)}
                className="w-12 h-12 rounded-xl border-2 border-border bg-card text-2xl hover:scale-110 transition-transform"
                style={{ borderColor: SUIT_COLOR[s] + "80" }}>
                {SUIT_EMOJI[s]}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Player hand */}
      <div className="w-full">
        <p className="text-xs text-muted-foreground mb-1">Your hand — {phase === "player" ? "tap a card to play" : "wait…"}</p>
        <div className="flex gap-1.5 overflow-x-auto pb-2 flex-wrap">
          {playerHand.map((card) => {
            const playable = phase === "player" && canPlay(card, top, calledSuit);
            return (
              <CardView key={card.id} card={card} onClick={() => playCard(card)} disabled={!playable || phase !== "player"} />
            );
          })}
        </div>
      </div>
    </div>
  );
}
