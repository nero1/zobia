"use client";

/**
 * lib/streaks/useLoginStreak.ts
 *
 * Records the authenticated user's daily login exactly once per calendar day
 * per device, then surfaces the result (XP bonus, streak milestone) via the
 * existing floating-notification system.
 *
 * Root cause fix: POST /api/login/daily (login_streak_days, longest_streak,
 * last_login_date, the "Streak Keeper" quest, and the login-streak daily XP)
 * was fully implemented server-side but never called by any client — so
 * `last_login_date` stayed NULL for every user forever, which in turn means
 * the nightly cron's set-based streak increment (`WHERE last_login_date =
 * CURRENT_DATE`) never matched a single row. Streaks were never counted
 * regardless of whether the cron had run.
 *
 * Mirrors usePresenceHeartbeat.ts's pattern: mounted once in the
 * authenticated app layout via LoginStreakProvider.
 */

import { useEffect, useRef } from "react";
import { useAuth } from "@/lib/auth/hooks";
import { useFloatingNotification } from "@/hooks/useFloatingNotification";

interface DailyLoginResponse {
  success: boolean;
  data?: {
    streakDays: number;
    xpAwarded: number;
    isPersonalBest: boolean;
    alreadyClaimedToday: boolean;
    comebackBonusClaimed?: number;
  };
}

/** Per-user, per-device claim marker so a shared device never leaks one
 *  account's "already claimed today" state into another account's session. */
function claimStorageKey(userId: string): string {
  return `zobia_login_streak_claim:${userId}`;
}

function todayLocalDate(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function useLoginStreak(): void {
  const { user } = useAuth();
  const { fireXP, fireConfetti } = useFloatingNotification();
  const attemptedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!user?.id) return;
    const today = todayLocalDate();
    const key = claimStorageKey(user.id);

    let alreadyClaimed = false;
    try {
      alreadyClaimed = window.localStorage.getItem(key) === today;
    } catch {
      // localStorage unavailable — fall through and let the server's own
      // idempotency guard (Redis NX key) prevent a double-award.
    }
    // Guard against re-firing on every re-render within the same mount,
    // without permanently blocking retry across a full page navigation.
    if (alreadyClaimed || attemptedRef.current === today) return;
    attemptedRef.current = today;

    fetch("/api/login/daily", { method: "POST", credentials: "include" })
      .then((res) => (res.ok ? (res.json() as Promise<DailyLoginResponse>) : null))
      .then((body) => {
        const data = body?.data;
        if (!data) return;
        try {
          window.localStorage.setItem(key, today);
        } catch {
          // Best-effort — the server-side Redis guard still prevents double XP.
        }
        if (data.alreadyClaimedToday) return;
        if (data.xpAwarded > 0) fireXP(data.xpAwarded);
        if (data.isPersonalBest && data.streakDays > 1) fireConfetti();
      })
      .catch(() => {
        // Allow a retry on the next mount (e.g. next navigation) instead of
        // permanently giving up for the rest of the tab's lifetime.
        attemptedRef.current = null;
      });
  }, [user?.id, fireXP, fireConfetti]);
}
