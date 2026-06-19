"use client";

/**
 * Ludo — Player (Red) vs 3 AI opponents.
 * Classic Ludo rules: roll 6 to exit home, first player to move
 * all 4 tokens to the finish wins.
 * Score = 500 if player wins, else tokens in finish × 100.
 */

import { useEffect, useState, useCallback, useRef } from "react";
import type { GameEngineProps } from "@/components/games/types";
import { useGameSound } from "@/components/games/useGameSound";

/* ─── Types ─── */
type PlayerColor = "red" | "green" | "yellow" | "blue";
interface Token {
  id: number;       // 0-3 within the player
  owner: PlayerColor;
  pos: number;      // -1 = home base, 0-51 = main track, 52-56 = home column, 57 = finished
}

/* ─── Board constants ─── */
// Main track positions (0–51), each player enters at their own start square.
// Safe squares on the main track (star squares in standard Ludo):
const SAFE_SQUARES = new Set([0, 8, 13, 21, 26, 34, 39, 47]);

// Each colour's entry square on the main track (when exiting home)
const ENTRY: Record<PlayerColor, number> = { red: 0, green: 13, yellow: 26, blue: 39 };

// Each colour's home column starts at this track position (one step before entering home column)
const HOME_ENTRY: Record<PlayerColor, number> = { red: 50, green: 11, yellow: 24, blue: 37 };
// Length of home column: 5 squares (51..55 normalised per player), then finished at 57
// We encode home column as absolute positions 52-56 (shared encoding — colour differentiates)

// Turn order
const PLAYER_ORDER: PlayerColor[] = ["red", "green", "yellow", "blue"];

const COLORS: Record<PlayerColor, { bg: string; token: string; light: string; dark: string }> = {
  red:    { bg: "bg-red-700",    token: "🔴", light: "#ef4444", dark: "#991b1b" },
  green:  { bg: "bg-green-700",  token: "🟢", light: "#22c55e", dark: "#15803d" },
  yellow: { bg: "bg-yellow-500", token: "🟡", light: "#eab308", dark: "#854d0e" },
  blue:   { bg: "bg-blue-700",   token: "🔵", light: "#3b82f6", dark: "#1d4ed8" },
};

/* Advance a token by `steps` on the main track, respecting home column. */
function advance(token: Token, steps: number): Token {
  if (token.pos === 57) return token; // already finished
  if (token.pos === -1) return token; // in home, can only exit with a 6

  const homeEntry = HOME_ENTRY[token.owner];
  let pos = token.pos;

  // How many steps until home entry on main track?
  // Home entry is when we've gone past homeEntry (mod 52) on main track.
  // After homeEntry the token goes into the home column (52-56) → 57

  // Simple approach: encode effective distance along their personal path (0..56)
  // Personal position 0 = ENTRY square, 50 = homeEntry (last main track square before column), 51-55 = column, 56 = finished
  // Convert absolute track pos to personal pos:

  const ownEntry = ENTRY[token.owner];

  // If already in home column (52-56)
  if (pos >= 52 && pos <= 56) {
    const newHomePos = pos + steps;
    if (newHomePos > 56) return token; // can't overshoot
    if (newHomePos === 56) return { ...token, pos: 57 }; // finished!
    return { ...token, pos: newHomePos };
  }

  // On main track
  // Personal distance from entry:
  const personalPos = (pos - ownEntry + 52) % 52;
  const newPersonalPos = personalPos + steps;

  if (newPersonalPos > 50) {
    // Enter home column
    const homeColPos = newPersonalPos - 51; // 0-indexed into home column → encode as 52+homeColPos
    if (homeColPos > 4) return token; // can't overshoot
    if (homeColPos === 4) return { ...token, pos: 57 }; // wait, 0-4 is 5 squares, finishing at 4
    return { ...token, pos: 52 + homeColPos };
  }

  // Still on main track
  const newAbsPos = (ownEntry + newPersonalPos) % 52;
  return { ...token, pos: newAbsPos };
}

function canMove(token: Token, dice: number): boolean {
  if (token.pos === 57) return false;
  if (token.pos === -1) return dice === 6;
  // In home column
  if (token.pos >= 52 && token.pos <= 56) {
    return (token.pos + dice) <= 56;
  }
  // On main track — check home column overshoot
  const ownEntry = ENTRY[token.owner];
  const personalPos = (token.pos - ownEntry + 52) % 52;
  const newPP = personalPos + dice;
  if (newPP > 50) {
    const homeColPos = newPP - 51;
    return homeColPos <= 4;
  }
  return true;
}

