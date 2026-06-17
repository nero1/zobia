"use client";

/**
 * lib/realtime/useRealtimeChannel.ts
 *
 * Provider-agnostic React hook for subscribing to a realtime channel.
 *
 * Selects the correct provider SDK at runtime via
 * NEXT_PUBLIC_REALTIME_PROVIDER. All three SDKs are loaded with dynamic
 * import() so only the active provider's code is included in the bundle.
 *
 * @param channel  - Channel string (e.g. "dm:conversation:<uuid>"), or null
 *                   to skip subscription.
 * @param onEvent  - Callback invoked with (eventName, data) for each message.
 * @returns `true` while a realtime provider is configured AND its socket is
 *          currently connected. Callers use this to back off their baseline
 *          poll (slow reconcile while connected, fast poll while
 *          disconnected / when no provider is configured). This is what keeps
 *          serverless function usage low: when the WebSocket is healthy the
 *          page is not hitting the REST API every few seconds.
 */

import { useEffect, useState } from "react";

export function useRealtimeChannel(
  channel: string | null,
  onEvent: (event: string, data: unknown) => void
): boolean {
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!channel) {
      setConnected(false);
      return;
    }

    const provider = process.env.NEXT_PUBLIC_REALTIME_PROVIDER;
    let cancelled = false;
    let cleanup: (() => void) | undefined;
    // Guarded setter — never touch state after the effect has been torn down.
    const markConnected = (v: boolean) => {
      if (!cancelled) setConnected(v);
    };

    if (provider === "supabase-realtime") {
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (!supabaseUrl || !supabaseAnonKey) return;

      (async () => {
        const { createClient } = (await import("@supabase/supabase-js")) as any;
        const supabase = createClient(supabaseUrl, supabaseAnonKey);
        const sub = supabase
          .channel(channel)
          .on(
            "broadcast",
            { event: "*" },
            (payload: any) => {
              onEvent(payload.event as string, payload.payload);
            }
          )
          .subscribe((status: string) => {
            // 'SUBSCRIBED' = live; anything else (CLOSED/TIMED_OUT/CHANNEL_ERROR)
            // means we should fall back to the fast baseline poll.
            markConnected(status === "SUBSCRIBED");
          });

        if (cancelled) {
          supabase.removeChannel(sub).catch(() => {});
          return;
        }
        cleanup = () => {
          supabase.removeChannel(sub).catch(() => {});
        };
      })();
    } else if (provider === "ably") {
      (async () => {
        const Ably = (await import("ably")) as any;
        const client = new Ably.Realtime({
          authUrl: `/api/realtime/ably-token?channel=${encodeURIComponent(channel)}`,
        });
        // Connection-level state drives the poll back-off.
        client.connection.on((stateChange: { current: string }) => {
          markConnected(stateChange.current === "connected");
        });
        const ch = client.channels.get(channel);
        ch.subscribe((msg: { name: string; data: unknown }) => {
          onEvent(msg.name, msg.data);
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
      })();
    } else if (provider === "pusher") {
      const pusherKey = process.env.NEXT_PUBLIC_PUSHER_KEY;
      const pusherCluster = process.env.NEXT_PUBLIC_PUSHER_CLUSTER ?? "mt1";
      if (!pusherKey) return;

      // Convert channel name to Pusher private channel format:
      //   "dm:conversation:<uuid>" → "private-dm-conversation-<uuid>"
      //   "room:<uuid>"            → "private-room-<uuid>"
      const pusherChannel = channel
        .replace(/^dm:conversation:/, "private-dm-conversation-")
        .replace(/^room:/, "private-room-");

      (async () => {
        const Pusher = ((await import("pusher-js")) as any).default;
        const pusher = new Pusher(pusherKey, {
          cluster: pusherCluster,
          channelAuthorization: {
            endpoint: "/api/realtime/pusher-auth",
            transport: "ajax",
          },
        });
        pusher.connection.bind("state_change", (states: { current: string }) => {
          markConnected(states.current === "connected");
        });

        const sub = pusher.subscribe(pusherChannel);
        // Pusher delivers named events — bind to all with a catch-all
        sub.bind_global((eventName: string, data: unknown) => {
          if (!eventName.startsWith("pusher:")) {
            onEvent(eventName, data);
          }
        });

        if (cancelled) {
          pusher.unsubscribe(pusherChannel);
          pusher.disconnect();
          return;
        }
        cleanup = () => {
          pusher.unsubscribe(pusherChannel);
          pusher.disconnect();
        };
      })();
    }
    // If no provider is configured, this is a no-op — `connected` stays false
    // and the caller's fast baseline poll handles delivery.

    return () => {
      cancelled = true;
      setConnected(false);
      cleanup?.();
    };
  // onEvent is intentionally excluded from deps to avoid reconnecting on every
  // render — callers should wrap it in useCallback if they need it to change.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel]);

  return connected;
}
