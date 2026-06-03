"use client";

/**
 * components/offline/OfflineSyncProvider.tsx
 *
 * Client component that mounts the offline message queue sync hook.
 * Add once to the authenticated app layout.
 */

import { useOfflineSync } from "@/lib/offline/useOfflineSync";

export function OfflineSyncProvider() {
  useOfflineSync();
  return null;
}
