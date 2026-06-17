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

import { useEffect, useState } from 'react';
import { env } from '@/lib/env';
import { apiClient } from '@/lib/api/client';

export function useRealtimeChannel(
  channel: string | null,
  onEvent: (event: string, data: unknown) => void,
): boolean {
  const [connected, setConnected] = useState(false);

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
              callback(err, null);
            }
          },
        });

        client.connection.on((stateChange: { current: string }) => {
          markConnected(stateChange.current === 'connected');
        });

        const ch = client.channels.get(channel);
        ch.subscribe((msg: { name: string; data: unknown }) => {
          // Ably delivers JSON-encoded payloads as strings (we publish via REST
          // with JSON.stringify); parse defensively so callers get an object.
          let payload: unknown = msg.data;
          if (typeof payload === 'string') {
            try { payload = JSON.parse(payload); } catch { /* leave as string */ }
          }
          onEvent(msg.name, payload);
        });

        if (cancelled) {
          ch.unsubscribe();
          client.close();
          return;
        }
        cleanup = () => {
          ch.unsubscribe();
          client.close();
        };
      } catch (err) {
        // SDK missing / failed to init — stay on the poll fallback.
        console.warn('[realtime] Ably init failed; using poll fallback', err);
      }
    })();

    return () => {
      cancelled = true;
      setConnected(false);
      cleanup?.();
    };
    // onEvent intentionally excluded — callers should wrap it in useCallback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel]);

  return connected;
}
