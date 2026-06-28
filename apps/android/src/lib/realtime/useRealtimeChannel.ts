/**
 * apps/android/src/lib/realtime/useRealtimeChannel.ts
 *
 * Adapted from apps/expo/lib/realtime/useRealtimeChannel.ts.
 * Changes:
 *  - AppState (React Native) → @capacitor/app App.addListener('appStateChange')
 *  - All logic (onEventRef, single-flight, reconnect guard, JSON.parse,
 *    401 → refreshAccessToken retry) kept identical.
 *
 * @returns `true` while Ably socket is connected.
 */

import { useEffect, useRef, useState } from 'react';
import { App } from '@capacitor/app';
import { env } from '@/lib/env';
import { apiClient, refreshAccessToken } from '@/lib/api/client';

export function useRealtimeChannel(
  channel: string | null,
  onEvent: (event: string, data: unknown) => void,
): boolean {
  const [connected, setConnected] = useState(false);

  // Keep onEvent in a ref to avoid stale closures without re-subscribing.
  const onEventRef = useRef(onEvent);
  useEffect(() => {
    onEventRef.current = onEvent;
  });

  useEffect(() => {
    if (!channel || env.VITE_REALTIME_PROVIDER !== 'ably') {
      setConnected(false);
      return;
    }

    let cancelled = false;
    let cleanup: (() => void) | undefined;
    const markConnected = (v: boolean) => {
      if (!cancelled) setConnected(v);
    };

    (async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let ablyClient: any = null;
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
        const Ably = require('ably') as any;
        const client = new Ably.Realtime({
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
                  // refresh also failed
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

        const RECOVERABLE_STATES = new Set(['initialized', 'suspended', 'disconnected']);
        let appStateHandle: { remove: () => void } | null = null;

        App.addListener('appStateChange', ({ isActive }) => {
          if (
            isActive &&
            ablyClient &&
            RECOVERABLE_STATES.has(ablyClient.connection.state)
          ) {
            ablyClient.connect();
          }
        }).then((h) => { appStateHandle = h; });

        const ch = client.channels.get(channel);
        ch.subscribe((msg: { name: string; data: unknown }) => {
          let payload: unknown = msg.data;
          if (typeof payload === 'string') {
            try { payload = JSON.parse(payload); } catch { /* leave as string */ }
          }
          onEventRef.current(msg.name, payload);
        });

        if (cancelled) {
          appStateHandle?.remove();
          ch.unsubscribe();
          client.close();
          return;
        }
        cleanup = () => {
          appStateHandle?.remove();
          ch.unsubscribe();
          client.close();
        };
      } catch (err) {
        if (ablyClient) {
          try { ablyClient.close(); } catch {}
        }
        console.warn('[realtime] Ably init failed; using poll fallback', err);
      }
    })();

    return () => {
      cancelled = true;
      setConnected(false);
      cleanup?.();
    };
  }, [channel]);

  return connected;
}
