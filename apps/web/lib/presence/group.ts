/**
 * lib/presence/group.ts
 *
 * Group-chat-scoped live presence — mirrors lib/presence/room.ts exactly,
 * sharing the same Redis-backed admit/count/leave core (lib/presence/generic.ts)
 * under the `group:presence:` key prefix.
 *
 * This is the soft CONCURRENT cap ("max 20 concurrent users by default"),
 * separate from the hard total-membership cap enforced at join/add time
 * (group_chats.max_members). A user who cannot be admitted still remains a
 * member — they just can't have an active session in the group chat right now.
 */

import { admitPresence, getPresenceCount, leavePresence } from "@/lib/presence/generic";

function groupPresenceKey(groupId: string): string {
  return `group:presence:${groupId}`;
}

/**
 * Atomically prune stale entries, admit the user if allowed, and return the
 * resulting live count. Group admins/creator bypass the cap (privileged).
 */
export async function admitGroupPresence(
  groupId: string,
  userId: string,
  cap: number,
  privileged: boolean,
): Promise<{ admitted: boolean; count: number }> {
  return admitPresence(groupPresenceKey(groupId), userId, cap, privileged, "presence:group");
}

/** Read the current live presence count for a group, pruning stale entries first. */
export async function getGroupPresenceCount(groupId: string): Promise<number> {
  return getPresenceCount(groupPresenceKey(groupId), "presence:group");
}

/** Remove a user from a group's live presence (explicit leave / navigate away). */
export async function leaveGroupPresence(groupId: string, userId: string): Promise<void> {
  return leavePresence(groupPresenceKey(groupId), userId, "presence:group");
}
