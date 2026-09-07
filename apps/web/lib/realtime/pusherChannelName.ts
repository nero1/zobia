/**
 * lib/realtime/pusherChannelName.ts
 *
 * Maps a provider-agnostic realtime channel id (e.g. "dm:conversation:<uuid>",
 * "room:<uuid>:messages", "group:<uuid>:messages", "user:<uuid>") to a valid
 * Pusher channel name.
 *
 * Pusher channel names may only contain [A-Za-z0-9_\-=@,.;] — colons are
 * rejected outright (both by the client SDK and the server Events API), so
 * every ":" is replaced with "-". All our channels require authenticated
 * subscription, so the result is always prefixed "private-".
 *
 * This is the single source of truth for the mapping — both the server
 * publisher (lib/realtime/providers/pusher.ts) and the client subscriber
 * (lib/realtime/useRealtimeChannel.ts) must use it so the names always
 * agree. app/api/realtime/pusher-auth/route.ts parses this same shape back
 * apart to authorize the subscription.
 */
export function toPusherChannelName(channel: string): string {
  return `private-${channel.replace(/:/g, "-")}`;
}
