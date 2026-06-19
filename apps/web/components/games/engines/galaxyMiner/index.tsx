"use client";

/**
 * Galaxy Miner — tap asteroids to mine minerals; buy drone upgrades that mine
 * passively. Score = total minerals mined.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import type { GameEngineProps } from "@/components/games/types";
import { useGameSound } from "@/components/games/useGameSound";

interface DroneUpgrade { id: string; name: string; emoji: string; mps: number; baseCost: number; count: number }
const BASE_DRONES: Omit<DroneUpgrade, "count">[] = [
  { id: "probe",    name: "Mining Probe",  emoji: "🛸", mps: 0.2,  baseCost: 20 },
  { id: "drone",    name: "Ore Drone",     emoji: "🤖", mps: 1,    baseCost: 150 },
  { id: "rig",      name: "Laser Rig",     emoji: "⚡", mps: 8,    baseCost: 700 },
  { id: "fleet",    name: "Mining Fleet",  emoji: "🚀", mps: 40,   baseCost: 3000 },
  { id: "warp",     name: "Warp Extractor",emoji: "🌀", mps: 150,  baseCost: 12000 },
];
const CLICK_MULT: Record<string, number> = { easy: 3, medium: 2, hard: 1 };
const ASTEROID_EMOJIS = ["☄️","🪨","⛏️","🌑","🌒"];

function cost(u: DroneUpgrade) { return Math.ceil(u.baseCost * Math.pow(1.15, u.count)); }
const fmt = (n: number) => n >= 1e9 ? `${(n/1e9).toFixed(2)}B` : n >= 1e6 ? `${(n/1e6).toFixed(2)}M` : n >= 1000 ? `${(n/1000).toFixed(1)}K` : String(Math.floor(n));
let fid = 0;

export default function GalaxyMinerGame({ onReady, onGameOver, onScore, difficulty = "medium", paused, soundEnabled = true }: GameEngineProps) {
  const [minerals, setMinerals] = useState(0);
  const [total, setTotal] = useState(0);
  const [drones, setDrones] = useState<DroneUpgrade[]>(BASE_DRONES.map((d) => ({ ...d, count: 0 })));
  const [floats, setFloats] = useState<{ id: number; val: string }[]>([]);
  const [asteroid, setAsteroid] = useState(0);
  const mineralsRef = useRef(0);
  const totalRef = useRef(0);
  const dronesRef = useRef(drones);
  const clickMult = CLICK_MULT[difficulty] ?? 2;
  const play = useGameSound(soundEnabled ?? true);

  useEffect(() => { dronesRef.current = drones; }, [drones]);
  useEffect(() => { onReady?.(); }, [onReady]);

  useEffect(() => {
    const id = setInterval(() => {
      if (paused) return;
      const mps = dronesRef.current.reduce((s, d) => s + d.mps * d.count, 0);
      if (mps <= 0) return;
      const gained = mps / 20;
      mineralsRef.current += gained;
      totalRef.current += gained;
      setMinerals(Math.floor(mineralsRef.current));
      setTotal(Math.floor(totalRef.current));
      onScore?.(Math.floor(totalRef.current));
    }, 50);
    return () => clearInterval(id);
  }, [paused, onScore]);

  const mine = useCallback(() => {
    if (paused) return;
    const gained = clickMult;
    mineralsRef.current += gained;
    totalRef.current += gained;
    setMinerals(Math.floor(mineralsRef.current));
    setTotal(Math.floor(totalRef.current));
    onScore?.(Math.floor(totalRef.current));
    setAsteroid((a) => (a + 1) % ASTEROID_EMOJIS.length);
    play("tap");
    const id = fid++;
    setFloats((f) => [...f.slice(-8), { id, val: `+${gained} ⛏️` }]);
    setTimeout(() => setFloats((f) => f.filter((ft) => ft.id !== id)), 800);
  }, [paused, clickMult, onScore, play]);

  const buyDrone = useCallback((idx: number) => {
    if (paused) return;
    const d = dronesRef.current[idx];
    const c = cost(d);
    if (mineralsRef.current < c) return;
    mineralsRef.current -= c;
    setMinerals(Math.floor(mineralsRef.current));
    play("click");
    setDrones((prev) => { const next = [...prev]; next[idx] = { ...next[idx], count: next[idx].count + 1 }; return next; });
  }, [paused, play]);

  const mps = drones.reduce((s, d) => s + d.mps * d.count, 0);

  return (
    <div className="flex flex-col gap-3 w-full max-w-sm mx-auto select-none">
      <div className="text-center">
        <div className="text-3xl font-black text-cyan-400">{fmt(Math.floor(minerals))} <span className="text-lg">⛏️</span></div>
        <div className="text-xs text-muted-foreground">{mps.toFixed(1)}/sec · {fmt(totalRef.current)} mined</div>
      </div>

      <div className="flex justify-center">
        <button
          type="button"
          onClick={mine}
          className="relative text-8xl active:scale-90 transition-transform"
          aria-label="Mine asteroid"
        >
          {ASTEROID_EMOJIS[asteroid]}
          {floats.map((f) => (
            <span key={f.id} className="pointer-events-none absolute -top-6 left-1/2 -translate-x-1/2 text-cyan-300 font-bold text-sm animate-bounce" style={{ animationDuration: "0.8s", animationIterationCount: 1 }}>
              {f.val}
            </span>
          ))}
        </button>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Mining Crew</p>
        {drones.map((d, i) => {
          const c = cost(d); const can = minerals >= c;
          return (
            <button key={d.id} type="button" onClick={() => buyDrone(i)} disabled={!can}
              className={`w-full flex items-center justify-between rounded-xl px-4 py-3 border transition-colors ${can ? "border-cyan-500/40 bg-cyan-950/30 hover:bg-cyan-950/50" : "border-border bg-card opacity-50"}`}>
              <span className="flex items-center gap-2 text-sm">
                <span className="text-xl">{d.emoji}</span>
                <span className="font-medium text-foreground">{d.name}</span>
                <span className="text-xs text-muted-foreground">×{d.count}</span>
              </span>
              <span className="text-xs font-bold text-cyan-400">{fmt(c)} ⛏️</span>
            </button>
          );
        })}
      </div>

      <button type="button" onClick={() => onGameOver(Math.floor(totalRef.current))} className="text-xs text-muted-foreground hover:text-foreground underline">
        Cash out ({fmt(totalRef.current)} minerals)
      </button>
    </div>
  );
}