function exitHome(token: Token, color: PlayerColor): Token {
  return { ...token, pos: ENTRY[color] };
}

function isSafe(token: Token): boolean {
  if (token.pos === -1 || token.pos >= 52) return true; // home base or home column
  return SAFE_SQUARES.has(token.pos);
}

function tokensAt(tokens: Token[], pos: number, color: PlayerColor): Token[] {
  return tokens.filter(t => t.owner === color && t.pos === pos);
}

/* ─── AI move logic ─── */
function aiChooseMove(tokens: Token[], color: PlayerColor, dice: number, allTokens: Token[]): number | null {
  const movable = tokens.filter(t => t.owner === color && canMove(t, dice));
  if (!movable.length) return null;

  // Priority: 1) capture opponent, 2) advance piece in home column, 3) exit home, 4) advance furthest piece
  for (const t of movable) {
    if (t.pos === -1) continue; // handle exits separately
    const after = advance(t, dice);
    if (after.pos >= 52 || after.pos === 57) continue; // in home column safe, check captures on main track
    if (!isSafe(after)) {
      // Check if any opponent is on that square
      const oppCapture = allTokens.some(ot =>
        ot.owner !== color && ot.pos === after.pos && ot.pos >= 0 && ot.pos < 52
      );
      if (oppCapture) return t.id;
    }
  }

  // Prefer home column pieces
  const homeCol = movable.find(t => t.pos >= 52);
  if (homeCol) return homeCol.id;

  // Exit home if possible
  if (dice === 6) {
    const homeToken = movable.find(t => t.pos === -1);
    if (homeToken) return homeToken.id;
  }

  // Advance the piece closest to finishing
  const mainTrack = movable.filter(t => t.pos >= 0 && t.pos < 52);
  if (mainTrack.length) {
    const ownEntry = ENTRY[color];
    const furthest = mainTrack.reduce((best, t) => {
      const bPP = (best.pos - ownEntry + 52) % 52;
      const tPP = (t.pos - ownEntry + 52) % 52;
      return tPP > bPP ? t : best;
    });
    return furthest.id;
  }

  return movable[0].id;
}

