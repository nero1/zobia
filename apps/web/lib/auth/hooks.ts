'use client';

import { useEffect, useState } from 'react';
import { setSessionExpiresAt } from '@/lib/auth/sessionExpiryBus';

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

function fetchAuthMe(): Promise<AuthUser | null> {
  if (_authPromise) return _authPromise;

  _authPromise = fetch('/api/auth/me', { credentials: 'include' })
    .then((res) => (res.ok ? res.json() : null))
    .then((data: { user?: AuthUser; expiresAt?: number | null } | null) => {
      setSessionExpiresAt(data?.expiresAt ?? null);
      return data?.user ?? null;
    })
    .catch(() => null)
    .finally(() => {
      // Clear after settling so the next page navigation re-fetches.
      // (Module state survives client-side navigations in Next.js app router,
      //  so we reset to allow the next mount cycle to fetch fresh data.)
      _authPromise = null;
    });

  return _authPromise;
}

export function useAuth(): AuthState {
  const [state, setState] = useState<AuthState>({ user: null, isLoading: true });

  useEffect(() => {
    let cancelled = false;

    fetchAuthMe().then((user) => {
      if (!cancelled) {
        setState({ user, isLoading: false });
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

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
