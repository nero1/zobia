import { useState, useEffect, useCallback } from 'react';
import { storage } from '@/lib/offline/store';

interface PinRateLimitKeys {
  attempts: string;
  lockedUntil: string;
  lockCount: string;
}

interface PinRateLimitResult {
  isLocked: boolean;
  remainingMs: number;
  failedAttempts: number;
  recordFailure: () => { nowLocked: boolean };
  resetAttempts: () => void;
}

export const PIN_MAX_ATTEMPTS = 5;
const MAX_ATTEMPTS = PIN_MAX_ATTEMPTS;
const BASE_LOCKOUT_MS = 15 * 60_000; // 15 min
const MAX_LOCKOUT_MS = 24 * 60 * 60_000; // 24 hours

export function usePinRateLimit(keys: PinRateLimitKeys): PinRateLimitResult {
  const [failedAttempts, setFailedAttempts] = useState<number>(() => {
    try { return storage.getNumber(keys.attempts) ?? 0; } catch { return 0; }
  });
  const [lockedUntil, setLockedUntil] = useState<number | null>(() => {
    try { const v = storage.getNumber(keys.lockedUntil); return v ?? null; } catch { return null; }
  });
  const [lockCount, setLockCount] = useState<number>(() => {
    try { return storage.getNumber(keys.lockCount) ?? 0; } catch { return 0; }
  });
  const [remainingMs, setRemainingMs] = useState<number>(0);

  const isLocked = lockedUntil !== null && Date.now() < lockedUntil;

  useEffect(() => {
    try { storage.set(keys.attempts, failedAttempts); } catch {}
  }, [failedAttempts, keys.attempts]);

  useEffect(() => {
    try {
      if (lockedUntil === null) storage.delete(keys.lockedUntil);
      else storage.set(keys.lockedUntil, lockedUntil);
    } catch {}
  }, [lockedUntil, keys.lockedUntil]);

  useEffect(() => {
    try { storage.set(keys.lockCount, lockCount); } catch {}
  }, [lockCount, keys.lockCount]);

  // Countdown timer
  useEffect(() => {
    if (!isLocked || lockedUntil === null) {
      setRemainingMs(0);
      return;
    }
    const update = () => {
      const rem = lockedUntil - Date.now();
      if (rem <= 0) {
        setLockedUntil(null);
        setRemainingMs(0);
      } else {
        setRemainingMs(rem);
      }
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [isLocked, lockedUntil]);

  const recordFailure = useCallback((): { nowLocked: boolean } => {
    const nextAttempts = failedAttempts + 1;
    if (nextAttempts >= MAX_ATTEMPTS) {
      const nextLockCount = lockCount + 1;
      const lockMs = Math.min(BASE_LOCKOUT_MS * Math.pow(2, lockCount), MAX_LOCKOUT_MS);
      const until = Date.now() + lockMs;
      setLockedUntil(until);
      setFailedAttempts(0);
      setLockCount(nextLockCount);
      try {
        storage.set(keys.lockedUntil, until);
        storage.delete(keys.attempts);
        storage.set(keys.lockCount, nextLockCount);
      } catch {}
      return { nowLocked: true };
    }
    setFailedAttempts(nextAttempts);
    return { nowLocked: false };
  }, [failedAttempts, lockCount, keys]);

  const resetAttempts = useCallback(() => {
    setFailedAttempts(0);
    setLockedUntil(null);
    setLockCount(0);
    try {
      storage.delete(keys.attempts);
      storage.delete(keys.lockedUntil);
      storage.delete(keys.lockCount);
    } catch {}
  }, [keys]);

  return { isLocked, remainingMs, failedAttempts, recordFailure, resetAttempts };
}
