/**
 * lib/referral/useReferralCode.ts
 *
 * Shared "what's my own referral code" cache for the Capacitor app — mirrors
 * apps/web/lib/referral/useReferralCode.ts. Used by every Share screen that
 * needs to attach the viewer's own `?r=` code to a shareable link (polls,
 * quizzes, classroom, tweets, answers). Fetched once per session and cached
 * in localStorage, scoped by user id so it never leaks between users of a
 * shared device.
 */

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth/store';
import { apiClient } from '@/lib/api/client';

const memoryCache = new Map<string, string>();

function storageKey(userId: string): string {
  return `zobia:referralCode:${userId}`;
}

async function fetchReferralCode(userId: string): Promise<string | null> {
  const cached = memoryCache.get(userId);
  if (cached) return cached;

  try {
    const stored = localStorage.getItem(storageKey(userId));
    if (stored) {
      memoryCache.set(userId, stored);
      return stored;
    }
  } catch {
    // localStorage unavailable — fall through to network fetch
  }

  try {
    const { data } = await apiClient.get<{ referralCode?: string | null }>('/referrals');
    const code = data?.referralCode ?? null;
    if (code) {
      memoryCache.set(userId, code);
      try {
        localStorage.setItem(storageKey(userId), code);
      } catch {
        // Non-fatal — just skip caching
      }
    }
    return code;
  } catch {
    return null;
  }
}

/** Returns the current user's own referral code (null while loading, or if logged out / unavailable). */
export function useMyReferralCode(): { code: string | null; loading: boolean } {
  const { user } = useAuth();
  const [code, setCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setCode(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetchReferralCode(user.id).then((c) => {
      if (!cancelled) {
        setCode(c);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [user]);

  return { code, loading };
}
