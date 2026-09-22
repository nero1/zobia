"use client";

/**
 * lib/referral/useReferralCode.ts
 *
 * Shared "what's my own referral code" cache, used by every Share button
 * that needs to attach the viewer's own `?r=` code to a shareable link
 * (games, polls, quizzes, classroom, blogs, tweets, answers, wiki, merch).
 * Fetched once per session and cached in localStorage, scoped by user id so
 * it never leaks between users of a shared device — this replaces several
 * near-identical fetch/cache implementations that used to live inline in
 * each Share button.
 */

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth/hooks";

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
    const res = await fetch("/api/referrals", { credentials: "include" });
    if (!res.ok) return null;
    const json = (await res.json()) as { data?: { referralCode?: string | null } };
    const code = json.data?.referralCode ?? null;
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

/**
 * Returns the current user's own referral code (null while loading, or if
 * logged out / unavailable). Pair with `appendReferralCode` from
 * `@zobia/shared/utils` to build a shareable link.
 */
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
