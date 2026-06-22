/**
 * lib/notifications/chatPush.ts
 *
 * Thin chat-aware wrappers over the Expo push sender. These are called from the
 * message POST routes (DM, group, room) to deliver pushes to recipients who are
 * NOT currently active in the app — they already get the message over realtime/
 * poll, so pushing them would be redundant noise and avoidable cost.
 *
 * Scope (per product decision):
 *   - DMs:   push the other participant.
 *   - Groups: push every member except the sender.
 *   - Rooms: push ONLY users who were @mentioned (never the whole room).
 *
 * All functions are fire-and-forget: callers should `void` them so a push
 * failure never blocks or delays message delivery.
 */

import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { sendPushNotification, sendPushNotificationBatch } from "@/lib/notifications/push";
import { presenceRedisKey } from "@/lib/presence/keys";
import { redis } from "@/lib/redis";

/**
 * Per-category push preference columns on the `users` table. Each chat surface
 * checks its own column so users can mute DMs, group messages, and room
 * @mentions independently. Whitelisted here — never interpolate arbitrary input.
 */
type PushPrefColumn = "dm_notifications" | "group_notifications" | "room_mention_notifications";

/** Trim a message body to a sensible push-preview length. */
function preview(text: string | null | undefined, max = 140): string {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  if (!t) return "Sent a message";
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/**
 * Resolve the recipients eligible for a push: those who (a) have the relevant
 * category toggle enabled and (b) are not currently online. One DB round-trip
 * for the preference filter, then the per-user online check.
 */
async function eligibleRecipients(
  userIds: string[],
  prefColumn: PushPrefColumn,
): Promise<string[]> {
  if (userIds.length === 0) return [];
  const { rows } = await db.query<{ id: string }>(
    `SELECT id FROM users
     WHERE id = ANY($1) AND deleted_at IS NULL AND COALESCE(${prefColumn}, true) = true`,
    [userIds],
  );
  const allowed = rows.map((r) => r.id);
  if (allowed.length === 0) return [];

  // BUG-PERF-02: batch presence check via Redis pipeline — O(1) round trips
  // instead of one EXISTS call per user.
  let offlineIds: string[] = allowed;
  try {
    const pipeline = redis.pipeline();
    for (const id of allowed) pipeline.exists(presenceRedisKey(id));
    const results = await pipeline.exec();
    offlineIds = allowed.filter((_, i) => {
      const tuple = (results?.[i] ?? [null, 0]) as [Error | null, number];
      const [err, count] = tuple;
      return !err && count === 0;
    });
  } catch {
    // Redis unavailable — fail open (send to all pref-enabled users)
  }
  return offlineIds;
}

/** Push a DM to the recipient if they are offline and have DM pushes enabled. */
export async function notifyDirectMessage(opts: {
  recipientId: string;
  senderName: string;
  text: string | null;
  conversationId: string;
}): Promise<void> {
  try {
    const [eligible] = await eligibleRecipients([opts.recipientId], "dm_notifications");
    if (!eligible) return;
    await sendPushNotification(opts.recipientId, opts.senderName, preview(opts.text), {
      action: `/messages/${opts.conversationId}`,
      priority: "high",
      data: { type: "dm", conversationId: opts.conversationId },
    });
  } catch (err) {
    logger.error({ err }, "[chatPush] DM push failed");
  }
}

/** Push a group message to all offline members except the sender. */
export async function notifyGroupMessage(opts: {
  memberIds: string[];
  senderId: string;
  senderName: string;
  groupName: string;
  text: string | null;
  groupId: string;
}): Promise<void> {
  try {
    const recipients = await eligibleRecipients(
      opts.memberIds.filter((id) => id !== opts.senderId),
      "group_notifications",
    );
    if (recipients.length === 0) return;
    const body = `${opts.senderName}: ${preview(opts.text)}`;
    await sendPushNotificationBatch(
      recipients.map((userId) => ({
        userId,
        title: opts.groupName,
        body,
        priority: "high" as const,
        data: { type: "group", groupId: opts.groupId },
      })),
    );
  } catch (err) {
    logger.error({ err }, "[chatPush] group push failed");
  }
}

/** Push to @mentioned users in a room (offline only). Never the whole room. */
export async function notifyRoomMentions(opts: {
  mentionedUserIds: string[];
  senderName: string;
  roomName: string;
  text: string | null;
  roomId: string;
}): Promise<void> {
  try {
    const recipients = await eligibleRecipients(opts.mentionedUserIds, "room_mention_notifications");
    if (recipients.length === 0) return;
    const body = `${opts.senderName} mentioned you: ${preview(opts.text)}`;
    await sendPushNotificationBatch(
      recipients.map((userId) => ({
        userId,
        title: opts.roomName,
        body,
        priority: "high" as const,
        data: { type: "room", roomId: opts.roomId },
      })),
    );
  } catch (err) {
    logger.error({ err }, "[chatPush] room mention push failed");
  }
}

/**
 * Extract `@username` tokens from message text (lowercased, de-duplicated).
 * Usernames are matched as 3–30 chars of [a-z0-9_], per typical handle rules.
 */
export function parseMentions(text: string | null | undefined): string[] {
  if (!text) return [];
  const matches = text.matchAll(/(?:^|[^a-zA-Z0-9_])@([a-zA-Z0-9_]{3,30})/g);
  const set = new Set<string>();
  for (const m of matches) set.add(m[1].toLowerCase());
  return [...set];
}
