/**
 * lib/groupChats/capacity.ts
 *
 * Resolves the effective soft CONCURRENT-presence cap for a group chat.
 * Mirrors lib/rooms/capacity.ts exactly.
 *
 * Precedence:
 *   1. The group's own `concurrent_cap` (if set) — raised via a paid
 *      capacity upgrade (POST /api/messages/group/[groupId]/capacity).
 *   2. Otherwise the manifest default (manifest.groupChatCaps.concurrentDefault).
 *
 * This is distinct from `group_chats.max_members`, the hard TOTAL
 * MEMBERSHIP cap enforced when adding members.
 */

import type { ZobiaManifest } from "@/lib/manifest";

export function resolveGroupConcurrentCap(
  concurrentCap: number | null,
  manifest: ZobiaManifest,
): number {
  if (typeof concurrentCap === "number" && concurrentCap > 0) {
    return concurrentCap;
  }
  return manifest.groupChatCaps.concurrentDefault;
}
