"use client";

/**
 * Cookie Kingdom — idle clicker. Click the cookie to bake it; buy upgrades
 * that produce cookies automatically. Score = total cookies baked.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import type { GameEngineProps } from "@/components/games/types";
import { useGameSound } from "@/components/games/useGameSound";

interface Upgrade { id: string; name: string; emoji: string; cps: number; baseCost: number; count: number }
interface FloatText { id: number; x: number; y: number; val: string }

const BASE_UPGRADES: Omit<Upgrade, "count">[] = [
  { id: "cursor",   name: "Auto-Clicker", emoji: "🖱️",  cps: 0.1, baseCost: 15 },
  { id: "bakery",   name: "Bakery",       emoji: "🏠",  cps: 0.5, baseCost: 100 },
  { id: "factory",  name: "Factory",      emoji: "🏭",  cps: 5,   baseCost: 500 },
  { id: "lab",      name: "Cookie Lab",   emoji: "⚗️",  cps: 25,  baseCost: 2000 },
  { id: "portal",   name: "Cookie Portal",emoji: "🌀",  cps: 100, baseCost: 8000 },
];

const CLICK_MULT: Record<string, number> = { easy: 2, medium: 1, hard: 0.5 };
const MULT_NAMES = ["🍪", "✨", "🌟", "💫", "⭐"];

function cost(up: Upgrade) {
  return Math.ceil(up.baseCost * Math.pow(1.15, up.count));
}

let fid = 0;

export default function CookieKingdomGame({ onReady, onGameOver, onScore, difficulty = "medium", paused, soundEnabled = true }: GameEngineProps) {
  const [cookies, setCookies] = useState(0);
  const [totalCookies, setTotalCookies] = useState(0);
  const [upgrades, setUpgrades] = useState<Upgrade[]>(BASE_UPGRADES.map((u) => ({ ...u, count: 0 })));
  const [floats, setFloats] = useState<FloatText[]>([]);
  const [cookieScale, setCookieScale] = useState(1);
  const cookiesRef = useRef(0);
  const totalRef = useRef(0);
  const upgradesRef = useRef(upgrades);
  const clickMult = CLICK_MULT[difficulty] ?? 1;
  const play = useGameSound(soundEnabled ?? true);

  useEffect(() => { upgradesRef.current = upgrades; }, [upgrades]);
  useEffect(() => { onReady?.(); }, [onReady]);

  // Auto-production tick
  useEffect(() => {
    const id = setInterval(() => {
      if (paused) return;
      const cps = upgradesRef.current.reduce((sum, u) => sum + u.cps * u.count, 0);
      if (cps <= 0) return;
      const gained = cps / 20; // 50ms tick
      cookiesRef.current += gained;
      totalRef.current += gained;
      setCookies(Math.floor(cookiesRef.current));
      setTotalCookies(Math.floor(totalRef.current));
      onScore?.(Math.floor(totalRef.current));
    }, 50);
    return () => clearInterval(id);
  }, [paused, onScore]);

  const handleClick = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    if (paused) return;
    const gained = clickMult;
    cookiesRef.current += gained;
    totalRef.current += gained;
    setCookies(Math.floor(cookiesRef.current));
    setTotalCookies(Math.floor(totalRef.current));
    onScore?.(Math.floor(totalRef.current));
    play("pop");

    // Bounce animation
    setCookieScale(0.88);
    setTimeout(() => setCookieScale(1), 100);

    // Floating text
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const id = fid++;
    setFloats((f) => [...f.slice(-10), { id, x, y, val: `+${gained}` }]);
    setTimeout(() => setFloats((f) => f.filter((ft) => ft.id !== id)), 800);
  }, [paused, clickMult, onScore, play]);

  const buyUpgrade = useCallback((idx: number) => {
    if (paused) return;
    const up = upgradesRef.current[idx];
    const c = cost(up);
    if (cookiesRef.current < c) return;
    cookiesRef.current -= c;
    setCookies(Math.floor(cookiesRef.current));
    play("click");
    setUpgrades((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], count: next[idx].count + 1 };
      return next;
    });
  }, [paused, play]);

  const cps = upgrades.reduce((sum, u) => sum + u.cps * u.count, 0);
  const fmt = (n: number) => n >= 1e9 ? `${(n/1e9).toFixed(2)}B` : n >= 1e6 ? `${(n/1e6).toFixed(2)}M` : n >= 1000 ? `${(n/1000).toFixed(1)}K` : String(Math.floor(n));

  return (
    <div className="flex flex-col gap-3 w-full max-w-sm mx-auto select-none">
      {/* Stats */}
      <div className="text-center">
        <div className="text-3xl font-black text-amber-400">{fmt(Math.floor(cookies))} <span className="text-lg">🍪</span></div>
        <div className="text-xs text-muted-foreground">{cps.toFixed(1)} per second · {fmt(totalRef.current)} total</div>
      </div>

      {/* Big cookie */}
      <div className="flex justify-center">
        <button
          type="button"
          onClick={handleClick}
          className="relative text-8xl active:scale-90 transition-transform duration-75"
          style={{ transform: `scale(${cookieScale})`, transition: "transform 0.1s" }}
          aria-label="Click to bake"
        >
          🍪
          {floats.map((f) => (
            <span
              key={f.id}
              className="pointer-events-none absolute text-amber-300 font-bold text-lg animate-bounce"
              style={{ left: f.x, top: f.y, animationDuration: "0.8s", animationIterationCount: 1 }}
            >
              {f.val}
            </span>
          ))}
        </button>
      </div>

      {/* Upgrades */}
      <div className="space-y-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Upgrades</p>
        {upgrades.map((up, i) => {
          const c = cost(up);
          const canAfford = cookies >= c;
          return (
            <button
              key={up.id}
              type="button"
              onClick={() => buyUpgrade(i)}
              disabled={!canAfford}
              className={`w-full flex items-center justify-between rounded-xl px-4 py-3 border transition-colors ${canAfford ? "border-amber-500/40 bg-amber-950/30 hover:bg-amber-950/50" : "border-neutral-700 bg-card opacity-50"}`}
            >
              <span className="flex items-center gap-2 text-sm">
                <span className="text-xl">{up.emoji}</span>
                <span className="font-medium text-foreground">{up.name}</span>
                <span className="text-xs text-muted-foreground">×{up.count}</span>
              </span>
              <span className="text-xs font-bold text-amber-400">{fmt(c)} 🍪</span>
            </button>
          );
        })}
      </div>

      <button
        type="button"
        onClick={() => onGameOver(Math.floor(totalRef.current))}
        className="mt-2 text-xs text-muted-foreground hover:text-foreground underline"
      >
        Cash out ({fmt(totalRef.current)} total cookies)
      </button>
    </div>
  );
}
