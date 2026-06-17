/**
 * lib/rooms/capacity.ts
 *
 * Resolves the effective soft participant cap for a room.
 *
 * Precedence:
 *   1. The room's own `max_members` (if set) — this is the per-room override,
 *      raised by the creator via a paid capacity upgrade or set by an admin.
 *   2. Otherwise the manifest default for the room's type.
 *
 * Caps are enforced against live presence (see lib/presence/room.ts), so they
 * directly bound realtime fan-out cost.
 */

import type { ZobiaManifest } from "@/lib/manifest";

export type RoomTypeKey = keyof ZobiaManifest["roomCaps"];

/**
 * Effective cap for a room.
 *
 * @param roomType       - The room's type column value.
 * @param roomMaxMembers - The room's `max_members` column (null = no override).
 * @param manifest       - The current manifest (for type defaults).
 */
export function resolveRoomCap(
  roomType: string,
  roomMaxMembers: number | null,
  manifest: ZobiaManifest,
): number {
  if (typeof roomMaxMembers === "number" && roomMaxMembers > 0) {
    return roomMaxMembers;
  }
  const caps = manifest.roomCaps;
  return (caps as Record<string, number>)[roomType] ?? caps.free_open;
}
