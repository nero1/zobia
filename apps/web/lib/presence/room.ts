/**
 * lib/presence/room.ts
 *
 * Room-scoped live presence backed by Redis (zero realtime-provider cost).
 *
 * Each room has a Redis sorted set `room:presence:<roomId>` whose members are
 * userIds and whose scores are the last-heartbeat timestamp (ms). Clients send
 * a heartbeat every ~45s while actively viewing a room; an entry older than
 * PRESENCE_TTL_MS is considered gone (tab/app closed, network lost, idle), so
 * a slot frees up automatically with NO explicit "Leave" action.
 *
 * This is what soft participant caps are enforced against — "who is here right
 * now", not DB membership (which persists). Admission is atomic via a Lua
 * script so concurrent joiners can never both slip past a full room.
 *
 * The actual admit/count/leave mechanics live in lib/presence/generic.ts,
 * shared with Group Chats (lib/presence/group.ts) under a different key
 * prefix — this module just supplies the `room:presence:` scoping.
 */

import { admitPresence, getPresenceCount, leavePresence, PRESENCE_TTL_MS as GENERIC_PRESENCE_TTL_MS } from "@/lib/presence/generic";

/** A presence entry is stale once it has not been refreshed for this long. */
export const PRESENCE_TTL_MS = GENERIC_PRESENCE_TTL_MS;

function roomPresenceKey(roomId: string): string {
  return `room:presence:${roomId}`;
}

/**
 * Atomically prune stale entries, admit the user if allowed, and return the
 * resulting live count.
 *
 * Admission rule (soft cap): a user is admitted if they are already present
 * (re-heartbeat), OR they are privileged (creator/mod/etc.), OR the live count
 * is below `cap`. Otherwise the room is full and they are not added.
 *
 * @returns `{ admitted, count }` — count reflects the set after any add.
 */
export async function admitRoomPresence(
  roomId: string,
  userId: string,
  cap: number,
  privileged: boolean,
): Promise<{ admitted: boolean; count: number }> {
  return admitPresence(roomPresenceKey(roomId), userId, cap, privileged, "presence:room");
}

/**
 * Read the current live presence count for a room, pruning stale entries first.
 * Read-only with respect to membership (does not add the caller).
 */
export async function getRoomPresenceCount(roomId: string): Promise<number> {
  return getPresenceCount(roomPresenceKey(roomId), "presence:room");
}

/** Remove a user from a room's live presence (explicit leave / navigate away). */
export async function leaveRoomPresence(roomId: string, userId: string): Promise<void> {
  return leavePresence(roomPresenceKey(roomId), userId, "presence:room");
}
