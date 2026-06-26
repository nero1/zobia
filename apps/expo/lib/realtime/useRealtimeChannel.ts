/**
 * lib/realtime/useRealtimeChannel.ts (Expo / React Native)
 *
 * Provider-agnostic hook for subscribing to a realtime channel — the mobile
 * counterpart of the web app's hook. Only Ably is wired today (its SDK is
 * bundled); other providers can be added by installing their RN-compatible SDK
 * and adding a branch here.
 *
 * Unlike the web build (cookie auth), the mobile app authenticates with a Bearer
 * JWT in SecureStore, so we authorize the Ably token request via an
 * `authCallback` that calls our API through the shared axios client (its request
 * interceptor attaches the token). The token endpoint grants subscribe-only
 * capability scoped to the one channel.
 *
 * @returns `true` while a provider is configured AND its socket is connected.
 *          Callers use this to back off their React Query polling (slow
 *          reconcile when connected, fast poll when not).
 */

import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { env } from '@/lib/env';
import { apiClient, refreshAccessToken } from '@/lib/api/client';

export function useRealtimeChannel(
  channel: string | null,
  onEvent: (event: string, data: unknown) => void,
): boolean {
  const [connected, setConnected] = useState(false);

  // BUG-MOB-22: store onEvent in a ref so the subscribe callback always calls the
  // latest version without needing to re-subscribe when the callback identity changes.
  // Callers no longer need to wrap onEvent in useCallback for correctness.
  const onEventRef = useRef(onEvent);
  useEffect(() => {
    onEventRef.current = onEvent;
  });

  useEffect(() => {
    if (!channel || env.REALTIME_PROVIDER !== 'ably') {
      setConnected(false);
      return;
    }

    let cancelled = false;
    let cleanup: (() => void) | undefined;
    const markConnected = (v: boolean) => {
      if (!cancelled) setConnected(v);
    };

    (async () => {
      // M-1 FIX: track client reference outside the try block so it can be
      // closed in the catch path if an error is thrown after connection opens.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let ablyClient: any = null;
      try {
        // Metro resolves this at runtime; require() avoids the ES2015 dynamic-import
        // constraint of the Expo tsconfig (module defaults to ES2015 here).
        // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
        const Ably = require('ably') as any;
        const client = new Ably.Realtime({
          // Authorize via our API; the axios interceptor attaches the Bearer JWT.
          authCallback: async (
            _tokenParams: unknown,
            callback: (err: unknown, tokenRequest: unknown) => void,
          ) => {
            try {
              const { data } = await apiClient.get(
                `/realtime/ably-token?channel=${encodeURIComponent(channel)}`,
              );
              callback(null, data);
            } catch (err) {
              // On 401, silently refresh the JWT and retry once before failing.
              const status = (err as { response?: { status?: number } })?.response?.status;
              if (status === 401) {
                try {
                  await refreshAccessToken();
                  const { data } = await apiClient.get(
                    `/realtime/ably-token?channel=${encodeURIComponent(channel)}`,
                  );
                  callback(null, data);
                  return;
                } catch {
                  // refresh also failed — fall through to error path
                }
              }
              callback(err, null);
            }
          },
        });

        ablyClient = client;
        client.connection.on((stateChange: { current: string }) => {
          markConnected(stateChange.current === 'connected');
        });

        // Reconnect when the app comes to the foreground and the socket is in a
        // recoverable state. 'suspended' and 'disconnected' will self-reconnect
        // but benefit from an early nudge; 'initialized' needs an explicit connect().
        // BUG-PERF-06 FIX: do NOT reconnect from 'failed' — that is a terminal
        // state (bad credentials / repeated auth failure) that requires a full
        // Ably client re-init (handled by the useEffect dependency on `channel`
        // changing, or a full unmount/remount). Reconnecting from 'failed'
        // causes a thundering-herd of auth requests that won't succeed.
        const RECOVERABLE_STATES = new Set(['initialized', 'suspended', 'disconnected']);
        const appStateSubscription = AppState.addEventListener('change', (nextState) => {
          if (
            nextState === 'active' &&
            ablyClient &&
            RECOVERABLE_STATES.has(ablyClient.connection.state)
          ) {
            ablyClient.connect();
          }
        });

        const ch = client.channels.get(channel);
        ch.subscribe((msg: { name: string; data: unknown }) => {
          // Ably delivers JSON-encoded payloads as strings (we publish via REST
          // with JSON.stringify); parse defensively so callers get an object.
          let payload: unknown = msg.data;
          if (typeof payload === 'string') {
            try { payload = JSON.parse(payload); } catch { /* leave as string */ }
          }
          // Call through the ref so we always invoke the latest onEvent without
          // stale-closure issues or unnecessary re-subscriptions (BUG-MOB-22).
          onEventRef.current(msg.name, payload);
        });

        if (cancelled) {
          appStateSubscription.remove();
          ch.unsubscribe();
          client.close();
          return;
        }
        cleanup = () => {
          appStateSubscription.remove();
          ch.unsubscribe();
          client.close();
        };
      } catch (err) {
        // M-1 FIX: if client was created before the error was thrown, close it
        // so the underlying WebSocket is not leaked.
        if (ablyClient) {
          try { ablyClient.close(); } catch {}
        }
        // SDK missing / failed to init — stay on the poll fallback.
        console.warn('[realtime] Ably init failed; using poll fallback', err);
      }
    })();

    return () => {
      cancelled = true;
      setConnected(false);
      cleanup?.();
    };
  }, [channel]); // onEvent excluded: ref always holds latest value (BUG-MOB-22 fix)

  return connected;
}
