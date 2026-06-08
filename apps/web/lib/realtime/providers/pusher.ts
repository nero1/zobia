/**
 * lib/realtime/providers/pusher.ts
 *
 * Pusher server-side publisher using the Pusher Events HTTP API.
 * No npm package required — uses native fetch + Node.js crypto for HMAC signing.
 *
 * Required env vars:
 *   PUSHER_APP_ID      — App ID (numeric string) from the Pusher dashboard
 *   PUSHER_KEY         — App Key (public identifier)
 *   PUSHER_SECRET      — App Secret (never expose to clients)
 *   PUSHER_CLUSTER     — Region cluster (e.g. "eu", "us2", "ap2", "mt1")
 *
 * Reference: https://pusher.com/docs/channels/library_auth_reference/rest-api/
 */

import { createHash, createHmac } from "node:crypto";
import { env } from "@/lib/env";
import type { RealtimeProvider } from "../interface";

export class PusherProvider implements RealtimeProvider {
  async publish(channel: string, event: string, data: unknown): Promise<void> {
    const { PUSHER_APP_ID, PUSHER_KEY, PUSHER_SECRET, PUSHER_CLUSTER } = env;

    if (!PUSHER_APP_ID || !PUSHER_KEY || !PUSHER_SECRET || !PUSHER_CLUSTER) {
      throw new Error(
        "PUSHER_APP_ID, PUSHER_KEY, PUSHER_SECRET and PUSHER_CLUSTER are all required " +
          "when REALTIME_PROVIDER=pusher"
      );
    }

    const body = JSON.stringify({
      name: event,
      channel,
      data: JSON.stringify(data),
    });

    const timestamp = Math.floor(Date.now() / 1000).toString();
    const path = `/apps/${PUSHER_APP_ID}/events`;

    const md5Body = createHash("md5").update(body).digest("hex");

    const queryString =
      `auth_key=${PUSHER_KEY}` +
      `&auth_timestamp=${timestamp}` +
      `&auth_version=1.0` +
      `&body_md5=${md5Body}`;

    const toSign = ["POST", path, queryString].join("\n");

    const authSignature = createHmac("sha256", PUSHER_SECRET)
      .update(toSign)
      .digest("hex");

    const url =
      `https://api-${PUSHER_CLUSTER}.pusher.com${path}` +
      `?${queryString}&auth_signature=${authSignature}`;

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "(no body)");
      throw new Error(`Pusher Events API publish failed: ${res.status} ${text}`);
    }
  }
}
