"use client";

/**
 * components/streaks/LoginStreakProvider.tsx
 *
 * Client component that mounts the app-wide daily login streak recorder.
 * Add once to the authenticated app layout — see useLoginStreak.ts for why
 * this exists.
 */

import { useLoginStreak } from "@/lib/streaks/useLoginStreak";

export function LoginStreakProvider() {
  useLoginStreak();
  return null;
}
