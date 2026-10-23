/** Channels containing private user or membership-restricted payloads. */
export function isProtectedRealtimeChannel(channel: string): boolean {
  return /^(room|dm|group|user):/.test(channel);
}
