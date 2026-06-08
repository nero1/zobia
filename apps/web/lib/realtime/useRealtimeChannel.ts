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
 */

import { useEffect } from "react";

export function useRealtimeChannel(
  channel: string | null,
  onEvent: (event: string, data: unknown) => void
): void {
  useEffect(() => {
    if (!channel) return;

    const provider = process.env.NEXT_PUBLIC_REALTIME_PROVIDER;
    let cleanup: (() => void) | undefined;

    if (provider === "supabase-realtime") {
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (!supabaseUrl || !supabaseAnonKey) return;

      (async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { createClient } = (await import("@supabase/supabase-js")) as any;
        const supabase = createClient(supabaseUrl, supabaseAnonKey);
        const sub = supabase
          .channel(channel)
          .on(
            "broadcast",
            { event: "*" },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (payload: any) => {
              onEvent(payload.event as string, payload.payload);
            }
          )
          .subscribe();

        cleanup = () => {
          supabase.removeChannel(sub).catch(() => {});
        };
      })();
    } else if (provider === "ably") {
      (async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const Ably = (await import("ably")) as any;
        const client = new Ably.Realtime({
          authUrl: `/api/realtime/ably-token?channel=${encodeURIComponent(channel)}`,
        });
        const ch = client.channels.get(channel);
        ch.subscribe((msg: { name: string; data: unknown }) => {
          onEvent(msg.name, msg.data);
        });

        cleanup = () => {
          ch.unsubscribe();
          client.close();
        };
      })();
    } else if (provider === "pusher") {
      const pusherKey = process.env.NEXT_PUBLIC_PUSHER_KEY;
      const pusherCluster = process.env.NEXT_PUBLIC_PUSHER_CLUSTER ?? "mt1";
      if (!pusherKey) return;

      // Convert channel name: "dm:conversation:<uuid>" →
      // "private-dm-conversation-<uuid>" (Pusher private channel format)
      const pusherChannel = channel
        .replace(/^dm:conversation:/, "private-dm-conversation-");

      (async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const Pusher = ((await import("pusher-js")) as any).default;
        const pusher = new Pusher(pusherKey, {
          cluster: pusherCluster,
          channelAuthorization: {
            endpoint: "/api/realtime/pusher-auth",
            transport: "ajax",
          },
        });

        const sub = pusher.subscribe(pusherChannel);
        // Pusher delivers named events — bind to all with a catch-all
        sub.bind_global((eventName: string, data: unknown) => {
          if (!eventName.startsWith("pusher:")) {
            onEvent(eventName, data);
          }
        });

        cleanup = () => {
          pusher.unsubscribe(pusherChannel);
          pusher.disconnect();
        };
      })();
    }
    // If no provider is configured, this is a no-op — polling handles delivery.

    return () => {
      cleanup?.();
    };
  // onEvent is intentionally excluded from deps to avoid reconnecting on every
  // render — callers should wrap it in useCallback if they need it to change.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel]);
}
