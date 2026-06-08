/**
 * lib/realtime/providers/supabase-realtime.ts
 *
 * Supabase Realtime Broadcast server-side publisher.
 * Uses the Realtime REST broadcast endpoint (no @supabase/supabase-js required).
 *
 * Required env vars (when REALTIME_PROVIDER=supabase-realtime):
 *   SUPABASE_URL              — e.g. https://abcdef.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY — service_role secret (never expose to clients)
 *
 * Note: If DATABASE_PROVIDER=supabase, the Supabase project URL can be derived
 * from DATABASE_URL, but providing SUPABASE_URL explicitly is safer.
 *
 * How it works:
 *   - Server publishes to a Broadcast channel after each DM is saved.
 *   - Clients (web via SSE bridge, Expo via @supabase/supabase-js) subscribe to
 *     the channel and receive events in real time.
 *   - Supabase Postgres Changes (CDC) is NOT used here because auth is
 *     platform-managed (not Supabase Auth), which makes RLS/JWT verification
 *     on Postgres Changes subscriptions more complex.
 */

import { env } from "@/lib/env";
import type { RealtimeProvider } from "../interface";

export class SupabaseRealtimeProvider implements RealtimeProvider {
  async publish(channel: string, event: string, data: unknown): Promise<void> {
    const supabaseUrl = env.SUPABASE_URL;
    const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceKey) {
      // Graceful no-op: if env vars aren't configured the web SSE bridge
      // (Redis Pub/Sub) still delivers messages to web clients.
      return;
    }

    const res = await fetch(`${supabaseUrl}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({
        messages: [{ topic: channel, event, payload: data }],
      }),
    });

    // Supabase returns 204 on success, sometimes 200
    if (!res.ok && res.status !== 204) {
      const text = await res.text().catch(() => "(no body)");
      throw new Error(`Supabase Realtime broadcast failed: ${res.status} ${text}`);
    }
  }
}
