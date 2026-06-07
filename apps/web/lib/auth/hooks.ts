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

export function useAuth(): AuthState {
  const [state, setState] = useState<AuthState>({ user: null, isLoading: true });

  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'include' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        setState({
          user: data?.user ?? null,
          isLoading: false,
        });
      })
      .catch(() => {
        setState({ user: null, isLoading: false });
      });
  }, []);

  return state;
}
