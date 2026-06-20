"use client";

/**
 * Blackjack — classic card game vs AI dealer.
 * Multiple rounds with a chip stack. Score = final chip count.
 * Starting chips vary by difficulty.
 */

import { useEffect, useState, useCallback, useRef } from "react";
import type { GameEngineProps } from "@/components/games/types";
import { useGameSound } from "@/components/games/useGameSound";

const SUITS = ["♠","♥","♦","♣"];
const VALUES = ["A","2","3","4","5","6","7","8","9","10","J","Q","K"];
interface Card { suit: string; value: string }

const START_CHIPS: Record<string, number> = { easy: 200, medium: 100, hard: 50 };
const BET_SIZES: Record<string, number[]> = { easy: [5,10,25], medium: [10,25,50], hard: [25,50,100] };

function newDeck(): Card[] {
  const deck: Card[] = [];
  for (const s of SUITS) for (const v of VALUES) deck.push({ suit: s, value: v });
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function cardVal(c: Card): number {
  if (c.value === "A") return 11;
  if (["J","Q","K"].includes(c.value)) return 10;
  return parseInt(c.value);
}

function handValue(hand: Card[]): number {
  let total = hand.reduce((s, c) => s + cardVal(c), 0);
  let aces = hand.filter((c) => c.value === "A").length;
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  return total;
}

const cardColor = (s: string) => s === "♥" || s === "♦" ? "text-red-500" : "text-foreground";

function CardDisplay({ card, hidden }: { card: Card | null; hidden?: boolean }) {
  if (hidden || !card) return (
    <div className="w-14 h-20 rounded-lg border-2 border-border bg-primary/10 flex items-center justify-center text-2xl">🂠</div>
  );
  return (
    <div className={`w-14 h-20 rounded-lg border-2 border-border bg-card flex flex-col items-center justify-center gap-0.5 ${cardColor(card.suit)}`}>
      <span className="text-lg font-black leading-none">{card.value}</span>
      <span className="text-xl leading-none">{card.suit}</span>
    </div>
  );
}

type Phase = "bet" | "playing" | "dealer" | "result";
type Result = "win" | "lose" | "push" | "blackjack" | null;

export default function BlackjackGame({ onReady, onGameOver, onScore, difficulty = "medium", paused, soundEnabled = true }: GameEngineProps) {
  const startChips = START_CHIPS[difficulty] ?? 100;
  const betSizes = BET_SIZES[difficulty] ?? [10, 25, 50];

  const [deck, setDeck] = useState<Card[]>(() => newDeck());
  const [playerHand, setPlayerHand] = useState<Card[]>([]);
  const [dealerHand, setDealerHand] = useState<Card[]>([]);
  const [chips, setChips] = useState(startChips);
  const [bet, setBet] = useState(0);
  const [phase, setPhase] = useState<Phase>("bet");
  const [result, setResult] = useState<Result>(null);
  const [message, setMessage] = useState("");
  const deckRef = useRef(deck);
  const chipsRef = useRef(chips);
  const play = useGameSound(soundEnabled ?? true);
  const pausedRef = useRef(paused);

  useEffect(() => { pausedRef.current = paused; }, [paused]);
  useEffect(() => { onReady?.(); chipsRef.current = chips; }, [onReady, chips]);

  const drawCard = useCallback((): Card => {
    const d = [...deckRef.current];
    if (d.length < 10) { const nd = newDeck(); deckRef.current = nd; setDeck(nd); return nd.pop()!; }
    const c = d.pop()!;
    deckRef.current = d;
    setDeck(d);
    return c;
  }, []);

  const dealHands = useCallback(() => {
    if (pausedRef.current || bet === 0) return;
    const p = [drawCard(), drawCard()];
    const d = [drawCard(), drawCard()];
    setPlayerHand(p);
    setDealerHand(d);
    play("card");

    const pVal = handValue(p);
    if (pVal === 21) {
      const winnings = Math.floor(bet * 1.5);
      const newChips = chips + winnings;
      setChips(newChips);
      chipsRef.current = newChips;
      setResult("blackjack");
      setMessage(`Blackjack! +${winnings} chips 🎉`);
      setPhase("result");
      play("win");
      onScore?.(newChips);
    } else {
      setPhase("playing");
    }
  }, [bet, chips, drawCard, onScore, play]);

  const hit = useCallback(() => {
    if (pausedRef.current || phase !== "playing") return;
    const card = drawCard();
    play("card");
    const newHand = [...playerHand, card];
    setPlayerHand(newHand);
    const val = handValue(newHand);
    if (val > 21) {
      const newChips = chips - bet;
      setChips(newChips);
      chipsRef.current = newChips;
      setResult("lose");
      setMessage(`Bust! -${bet} chips`);
      setPhase("result");
      play("lose");
      onScore?.(newChips);
      if (newChips <= 0) setTimeout(() => onGameOver(0), 800);
    }
  }, [phase, playerHand, chips, bet, drawCard, onScore, play, onGameOver]);

  const stand = useCallback(() => {
    if (pausedRef.current || phase !== "playing") return;
    setPhase("dealer");
    // Dealer plays
    let dHand = [...dealerHand];
    while (handValue(dHand) < 17) { dHand = [...dHand, drawCard()]; play("card"); }
    setDealerHand(dHand);

    const pVal = handValue(playerHand);
    const dVal = handValue(dHand);
    let res: Result; let msg = ""; let chipDelta = 0;

    if (dVal > 21 || pVal > dVal) { res = "win"; chipDelta = bet; msg = `You win! +${bet} chips`; play("win"); }
    else if (pVal < dVal) { res = "lose"; chipDelta = -bet; msg = `Dealer wins. -${bet} chips`; play("lose"); }
    else { res = "push"; chipDelta = 0; msg = "Push — bet returned"; play("click"); }

    const newChips = chips + chipDelta;
    setChips(newChips);
    chipsRef.current = newChips;
    setResult(res);
    setMessage(msg);
    setPhase("result");
    onScore?.(newChips);
    if (newChips <= 0) setTimeout(() => onGameOver(0), 800);
  }, [phase, playerHand, dealerHand, chips, bet, drawCard, onScore, play, onGameOver]);

  const nextRound = useCallback(() => {
    setPlayerHand([]); setDealerHand([]); setBet(0); setResult(null); setMessage(""); setPhase("bet");
  }, []);

  return (
    <div className="flex flex-col items-center gap-4 select-none w-full max-w-sm mx-auto">
      {/* Header */}
      <div className="flex w-full items-center justify-between text-sm px-1">
        <span className="text-amber-400 font-bold">🪙 {chips}</span>
        {bet > 0 && <span className="text-muted-foreground">Bet: {bet}</span>}
        <button type="button" onClick={() => onGameOver(chipsRef.current)} className="text-xs text-muted-foreground hover:text-foreground underline">Cash out</button>
      </div>

      {/* Dealer */}
      {dealerHand.length > 0 && (
        <div className="w-full">
          <p className="text-xs text-muted-foreground mb-1">Dealer {phase !== "result" ? `(??)` : `(${handValue(dealerHand)})`}</p>
          <div className="flex gap-2 flex-wrap">
            {dealerHand.map((c, i) => <CardDisplay key={i} card={c} hidden={phase === "playing" && i === 1} />)}
          </div>
        </div>
      )}

      {/* Player */}
      {playerHand.length > 0 && (
        <div className="w-full">
          <p className="text-xs text-muted-foreground mb-1">You ({handValue(playerHand)})</p>
          <div className="flex gap-2 flex-wrap">{playerHand.map((c, i) => <CardDisplay key={i} card={c} />)}</div>
        </div>
      )}

      {/* Result */}
      {result && (
        <div className={`w-full rounded-xl py-3 text-center font-bold text-sm ${result === "win" || result === "blackjack" ? "bg-emerald-900/40 text-emerald-300" : result === "lose" ? "bg-red-900/40 text-red-300" : "bg-neutral-800 text-neutral-300"}`}>
          {message}
        </div>
      )}

      {/* Actions */}
      {phase === "bet" && (
        <div className="w-full space-y-2">
          <p className="text-sm text-muted-foreground text-center">Place your bet</p>
          <div className="flex gap-2 justify-center">
            {betSizes.map((b) => (
              <button key={b} type="button" onClick={() => setBet(b)} disabled={b > chips}
                className={`px-4 py-2 rounded-lg font-bold text-sm border transition-colors ${bet === b ? "border-primary bg-primary/20 text-primary" : "border-border bg-card hover:border-primary/50"}`}>
                {b}
              </button>
            ))}
          </div>
          <button type="button" onClick={dealHands} disabled={bet === 0 || bet > chips}
            className="w-full py-3 rounded-xl bg-primary text-primary-foreground font-bold disabled:opacity-40">
            Deal
          </button>
        </div>
      )}

      {phase === "playing" && (
        <div className="flex gap-3 w-full">
          <button type="button" onClick={hit} className="flex-1 py-3 rounded-xl border-2 border-primary/50 text-primary font-bold hover:bg-primary/10">Hit</button>
          <button type="button" onClick={stand} className="flex-1 py-3 rounded-xl bg-primary text-primary-foreground font-bold hover:opacity-90">Stand</button>
        </div>
      )}

      {phase === "result" && (
        <button type="button" onClick={nextRound} className="w-full py-3 rounded-xl bg-primary text-primary-foreground font-bold">
          {chips > 0 ? "Next Round" : "Game Over"}
        </button>
      )}
    </div>
  );
}
