/**
 * lib/realtime/index.ts
 *
 * Realtime event publisher.
 *
 * Architecture:
 *   1. All events are published to Redis Pub/Sub first.
 *      The /api/realtime/sse endpoint subscribes to Redis and streams events
 *      to browser clients via Server-Sent Events — no provider SDK needed
 *      in the browser.
 *
 *   2. Events are also fanned out to the configured external provider
 *      (Ably / Pusher / Supabase Realtime) as a best-effort side-effect.
 *      This lets Expo (React Native) clients subscribe natively via the
 *      provider's mobile SDK.
 *
 * Usage:
 *   import { publishRealtimeEvent } from "@/lib/realtime";
 *   await publishRealtimeEvent("dm:conversation:uuid", "new_message", { message });
 */

import IORedis from "ioredis";
import { env } from "@/lib/env";
import type { RealtimeProvider } from "./interface";

// ---------------------------------------------------------------------------
// Dedicated Redis PUBLISH client
// ---------------------------------------------------------------------------

let _pubClient: IORedis | null = null;

function getPubClient(): IORedis {
  if (_pubClient) return _pubClient;

  _pubClient = new IORedis(env.REDIS_URL, {
    maxRetriesPerRequest: 2,
    lazyConnect: false,
    connectTimeout: 8_000,
    retryStrategy: (times) => Math.min(times * 200, 5_000),
  });

  _pubClient.on("error", (err) =>
    console.error("[realtime:pub] Redis error", err)
  );

  return _pubClient;
}

// ---------------------------------------------------------------------------
// External provider (optional fan-out for native mobile clients)
// ---------------------------------------------------------------------------

async function getExternalProvider(): Promise<RealtimeProvider | null> {
  switch (env.REALTIME_PROVIDER) {
    case "ably": {
      const { AblyProvider } = await import("./providers/ably");
      return new AblyProvider();
    }
    case "pusher": {
      const { PusherProvider } = await import("./providers/pusher");
      return new PusherProvider();
    }
    case "supabase-realtime": {
      const { SupabaseRealtimeProvider } = await import(
        "./providers/supabase-realtime"
      );
      return new SupabaseRealtimeProvider();
    }
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Publish a realtime event to all subscribers on a channel.
 *
 * This function never throws — failures are logged and swallowed so that
 * message delivery is never blocked by a realtime infrastructure issue.
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
  const payload = JSON.stringify({ event, data });

  // 1. Redis Pub/Sub — consumed by the SSE bridge at /api/realtime/sse
  try {
    await getPubClient().publish(channel, payload);
  } catch (err) {
    console.error("[realtime] Redis PUBLISH failed", err);
  }

  // 2. External provider — best-effort fan-out for mobile clients
  try {
    const provider = await getExternalProvider();
    if (provider) {
      await provider.publish(channel, event, data);
    }
  } catch (err) {
    console.error("[realtime] External provider publish failed", err);
  }
}
