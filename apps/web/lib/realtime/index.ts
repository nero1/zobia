/**
 * lib/realtime/index.ts
 *
 * Realtime event publisher — provider-native architecture.
 *
 * Architecture:
 *   Server makes a fast, stateless HTTP call to the configured provider's
 *   REST API after saving each message. The provider (Ably / Pusher /
 *   Supabase Realtime) handles persistent WebSocket connections to clients.
 *   No Redis Pub/Sub. No SSE through Vercel functions.
 *
 * Client-side subscription:
 *   Browser and Expo clients connect directly to the provider using its
 *   native SDK. See lib/realtime/useRealtimeChannel.ts for the web hook.
 *
 * Usage:
 *   import { publishRealtimeEvent } from "@/lib/realtime";
 *   await publishRealtimeEvent("dm:conversation:uuid", "new_message", { message });
 */

import { env } from "@/lib/env";
import type { RealtimeProvider } from "./interface";

// BUG-RT-06: module-level singleton so the same provider instance (and its
// underlying connection/REST client) is reused across multiple publishRealtimeEvent
// calls within the same server process / Lambda warm instance.
let _providerInstance: RealtimeProvider | null | undefined; // undefined = not yet initialised

async function getProvider(): Promise<RealtimeProvider | null> {
  if (_providerInstance !== undefined) return _providerInstance;

  switch (env.REALTIME_PROVIDER) {
    case "ably": {
      const { AblyProvider } = await import("./providers/ably");
      _providerInstance = new AblyProvider();
      break;
    }
    case "pusher": {
      const { PusherProvider } = await import("./providers/pusher");
      _providerInstance = new PusherProvider();
      break;
    }
    case "supabase-realtime": {
      const { SupabaseRealtimeProvider } = await import(
        "./providers/supabase-realtime"
      );
      _providerInstance = new SupabaseRealtimeProvider();
      break;
    }
    default:
      _providerInstance = null;
  }

  return _providerInstance;
}

/**
 * Publish a realtime event to all subscribers on a channel.
 *
 * Never throws — failures are logged and swallowed so that message delivery
 * is never blocked by a realtime infrastructure issue.
 *
 * @param channel - Channel identifier (e.g. "dm:conversation:<uuid>")
 * @param event   - Event name (e.g. "new_message")
 * @param data    - Arbitrary JSON payload delivered to subscribers
 */
export async function publishRealtimeEvent(
  channel: string,
  event: string,
  data: unknown
): Promise<void> {
  try {
    const provider = await getProvider();
    if (provider) {
      await provider.publish(channel, event, data);
    }
  } catch (err) {
    console.error("[realtime] Provider publish failed", err);
  }
}
