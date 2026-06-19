"use client";

/**
 * components/games/useGameSound.ts
 *
 * Lightweight Web Audio API sound effects for games. Uses synthetic tones
 * so no external files are needed. All sounds are subdued and brief.
 * Returns a play(event) function that is a no-op when soundEnabled=false.
 */

import { useCallback, useRef } from "react";

export type SoundEvent =
  | "score"
  | "win"
  | "lose"
  | "tap"
  | "flip"
  | "match"
  | "miss"
  | "levelUp"
  | "click"
  | "pop"
  | "drop"
  | "move"
  | "card";

interface SoundDef {
  freq: number;
  freq2?: number;
  duration: number;
  type: OscillatorType;
  gain: number;
}

const SOUNDS: Record<SoundEvent, SoundDef> = {
  tap:     { freq: 880,  duration: 0.05, type: "sine",    gain: 0.12 },
  click:   { freq: 660,  duration: 0.04, type: "sine",    gain: 0.10 },
  pop:     { freq: 1046, duration: 0.06, type: "sine",    gain: 0.12 },
  flip:    { freq: 523,  duration: 0.08, type: "triangle",gain: 0.10 },
  move:    { freq: 440,  duration: 0.04, type: "sine",    gain: 0.08 },
  drop:    { freq: 220,  duration: 0.10, type: "triangle",gain: 0.15 },
  card:    { freq: 698,  duration: 0.07, type: "triangle",gain: 0.10 },
  score:   { freq: 784,  freq2: 1047, duration: 0.12, type: "sine",    gain: 0.15 },
  match:   { freq: 880,  freq2: 1175, duration: 0.15, type: "sine",    gain: 0.15 },
  miss:    { freq: 200,  duration: 0.12, type: "sawtooth", gain: 0.08 },
  levelUp: { freq: 523,  freq2: 784,  duration: 0.25, type: "sine",    gain: 0.18 },
  win:     { freq: 659,  freq2: 1047, duration: 0.35, type: "sine",    gain: 0.20 },
  lose:    { freq: 330,  freq2: 220,  duration: 0.30, type: "sawtooth",gain: 0.12 },
};

export function useGameSound(soundEnabled: boolean, volume = 0.5) {
  const ctxRef = useRef<AudioContext | null>(null);

  const getCtx = useCallback((): AudioContext | null => {
    if (typeof window === "undefined") return null;
    if (!ctxRef.current) {
      try {
        ctxRef.current = new AudioContext();
      } catch {
        return null;
      }
    }
    return ctxRef.current;
  }, []);

  const play = useCallback(
    (event: SoundEvent) => {
      if (!soundEnabled) return;
      const ctx = getCtx();
      if (!ctx) return;

      const def = SOUNDS[event];
      const now = ctx.currentTime;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(def.gain * volume, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + def.duration + 0.05);
      gain.connect(ctx.destination);

      const osc = ctx.createOscillator();
      osc.type = def.type;
      osc.frequency.setValueAtTime(def.freq, now);
      if (def.freq2) {
        osc.frequency.linearRampToValueAtTime(def.freq2, now + def.duration);
      }
      osc.connect(gain);
      osc.start(now);
      osc.stop(now + def.duration + 0.1);
    },
    [soundEnabled, volume, getCtx]
  );

  return play;
}
