/**
 * apps/android/src/lib/hooks/usePresenceHeartbeat.ts
 *
 * Mirrors apps/web/lib/presence/usePresenceHeartbeat.ts — keeps the
 * authenticated user's presence warm (POST /api/presence) so `last_active_at`
 * / the Online Friends row on Home behave the same on the Capacitor app as
 * on web/PWA. Also reacts to Capacitor App state (foreground/background),
 * since visibilitychange alone is unreliable inside a WebView.
 */

import { useEffect, useRef } from 'react';
import { App as CapApp } from '@capacitor/app';
import { apiFetch } from '@/lib/api/apiFetch';
import { env } from '@/lib/env';
import { useAuth } from '@/lib/auth/store';

const HEARTBEAT_INTERVAL_MS = 3 * 60 * 1000;

function sendHeartbeat() {
  apiFetch(`${env.VITE_API_BASE_URL}/api/presence`, { method: 'POST' }).catch(() => {});
}

export function usePresenceHeartbeat() {
  const { token } = useAuth();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!token) return;

    sendHeartbeat();
    intervalRef.current = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);

    const listenerPromise = CapApp.addListener('appStateChange', ({ isActive }) => {
      if (isActive) sendHeartbeat();
    });

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      listenerPromise.then((h) => h.remove());
    };
  }, [token]);
}