/* ─── Component ─── */
export default function LudoGame({ onReady, onGameOver, onScore, difficulty = "medium", paused, soundEnabled = true }: GameEngineProps) {
  const play = useGameSound(soundEnabled ?? true);
  const pausedRef = useRef(paused);

  // AI aggressiveness
  const aiAggro = difficulty === "hard" ? 0.9 : difficulty === "easy" ? 0.3 : 0.6;

  const initTokens = (): Token[] => {
    const tokens: Token[] = [];
    for (const color of PLAYER_ORDER) {
      for (let i = 0; i < 4; i++) tokens.push({ id: i, owner: color, pos: -1 });
    }
    return tokens;
  };

  const [tokens, setTokens] = useState<Token[]>(initTokens);
  const [currentPlayer, setCurrentPlayer] = useState<PlayerColor>("red");
  const [dice, setDice] = useState<number | null>(null);
  const [rolling, setRolling] = useState(false);
  const [phase, setPhase] = useState<"roll" | "move" | "ai" | "done">("roll");
  const [winner, setWinner] = useState<PlayerColor | null>(null);
  const [message, setMessage] = useState("Roll the dice!");
  const [consecutive6, setConsecutive6] = useState(0);
  const gameOverFiredRef = useRef(false);

  useEffect(() => { pausedRef.current = paused; }, [paused]);
  useEffect(() => { onReady?.(); }, [onReady]);

  const getPlayerTokens = useCallback((toks: Token[], color: PlayerColor) =>
    toks.filter(t => t.owner === color), []);

  const checkWinner = useCallback((toks: Token[]): PlayerColor | null => {
    for (const color of PLAYER_ORDER) {
      if (toks.filter(t => t.owner === color && t.pos === 57).length === 4) return color;
    }
    return null;
  }, []);

  const calcScore = useCallback((toks: Token[], w: PlayerColor | null) => {
    if (w === "red") return 500;
    const finished = toks.filter(t => t.owner === "red" && t.pos === 57).length;
    const onBoard = toks.filter(t => t.owner === "red" && t.pos !== -1 && t.pos !== 57).length;
    return finished * 100 + onBoard * 20;
  }, []);

  const nextTurn = useCallback((toks: Token[], afterPlayer: PlayerColor, rolled6: boolean, consec6: number) => {
    const w = checkWinner(toks);
    if (w) {
      setWinner(w);
      setPhase("done");
      if (!gameOverFiredRef.current) {
        gameOverFiredRef.current = true;
        onGameOver(calcScore(toks, w));
      }
      return;
    }
    // Roll again on 6, unless 3 consecutive
    if (rolled6 && consec6 < 3) {
      setCurrentPlayer(afterPlayer);
      setDice(null);
      setPhase("roll");
      setMessage(afterPlayer === "red" ? "You rolled 6 — roll again!" : `${afterPlayer} rolled 6 — extra turn`);
      return;
    }
    const idx = PLAYER_ORDER.indexOf(afterPlayer);
    const next = PLAYER_ORDER[(idx + 1) % 4];
    setCurrentPlayer(next);
    setDice(null);
    setConsecutive6(0);
    setPhase("roll");
    if (next === "red") {
      setMessage("Your turn! Roll the dice.");
    } else {
      setMessage(`${next}'s turn…`);
    }
  }, [checkWinner, calcScore, onGameOver]);

  // AI turn effect
  useEffect(() => {
    if (phase !== "ai" || currentPlayer === "red" || pausedRef.current) return;
    const timer = setTimeout(() => {
      setTokens(prev => {
        const myTokens = getPlayerTokens(prev, currentPlayer);
        const d = dice!;
        let tokenId: number | null;

        // Aggro: sometimes pick random instead of optimal
        if (Math.random() > aiAggro) {
          const movable = myTokens.filter(t => canMove(t, d));
          tokenId = movable.length ? movable[Math.floor(Math.random() * movable.length)].id : null;
        } else {
          tokenId = aiChooseMove(myTokens, currentPlayer, d, prev);
        }

        if (tokenId === null) {
          // No moves — pass turn
          setTimeout(() => nextTurn(prev, currentPlayer, d === 6, consecutive6), 300);
          return prev;
        }

        const tokenIdx = prev.findIndex(t => t.owner === currentPlayer && t.id === tokenId);
        if (tokenIdx === -1) {
          setTimeout(() => nextTurn(prev, currentPlayer, d === 6, consecutive6), 300);
          return prev;
        }

        const token = prev[tokenIdx];
        let updated = { ...token };

        if (token.pos === -1 && d === 6) {
          updated = exitHome(token, currentPlayer);
          play("click");
        } else {
          const after = advance(token, d);
          // Check capture
          const captured = prev.filter(t => t.owner !== currentPlayer && t.pos === after.pos && t.pos >= 0 && t.pos < 52 && !isSafe(t));
          if (captured.length) {
            play("match");
            const newTokens = prev.map(t => {
              if (captured.some(c => c.owner === t.owner && c.id === t.id)) return { ...t, pos: -1 };
              if (t.owner === currentPlayer && t.id === tokenId) return after;
              return t;
            });
            setTimeout(() => nextTurn(newTokens, currentPlayer, d === 6, d === 6 ? consecutive6 + 1 : 0), 600);
            setTokens(newTokens);
            return newTokens;
          }
          updated = after;
          play("move");
        }

        const newTokens = prev.map(t =>
          t.owner === currentPlayer && t.id === tokenId ? updated : t
        );
        const score = calcScore(newTokens, null);
        onScore?.(score);
        setTimeout(() => nextTurn(newTokens, currentPlayer, d === 6, d === 6 ? consecutive6 + 1 : 0), 600);
        return newTokens;
      });
    }, 800);
    return () => clearTimeout(timer);
  }, [phase, currentPlayer, dice, aiAggro, consecutive6, getPlayerTokens, nextTurn, calcScore, onScore, play]);

  const rollDice = useCallback(() => {
    if (pausedRef.current || rolling || phase !== "roll") return;
    setRolling(true);
    play("tap");
    // Animate roll
    let count = 0;
    const interval = setInterval(() => {
      setDice(Math.floor(Math.random() * 6) + 1);
      count++;
      if (count >= 8) {
        clearInterval(interval);
        const final = Math.floor(Math.random() * 6) + 1;
        setDice(final);
        setRolling(false);
        setConsecutive6(prev => final === 6 ? prev + 1 : 0);
        // 3 consecutive 6s = forfeit turn
        if (final === 6 && consecutive6 >= 2) {
          setMessage("Three 6s! Forfeited turn.");
          setTimeout(() => {
            const idx = PLAYER_ORDER.indexOf(currentPlayer);
            const next = PLAYER_ORDER[(idx + 1) % 4];
            setCurrentPlayer(next);
            setDice(null);
            setConsecutive6(0);
            setPhase("roll");
            setMessage(next === "red" ? "Your turn! Roll the dice." : `${next}'s turn…`);
          }, 1000);
          return;
        }
        // Check if any moves available
        const movable = tokens.filter(t => t.owner === currentPlayer && canMove(t, final));
        if (!movable.length) {
          setMessage(currentPlayer === "red" ? "No moves available!" : `${currentPlayer} has no moves`);
          setTimeout(() => nextTurn(tokens, currentPlayer, final === 6, final === 6 ? consecutive6 + 1 : 0), 800);
        } else {
          if (currentPlayer === "red") {
            setPhase("move");
            setMessage(`You rolled ${final}! Click a token to move.`);
          } else {
            setPhase("ai");
            setMessage(`${currentPlayer} rolled ${final}…`);
          }
        }
      }
    }, 80);
  }, [rolling, phase, currentPlayer, tokens, consecutive6, nextTurn, play]);

  const handleTokenClick = useCallback((token: Token) => {
    if (phase !== "move" || token.owner !== "red" || pausedRef.current) return;
    if (!dice || !canMove(token, dice)) return;

    setTokens(prev => {
      let updated: Token;
      if (token.pos === -1 && dice === 6) {
        updated = exitHome(token, "red");
        play("click");
      } else {
        const after = advance(token, dice);
        // Check capture
        const captured = prev.filter(t =>
          t.owner !== "red" && t.pos === after.pos && t.pos >= 0 && t.pos < 52 && !isSafe(t)
        );
        if (captured.length) {
          play("match");
          const newTokens = prev.map(t => {
            if (captured.some(c => c.owner === t.owner && c.id === t.id)) return { ...t, pos: -1 };
            if (t.owner === "red" && t.id === token.id) return after;
            return t;
          });
          const score = calcScore(newTokens, null);
          onScore?.(score);
          setMessage(`Captured ${captured[0].owner}'s token! 🎉`);
          setTimeout(() => nextTurn(newTokens, "red", dice === 6, dice === 6 ? consecutive6 + 1 : 0), 600);
          setTokens(newTokens);
          return newTokens;
        }
        updated = after;
        play("move");
      }
      const newTokens = prev.map(t => t.owner === "red" && t.id === token.id ? updated : t);
      const score = calcScore(newTokens, null);
      onScore?.(score);
      setTimeout(() => nextTurn(newTokens, "red", dice === 6, dice === 6 ? consecutive6 + 1 : 0), 400);
      return newTokens;
    });
  }, [phase, dice, consecutive6, calcScore, onScore, nextTurn, play]);

  /* ─── Visual board layout ─── */
  // We draw a simplified ludo grid: 4 home bases + track indicators
  // For mobile: use a compact symbolic view with track positions shown as dots

  const myTokens = tokens.filter(t => t.owner === "red");
  const movableIds = phase === "move" && dice
    ? myTokens.filter(t => canMove(t, dice)).map(t => t.id)
    : [];

  const finishedCount = (color: PlayerColor) => tokens.filter(t => t.owner === color && t.pos === 57).length;
  const onBoardCount = (color: PlayerColor) => tokens.filter(t => t.owner === color && t.pos !== -1 && t.pos !== 57).length;
  const atHomeCount = (color: PlayerColor) => tokens.filter(t => t.owner === color && t.pos === -1).length;

  const dieFaces = ["", "⚀", "⚁", "⚂", "⚃", "⚄", "⚅"];

  return (
    <div className="flex flex-col items-center gap-4 select-none w-full max-w-sm mx-auto">
      {/* Status */}
      <div className="w-full rounded-xl border border-border bg-card px-4 py-2 text-center">
        <p className={`text-sm font-semibold ${winner === "red" ? "text-emerald-400" : winner ? "text-red-400" : "text-foreground"}`}>
          {winner ? (winner === "red" ? "🏆 You Win!" : `${winner.charAt(0).toUpperCase() + winner.slice(1)} wins!`) : message}
        </p>
      </div>

      {/* Player panels */}
      <div className="grid grid-cols-2 gap-2 w-full">
        {PLAYER_ORDER.map(color => {
          const cfg = COLORS[color];
          const isActive = currentPlayer === color && phase !== "done";
          return (
            <div key={color} className={`rounded-xl border p-2 transition-all ${isActive ? "border-white/50 shadow-lg scale-[1.02]" : "border-border"} ${cfg.bg} bg-opacity-20`}>
              <div className="flex items-center gap-1 mb-1">
                <span className="text-xs font-bold" style={{ color: cfg.light }}>
                  {color === "red" ? "You (Red)" : color.charAt(0).toUpperCase() + color.slice(1)}
                  {isActive && " ●"}
                </span>
              </div>
              <div className="flex gap-1 flex-wrap">
                {/* Home tokens */}
                {Array.from({ length: atHomeCount(color) }).map((_, i) => (
                  <span key={`h${i}`} className="text-lg opacity-50">{cfg.token}</span>
                ))}
                {/* On-board tokens */}
                {tokens.filter(t => t.owner === color && t.pos !== -1 && t.pos !== 57).map(t => {
                  const isMovable = color === "red" && movableIds.includes(t.id);
                  return (
                    <button key={t.id} type="button"
                      onClick={() => handleTokenClick(t)}
                      className={`text-lg transition-transform ${isMovable ? "scale-125 animate-bounce cursor-pointer" : "cursor-default"}`}
                      disabled={!isMovable}>
                      {cfg.token}
                    </button>
                  );
                })}
                {/* Finished tokens */}
                {Array.from({ length: finishedCount(color) }).map((_, i) => (
                  <span key={`f${i}`} className="text-lg">⭐</span>
                ))}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {finishedCount(color)}/4 done · {onBoardCount(color)} moving
              </p>
            </div>
          );
        })}
      </div>

      {/* Track display (progress bars) */}
      <div className="w-full rounded-xl border border-border bg-card p-3 space-y-2">
        <p className="text-xs text-muted-foreground text-center mb-1">Progress</p>
        {PLAYER_ORDER.map(color => {
          const cfg = COLORS[color];
          const finished = finishedCount(color);
          const pct = (finished / 4) * 100;
          return (
            <div key={color} className="flex items-center gap-2">
              <span className="text-sm w-4">{cfg.token}</span>
              <div className="flex-1 h-2 bg-neutral-800 rounded-full overflow-hidden">
                <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: cfg.light }} />
              </div>
              <span className="text-xs text-muted-foreground w-6">{finished}/4</span>
            </div>
          );
        })}
      </div>

      {/* Dice + Roll button */}
      {phase !== "done" && (
        <div className="flex items-center gap-4">
          <div className={`text-6xl transition-all duration-100 ${rolling ? "animate-spin" : ""}`}>
            {dice ? dieFaces[dice] : "🎲"}
          </div>
          {currentPlayer === "red" && phase === "roll" && (
            <button type="button" onClick={rollDice} disabled={rolling}
              className="px-6 py-3 rounded-xl bg-primary text-primary-foreground font-bold text-lg disabled:opacity-50 hover:opacity-90 active:scale-95 transition-transform">
              {rolling ? "Rolling…" : "Roll"}
            </button>
          )}
          {currentPlayer !== "red" && (
            <div className="text-muted-foreground text-sm animate-pulse">AI thinking…</div>
          )}
        </div>
      )}

      {/* Move instructions */}
      {currentPlayer === "red" && phase === "move" && movableIds.length > 0 && (
        <p className="text-xs text-amber-400 animate-pulse">Tap a bouncing token to move it {dice} step{dice !== 1 ? "s" : ""}</p>
      )}

      {/* Home base tokens (clickable if movable) */}
      {currentPlayer === "red" && phase === "move" && dice === 6 && atHomeCount("red") > 0 && (
        <div className="flex items-center gap-3">
          <p className="text-xs text-muted-foreground">Home:</p>
          {tokens.filter(t => t.owner === "red" && t.pos === -1).map(t => (
            <button key={t.id} type="button" onClick={() => handleTokenClick(t)}
              className="text-2xl animate-bounce cursor-pointer">
              🔴
            </button>
          ))}
          <p className="text-xs text-amber-400">Tap to bring out!</p>
        </div>
      )}

      {phase === "done" && (
        <div className="text-center space-y-1 py-2">
          <p className="text-muted-foreground text-sm">Final score: {calcScore(tokens, winner)}</p>
        </div>
      )}
    </div>
  );
}
