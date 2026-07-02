"use client";

/**
 * components/presence/PresenceHeartbeatProvider.tsx
 *
 * Client component that mounts the app-wide presence heartbeat.
 * Add once to the authenticated app layout — see usePresenceHeartbeat.ts
 * for why this exists.
 */

import { usePresenceHeartbeat } from "@/lib/presence/usePresenceHeartbeat";

export function PresenceHeartbeatProvider() {
  usePresenceHeartbeat();
  return null;
}
