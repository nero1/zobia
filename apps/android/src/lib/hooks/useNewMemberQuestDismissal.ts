/**
 * apps/android/src/lib/hooks/useNewMemberQuestDismissal.ts
 *
 * Mirrors apps/web/lib/hooks/useNewMemberQuestDismissal.ts — client-owned
 * dismissal state for the Home Dashboard's New Member Quest card. This app
 * already uses plain localStorage for equivalent small per-user UI state
 * (see lib/hooks/useLoginStreak.ts's `zobia_login_streak_claim:<userId>`
 * key), so the same mechanism is used here rather than Capacitor
 * Preferences, scoped per-user under `zobia:nmq:<userId>` — identical to
 * web — so a shared device doesn't leak one user's dismissal into another's
 * session.
 *
 * The server (POST /api/quests/new-member/dismiss) is only informed
 * occasionally — after the 4th dismissal, or immediately on an explicit
 * "don't remind me again" — per that route's own doc comment, to keep DB
 * writes low.
 */

import { useCallback, useEffect, useState } from 'react';
import { apiClient } from '@/lib/api/client';

const SNOOZE_DAYS = 7;
const DISMISS_COUNT_BEFORE_CONFIRM = 4;

export interface NewMemberQuestDismissalState {
  dismissCount: number;
  lastDismissedAt: string | null;
  dontRemindAgain: boolean;
}

const DEFAULT_STATE: NewMemberQuestDismissalState = {
  dismissCount: 0,
  lastDismissedAt: null,
  dontRemindAgain: false,
};

function storageKey(userId: string): string {
  return `zobia:nmq:${userId}`;
}

function readState(userId: string): NewMemberQuestDismissalState {
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (!raw) return DEFAULT_STATE;
    const parsed = JSON.parse(raw) as Partial<NewMemberQuestDismissalState>;
    return {
      dismissCount: typeof parsed.dismissCount === 'number' ? parsed.dismissCount : 0,
      lastDismissedAt: typeof parsed.lastDismissedAt === 'string' ? parsed.lastDismissedAt : null,
      dontRemindAgain: Boolean(parsed.dontRemindAgain),
    };
  } catch {
    return DEFAULT_STATE;
  }
}

function writeState(userId: string, state: NewMemberQuestDismissalState) {
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify(state));
  } catch {
    // best-effort — localStorage may be unavailable (private mode, etc.)
  }
}

function isSnoozeExpired(lastDismissedAt: string | null): boolean {
  if (!lastDismissedAt) return true;
  const elapsedMs = Date.now() - new Date(lastDismissedAt).getTime();
  return elapsedMs >= SNOOZE_DAYS * 24 * 60 * 60 * 1000;
}

/**
 * `userId` may be null/undefined while auth is still loading — the hook
 * simply reports `shouldShow: false` until it resolves, so callers don't
 * need their own loading gate.
 */
export function useNewMemberQuestDismissal(userId: string | null | undefined) {
  const [state, setState] = useState<NewMemberQuestDismissalState>(DEFAULT_STATE);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!userId) return;
    setState(readState(userId));
    setLoaded(true);
  }, [userId]);

  const shouldShow = Boolean(userId) && loaded && !state.dontRemindAgain && isSnoozeExpired(state.lastDismissedAt);

  const needsConfirm = state.dismissCount >= DISMISS_COUNT_BEFORE_CONFIRM;

  const syncServer = useCallback((dismissCount: number, dontRemindAgain: boolean) => {
    apiClient.post('/quests/new-member/dismiss', { dismissCount, dontRemindAgain }).catch(() => {
      // best-effort — localStorage remains the source of truth client-side
    });
  }, []);

  /** Normal dismiss: increments count, snoozes 7 days. Also syncs to the server past the confirm threshold. */
  const dismiss = useCallback(() => {
    if (!userId) return;
    setState((prev) => {
      const next: NewMemberQuestDismissalState = {
        dismissCount: prev.dismissCount + 1,
        lastDismissedAt: new Date().toISOString(),
        dontRemindAgain: false,
      };
      writeState(userId, next);
      if (next.dismissCount >= DISMISS_COUNT_BEFORE_CONFIRM) {
        syncServer(next.dismissCount, false);
      }
      return next;
    });
  }, [userId, syncServer]);

  /** "Don't remind me again" — permanent, always synced server-side immediately. */
  const dontRemindAgain = useCallback(() => {
    if (!userId) return;
    setState((prev) => {
      const next: NewMemberQuestDismissalState = {
        dismissCount: prev.dismissCount + 1,
        lastDismissedAt: new Date().toISOString(),
        dontRemindAgain: true,
      };
      writeState(userId, next);
      syncServer(next.dismissCount, true);
      return next;
    });
  }, [userId, syncServer]);

  return { shouldShow, needsConfirm, dismissCount: state.dismissCount, dismiss, dontRemindAgain };
}
