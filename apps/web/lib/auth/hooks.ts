'use client';

import { useEffect, useState } from 'react';

export interface AuthUser {
  id: string;
  email: string;
  username: string;
  is_admin: boolean;
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
    .then((data: { user?: AuthUser } | null) => data?.user ?? null)
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
