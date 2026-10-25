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

import { resolveRealtimeEvent } from "./resolveEvent";
import { realtimeEventId, isProtectedRealtimeChannel } from "@zobia/shared/utils";
import { useEffect, useState, useRef } from "react";
import { authorizePusherChannel } from "./pusherAuthorization";
import { toPusherChannelName } from "./pusherChannelName";
import { invalidateReadCache } from "@/lib/cache/readCache";

// Module-level Pusher singleton — one WebSocket connection shared across all
// hook instances. Created lazily on first use; never disconnected until the
// app unmounts (call disconnectPusher() at the top-level teardown if needed).
const pusherReferences = new Map<string, number>();
let pusherSingleton: InstanceType<typeof import("pusher-js").default> | null = null;

/** Call at app unmount to cleanly close the shared Pusher connection. */
export function disconnectPusher(): void {
  pusherSingleton?.disconnect();
  pusherSingleton = null;
  pusherReferences.clear();
}

export function useRealtimeChannel(
  channel: string | null,
  onEvent: (event: string, data: unknown) => void
): boolean {
  const [connected, setConnected] = useState(false);
  const eventRef = useRef(onEvent);
  eventRef.current = onEvent;

  useEffect(() => {
    if (!channel) {
      setConnected(false);
      return;
    }

    const provider = process.env.NEXT_PUBLIC_REALTIME_PROVIDER;
    if (provider === "supabase-realtime" && isProtectedRealtimeChannel(channel)) {
      setConnected(false);
      return;
    }
    let cancelled = false;
    const deliveredIds = new Set<string>();
    let cleanup: (() => void) | undefined;
    // Events on the user's own channel (rewards, coins, XP, notifications)
    // change what the short-lived client read cache holds, so drop it first.
    const deliver = async (event: string, data: unknown) => {
      if (cancelled) return;
      if (typeof data==="string") {try {data=JSON.parse(data);}catch{/* Preserve plain public event strings. */}}
      if (isProtectedRealtimeChannel(channel)) {
        if (event!=="sync") return; // Never trust a legacy private body from a broker.
        const id=realtimeEventId(data);
        if(!id){markConnected(false);return;}
        if(deliveredIds.has(id))return;
        try {
          const resolved=await resolveRealtimeEvent(id,channel);
          if(cancelled || deliveredIds.has(id))return;
          deliveredIds.add(id);if(deliveredIds.size>200)deliveredIds.delete(deliveredIds.values().next().value!);
          event=resolved.event;data=resolved.data;markConnected(true);
        } catch { markConnected(false);return; }
      }
      if (channel.startsWith("user:")) invalidateReadCache();
      if (!cancelled) { try { eventRef.current(event,data); } catch { markConnected(false); } }
    };
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
              deliver(payload.event as string, payload.payload);
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
        try {
          // One shared connection per tab; a token is only requested when
          // this channel isn't already covered (lib/realtime/ablyShared.ts).
          const { acquireAblyChannel } = await import("./ablyShared");
          if (cancelled) return;
          const { client, release } = await acquireAblyChannel(channel);
          if (cancelled) {
            release();
            return;
          }
          // Connection-level state drives the poll back-off.
          const onState = (stateChange: { current: string }) => {
            markConnected(stateChange.current === "connected");
          };
          client.connection.on(onState);
          markConnected(client.connection.state === "connected");
          const ch = client.channels.get(channel);
          // Guard the message callback so events arriving in the brief window
          // between subscription and cleanup teardown never call into a
          // potentially unmounted component.
          const listener = (msg: { name: string; data: unknown }) => {
            if (!cancelled) deliver(msg.name, msg.data);
          };
          ch.subscribe(listener);

          cleanup = () => {
            ch.unsubscribe(listener);
            client.connection.off(onState);
            release();
          };
        } catch (err) {
          // Token refused or SDK failed to load: stay on the poll fallback.
          console.warn("[realtime] Ably unavailable; using poll fallback", err);
        }
      })();
    } else if (provider === "pusher") {
      const pusherKey = process.env.NEXT_PUBLIC_PUSHER_KEY;
      const pusherCluster = process.env.NEXT_PUBLIC_PUSHER_CLUSTER ?? "mt1";
      if (!pusherKey) return;

      // Convert channel name to Pusher private channel format — must match
      // the server publisher's mapping exactly (see pusherChannelName.ts).
      const pusherChannel = toPusherChannelName(channel);

      (async () => {
        const PusherLib = ((await import("pusher-js")) as any).default;
        if (cancelled) return;

        // Initialise the singleton on first use; reuse on subsequent mounts
        if (!pusherSingleton) {
          pusherSingleton = new PusherLib(pusherKey, {
            cluster: pusherCluster,
            channelAuthorization: {
              endpoint: "/api/realtime/pusher-auth",
              transport: "ajax",
              customHandler: (params:{socketId:string;channelName:string},callback:(error:Error|null,result:unknown)=>void) => {
                void authorizePusherChannel(params).then(result=>callback(null,result)).catch(error=>callback(error instanceof Error?error:new Error("Pusher authorization failed"),null));
              },
            },
          });
        }
        const pusher = pusherSingleton!;

        const sub = pusher.subscribe(pusherChannel);
        pusherReferences.set(pusherChannel, (pusherReferences.get(pusherChannel) ?? 0) + 1);
        const onState = (states: { current: string }) => {
          markConnected(states.current === "connected" && sub.subscribed);
        };
        const onSubscribed = () => markConnected(true);
        const onError = () => markConnected(false);
        const listener = (eventName: string, data: unknown) => {
          if (!eventName.startsWith("pusher:")) deliver(eventName, data);
        };
        pusher.connection.bind("state_change", onState);
        sub.bind("pusher:subscription_succeeded", onSubscribed);
        sub.bind("pusher:subscription_error", onError);
        sub.bind_global(listener);
        markConnected(pusher.connection.state === "connected" && sub.subscribed);
        cleanup = () => {
          pusher.connection.unbind("state_change", onState);
          sub.unbind("pusher:subscription_succeeded", onSubscribed);
          sub.unbind("pusher:subscription_error", onError);
          sub.unbind_global(listener);
          const count = (pusherReferences.get(pusherChannel) ?? 1) - 1;
          if (count <= 0) { pusherReferences.delete(pusherChannel); pusher.unsubscribe(pusherChannel); }
          else pusherReferences.set(pusherChannel, count);
        };
        if (cancelled) cleanup();
      })();
    }
    // If no provider is configured, this is a no-op — `connected` stays false
    // and the caller's fast baseline poll handles delivery.

    return () => {
      cancelled = true;
      setConnected(false);
      cleanup?.();
    };
  // The ref delivers fresh callbacks without resubscribing on each render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel]);

  return connected;
}
