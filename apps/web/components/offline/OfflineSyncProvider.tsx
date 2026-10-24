"use client";

/**
 * components/offline/OfflineSyncProvider.tsx
 *
 * Client component that mounts the offline message queue sync hook.
 * Add once to the authenticated app layout.
 */

import { useOfflineSync } from "@/lib/offline/useOfflineSync";

import { useCurrentUserId } from "@/lib/hooks/useCurrentUserId";

export function OfflineSyncProvider() {
  const ownerId=useCurrentUserId();
  useOfflineSync(ownerId??null);
  return null;
}
