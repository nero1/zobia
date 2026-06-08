/**
 * lib/realtime/interface.ts
 *
 * Common interface for external realtime providers (Ably, Pusher, Supabase Realtime).
 * The interface is kept intentionally minimal — the app only needs server-side
 * publishing.  Client subscription is handled by the SSE bridge at
 * /api/realtime/sse (which reads from Redis Pub/Sub, not from providers directly).
 */

export interface RealtimeProvider {
  /**
   * Publish an event to a named channel.
   *
   * @param channel - Provider-specific channel name (e.g. "dm:conversation:uuid")
   * @param event   - Event name within the channel (e.g. "new_message")
   * @param data    - Arbitrary JSON-serialisable payload
   */
  publish(channel: string, event: string, data: unknown): Promise<void>;
}
