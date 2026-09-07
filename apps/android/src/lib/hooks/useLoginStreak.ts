/**
 * apps/android/src/lib/hooks/useLoginStreak.ts
 *
 * Mirrors apps/web/lib/streaks/useLoginStreak.ts — records the
 * authenticated user's daily login exactly once per calendar day per
 * device (POST /api/login/daily), then surfaces the XP bonus / streak
 * milestone via the app's floating reward toast.
 *
 * Root cause: POST /api/login/daily is fully implemented server-side but
 * nothing called it, so `last_login_date` stayed NULL forever and the
 * nightly cron's set-based streak increment never matched a row. Streaks
 * were never counted on any platform.
 */

import { useEffect, useRef } from 'react';
import { apiFetch } from '@/lib/api/apiFetch';
import { env } from '@/lib/env';
import { useAuth } from '@/lib/auth/store';
import { useFloatingReward } from '@/components/notifications/FloatingRewardProvider';

interface DailyLoginResponse {
  success: boolean;
  data?: {
    streakDays: number;
    xpAwarded: number;
    isPersonalBest: boolean;
    alreadyClaimedToday: boolean;
  };
}

function claimStorageKey(userId: string): string {
  return `zobia_login_streak_claim:${userId}`;
}

function todayLocalDate(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function useLoginStreak() {
  const { user, token } = useAuth();
  const { fireReward } = useFloatingReward();
  const attemptedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!token || !user?.id) return;
    const today = todayLocalDate();
    const key = claimStorageKey(user.id);

    let alreadyClaimed = false;
    try {
      alreadyClaimed = window.localStorage.getItem(key) === today;
    } catch {
      // localStorage unavailable — the server-side Redis guard still
      // prevents a double award.
    }
    if (alreadyClaimed || attemptedRef.current === today) return;
    attemptedRef.current = today;

    apiFetch(`${env.VITE_API_BASE_URL}/api/login/daily`, { method: 'POST' })
      .then((res) => (res.ok ? (res.json() as Promise<DailyLoginResponse>) : null))
      .then((body) => {
        const data = body?.data;
        if (!data) return;
        try {
          window.localStorage.setItem(key, today);
        } catch {
          // best-effort
        }
        if (data.alreadyClaimedToday) return;
        if (data.xpAwarded > 0) fireReward({ xp: data.xpAwarded });
      })
      .catch(() => {
        attemptedRef.current = null;
      });
  }, [token, user?.id, fireReward]);
}
