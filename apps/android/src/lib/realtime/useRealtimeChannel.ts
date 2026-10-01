/**
 * apps/android/src/lib/realtime/useRealtimeChannel.ts
 *
 * Adapted from apps/expo/lib/realtime/useRealtimeChannel.ts.
 * The Ably connection, token handling (401 → refreshAccessToken retry) and
 * the foreground reconnect live in lib/realtime/ablyShared.ts, shared by all
 * subscribers.
 *
 * @returns `true` while Ably socket is connected.
 */

import { useEffect, useRef, useState } from 'react';
import { env } from '@/lib/env';
import { acquireAblyChannel } from '@/lib/realtime/ablyShared';
import { invalidateReadCache } from '@/lib/api/readCache';

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
      try {
        // One shared connection per session; a token is only requested when
        // this channel isn't already covered (lib/realtime/ablyShared.ts).
        const { client, release } = await acquireAblyChannel(channel);
        if (cancelled) {
          release();
          return;
        }
        const onState = (stateChange: { current: string }) => {
          markConnected(stateChange.current === 'connected');
        };
        client.connection.on(onState);
        markConnected(client.connection.state === 'connected');

        const ch = client.channels.get(channel);
        const listener = (msg: { name: string; data: unknown }) => {
          if (cancelled) return;
          let payload: unknown = msg.data;
          if (typeof payload === 'string') {
            try { payload = JSON.parse(payload); } catch { /* leave as string */ }
          }
          // Events on the user's own channel (rewards, coins, XP) change what
          // the short-lived read cache holds.
          if (channel.startsWith('user:')) invalidateReadCache();
          onEventRef.current(msg.name, payload);
        };
        ch.subscribe(listener);

        cleanup = () => {
          ch.unsubscribe(listener);
          client.connection.off(onState);
          release();
        };
      } catch (err) {
        console.warn('[realtime] Ably unavailable; using poll fallback', err);
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
