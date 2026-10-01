'use client';

import { useEffect, useRef, useState } from 'react';
import { setSessionExpiresAt } from '@/lib/auth/sessionExpiryBus';
import { hasSessionHint, markSessionActive, markSessionExpired, rawFetch } from '@/lib/auth/sessionExpiredBus';
import { cachedIdentityFetch } from '@/lib/auth/identityCache';

export interface AuthUser {
  id: string;
  email: string;
  username: string;
  is_admin: boolean;
  is_moderator?: boolean;
  /** Sitewide "support" role (0001_consolidated_schema.sql) — grantable like
   *  is_moderator. Used for client-side UI (e.g. /gate44/support/*
   *  page-level checks), always alongside a server-side DB re-check. */
  is_support?: boolean;
  is_senior_support?: boolean;
}

interface AuthState {
  user: AuthUser | null;
  isLoading: boolean;
}

// ---------------------------------------------------------------------------
// Module-level deduplication cache (BUG-PERF-02)
//
// Without deduplication, every component that calls useAuth() fires an
// independent fetch to /api/auth/me on mount, producing N redundant network
// requests per page render.
//
// Fix: a module-scoped promise cache keyed on a fixed string. The first caller
// fires the real fetch; all subsequent callers within the same JS module
// lifetime await the same promise. The cached promise is cleared after the
// response settles so that a hard refresh (new page load) triggers a fresh
// fetch while a single page render shares exactly one request.
// ---------------------------------------------------------------------------

let _authPromise: Promise<AuthUser | null> | null = null;

// Shared with every other /api/auth/me reader through the identity cache
// (lib/auth/identityCache.ts), so a page render costs at most one request.
// rawFetch keeps this out of the global 401 guard, which would otherwise
// announce "session expired" before the silent refresh below gets a chance.
const authMeFetch = () =>
  cachedIdentityFetch('/api/auth/me', () => rawFetch('/api/auth/me', { credentials: 'include' }));

async function requestAuthMe(): Promise<AuthUser | null> {
  let res = await authMeFetch();
  if (res.status === 401 && hasSessionHint()) {
    // The short-lived access token may simply have lapsed while the refresh
    // token is still good — try one silent refresh before concluding anything.
    // (Skipped for visitors who were never signed in, so anonymous page loads
    // cost a single request instead of two.)
    const refreshed = await rawFetch('/api/auth/refresh', { method: 'POST', credentials: 'include' })
      .then((r) => r.ok)
      .catch(() => false);
    if (refreshed) res = await authMeFetch();
  }
  if (!res.ok) {
    // markSessionExpired() is a no-op for a visitor who never had a session,
    // so anonymous page loads stay silent; a returning user whose session
    // died gets the one-time "signed out" notice.
    if (res.status === 401) markSessionExpired();
    return null;
  }
  const data = (await res.json()) as { user?: AuthUser; expiresAt?: number | null } | null;
  setSessionExpiresAt(data?.expiresAt ?? null);
  if (data?.user) markSessionActive();
  return data?.user ?? null;
}

function fetchAuthMe(): Promise<AuthUser | null> {
  if (_authPromise) return _authPromise;

  _authPromise = requestAuthMe()
    .catch(() => null)
    .finally(() => {
      // Clear after settling so the next page navigation re-fetches.
      // (Module state survives client-side navigations in Next.js app router,
      //  so we reset to allow the next mount cycle to fetch fresh data.)
      _authPromise = null;
    });

  return _authPromise;
}

/**
 * @param revalidateKey Optional. Providers mounted in the root layout survive
 *   client-side navigations (e.g. the post-login redirect), so they pass the
 *   pathname here to re-check identity while still anonymous. Once a user has
 *   been resolved the key is ignored, so this never adds requests for
 *   signed-in sessions.
 */
export function useAuth(revalidateKey?: string): AuthState {
  const [state, setState] = useState<AuthState>({ user: null, isLoading: true });
  const resolvedRef = useRef(false);

  useEffect(() => {
    if (resolvedRef.current) return;
    let cancelled = false;

    fetchAuthMe().then((user) => {
      if (!cancelled) {
        if (user) resolvedRef.current = true;
        setState({ user, isLoading: false });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [revalidateKey]);

  return state;
}

// ---------------------------------------------------------------------------
// Shared /api/users/me profile (nav display data)
//
// BUG: Sidebar.tsx and Navbar.tsx each used to define their own ad-hoc
// useState/useEffect hook that independently fetched /api/users/me on mount
// with no dedup (two redundant requests per page load), no retry, and any
// non-OK response or network error silently swallowed forever — leaving the
// nav permanently stuck showing the "Your Name" / "@username" / "U" avatar
// placeholders with zero recovery path, even once the underlying session
// issue (if any) resolved. This mirrors the same BUG-PERF-02 dedup fix above
// for /api/auth/me, applied to the nav's profile fetch, and the global
// window.fetch guard (lib/auth/sessionExpiredBus.ts) already turns a genuine
// 401 here into the proper "session expired" modal instead of a silent null.
// ---------------------------------------------------------------------------

export interface NavProfile {
  display_name: string | null;
  username: string | null;
  avatar_emoji: string | null;
  plan?: string | null;
  is_admin?: boolean;
  is_moderator?: boolean;
  is_council_member?: boolean;
}

let _profilePromise: Promise<NavProfile | null> | null = null;

function fetchUserProfile(): Promise<NavProfile | null> {
  if (_profilePromise) return _profilePromise;

  const promise: Promise<NavProfile | null> = fetch('/api/users/me', { credentials: 'include' })
    .then((res) => (res.ok ? res.json() : null))
    .then((data: { user?: NavProfile } | null): NavProfile | null => data?.user ?? null)
    .catch(() => null)
    .finally(() => {
      _profilePromise = null;
    });
  _profilePromise = promise;

  return promise;
}

export function useUserProfile(): NavProfile | null {
  const [user, setUser] = useState<NavProfile | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetchUserProfile().then((profile) => {
      if (!cancelled) setUser(profile);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return user;
}
