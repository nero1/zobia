import { prepareRealtimeEvent } from "../protectedEvents";
/**
 * lib/realtime/providers/ably.ts
 *
 * Ably server-side publisher using the Ably REST API.
 * No npm package required — uses native fetch.
 *
 * Requires env var: ABLY_API_KEY
 *
 * Which Ably key to use:
 *   Option A (recommended): Create a dedicated API key in the Ably dashboard with
 *     "Publish" + "Subscribe" capabilities scoped to channels you use.
 *     Ably Console → Apps → API Keys → Add Key → set capabilities.
 *   Option B: Use the Root key for simplicity (it has all capabilities).
 *   Never use a "Subscribe only" key server-side — it can't publish.
 */

import { env } from "@/lib/env";
import type { RealtimeProvider } from "../interface";

export class AblyProvider implements RealtimeProvider {
  async publish(channel: string, event: string, data: unknown): Promise<void> {
    const apiKey = env.ABLY_API_KEY;
    if (!apiKey) {
      throw new Error("ABLY_API_KEY is required when REALTIME_PROVIDER=ably");
    }

    const prepared = await prepareRealtimeEvent(channel,event,data);
    const encodedChannel = encodeURIComponent(channel);
    const res = await fetch(
      `https://rest.ably.io/channels/${encodedChannel}/messages`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Basic ${Buffer.from(apiKey).toString("base64")}`,
        },
        body: JSON.stringify({ name: prepared.event, data: JSON.stringify(prepared.data) }),
        signal: AbortSignal.timeout(4000),
      }
    );

    await res.body?.cancel().catch(()=>{});
    if (!res.ok) {
      throw new Error(`Ably REST publish failed: ${res.status}`);
    }
  }
}
