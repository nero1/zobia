"use client";

/**
 * components/celebrations/LevelUpCelebration.tsx
 *
 * Full-screen "Level Up!" celebration: confetti, a scale-in rank card, and a
 * short synthetic fanfare (Web Audio — no audio file asset needed, consistent
 * with components/games/useGameSound.ts's approach elsewhere in the app).
 *
 * Fired from FloatingNotificationProvider when a `reward_earned` realtime
 * event of type "rank_up" arrives (see lib/xp/safeAwardXP.ts, the actual
 * production XP-award path, for where that event is published). Also used
 * standalone by the admin preview page (/gate44/level-up-demo).
 */

import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { ConfettiCanvas } from "@/components/ui/ConfettiCanvas";

/** Small rank -> color map for the celebration card ring, mirrors
 *  components/shared/UserBadges.tsx's RANK_COLORS (not exported there). */
const RANK_COLORS: Record<string, string> = {
  "Beginner": "#9CA3AF",
  "Rookie": "#22C55E",
  "Hustler": "#0EA5E9",
  "Baller": "#3B82F6",
  "Boss": "#14B8A6",
  "Legend": "#EAB308",
  "Titan": "#F59E0B",
  "Goat": "#F97316",
  "Icon": "#EF4444",
  "Zobia Icon": "#D4AF37",
};

const AUTO_DISMISS_MS = 4500;

/** Short ascending fanfare — best-effort; browsers may block audio without a
 *  prior user gesture on this page load, which is fine, it just stays silent. */
function playLevelUpChime(): void {
  try {
    const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const notes = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
    const noteDuration = 0.14;
    notes.forEach((freq, i) => {
      const start = ctx.currentTime + i * noteDuration * 0.85;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.001, start);
      gain.gain.exponentialRampToValueAtTime(0.2, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, start + noteDuration);
      gain.connect(ctx.destination);

      const osc = ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(freq, start);
      osc.connect(gain);
      osc.start(start);
      osc.stop(start + noteDuration + 0.05);
    });
    setTimeout(() => ctx.close().catch(() => {}), (notes.length * noteDuration * 0.85 + 0.3) * 1000);
  } catch {
    // Web Audio unavailable or blocked — silent celebration is fine.
  }
}

export interface LevelUpCelebrationData {
  rankTo: string;
  sublevelTo?: number | null;
  rankFrom?: string | null;
}

interface Props {
  data: LevelUpCelebrationData;
  onDone: () => void;
}

export function LevelUpCelebration({ data, onDone }: Props) {
  const { t } = useTranslation();
  const dismissedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dismiss = () => {
    if (dismissedRef.current) return;
    dismissedRef.current = true;
    if (timerRef.current) clearTimeout(timerRef.current);
    onDone();
  };

  useEffect(() => {
    playLevelUpChime();
    timerRef.current = setTimeout(dismiss, AUTO_DISMISS_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ringColor = RANK_COLORS[data.rankTo] ?? "#3B82F6";

  return (
    <>
      <ConfettiCanvas onDone={() => { /* keep celebration up for its own timer */ }} />
      <div
        className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm"
        role="dialog"
        aria-modal="true"
        aria-label="Level up celebration"
        onClick={dismiss}
      >
        <div
          className="mx-4 flex flex-col items-center rounded-3xl bg-white px-8 py-10 text-center shadow-2xl dark:bg-neutral-900"
          style={{ animation: "zobia-levelup-pop 0.5s cubic-bezier(0.34,1.56,0.64,1)" }}
        >
          <div
            className="mb-4 flex h-24 w-24 items-center justify-center rounded-full text-5xl"
            style={{ backgroundColor: `${ringColor}22`, boxShadow: `0 0 0 4px ${ringColor}` }}
          >
            🎉
          </div>
          <p className="text-sm font-semibold uppercase tracking-widest text-neutral-400">{t("levelUp.title")}</p>
          <h2 className="mt-1 text-3xl font-black text-neutral-900 dark:text-neutral-50">
            {data.rankTo}
            {typeof data.sublevelTo === "number" && data.sublevelTo > 0 ? ` ${data.sublevelTo}` : ""}
          </h2>
          {data.rankFrom && data.rankFrom !== data.rankTo && (
            <p className="mt-1 text-sm text-neutral-500">{t("levelUp.upFrom", { rank: data.rankFrom })}</p>
          )}
          <button
            type="button"
            onClick={dismiss}
            className="mt-6 rounded-xl px-6 py-2.5 text-sm font-semibold text-white transition-colors"
            style={{ backgroundColor: ringColor }}
          >
            {t("levelUp.cta")}
          </button>
        </div>
      </div>
      <style>{`
        @keyframes zobia-levelup-pop {
          0% { opacity: 0; transform: scale(0.6); }
          100% { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </>
  );
}
