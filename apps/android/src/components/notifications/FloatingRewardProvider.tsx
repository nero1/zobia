/**
 * apps/android/src/components/notifications/FloatingRewardProvider.tsx
 *
 * Minimal floating reward notification system for the Capacitor app —
 * mirrors the spirit of apps/web/components/providers/FloatingNotificationProvider.tsx
 * (a global "+X Credits" / "+X XP" pop-up any feature can fire) without
 * porting its full realtime/confetti machinery, which nothing on Android
 * currently depends on. Mounted once at the app root (main.tsx) so any
 * screen can call useFloatingReward().fireReward(...).
 *
 * First consumer: routes/games/$slug/play.tsx, on a game's reward payout.
 */

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';

export interface RewardPayload {
  credits?: number;
  xp?: number;
  stars?: number;
}

interface FloatingRewardContextValue {
  fireReward: (reward: RewardPayload) => void;
}

const FloatingRewardContext = createContext<FloatingRewardContextValue>({
  fireReward: () => {},
});

interface QueuedToast extends RewardPayload {
  id: number;
}

const DISPLAY_MS = 2600;

export function FloatingRewardProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<QueuedToast[]>([]);
  const nextId = useRef(0);

  const fireReward = useCallback((reward: RewardPayload) => {
    if (!reward.credits && !reward.xp && !reward.stars) return;
    const id = nextId.current++;
    setToasts((prev) => [...prev, { id, ...reward }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, DISPLAY_MS);
  }, []);

  return (
    <FloatingRewardContext.Provider value={{ fireReward }}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 top-16 z-[200] flex flex-col items-center gap-2"
        style={{ paddingTop: 'env(safe-area-inset-top)' }}
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className="animate-[floatReward_2.6s_ease-out_forwards] flex items-center gap-2 rounded-full bg-neutral-900/90 px-4 py-2 text-sm font-semibold text-white shadow-lg"
          >
            {!!toast.credits && <span>🪙 +{toast.credits}</span>}
            {!!toast.xp && <span className="text-emerald-300">+{toast.xp} XP</span>}
            {!!toast.stars && <span className="text-violet-300">⭐ +{toast.stars}</span>}
          </div>
        ))}
      </div>
      <style>{`
        @keyframes floatReward {
          0% { opacity: 0; transform: translateY(8px) scale(0.95); }
          12% { opacity: 1; transform: translateY(0) scale(1); }
          78% { opacity: 1; transform: translateY(0) scale(1); }
          100% { opacity: 0; transform: translateY(-12px) scale(0.98); }
        }
      `}</style>
    </FloatingRewardContext.Provider>
  );
}

export function useFloatingReward(): FloatingRewardContextValue {
  return useContext(FloatingRewardContext);
}
