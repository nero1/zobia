import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db/drizzle";

/** Re-check moderation/lifetime gates in addition to the caller's membership. */
export async function realtimeResourceActive(kind: "room" | "group", id: string, userId: string) {
  const db = await getDb();
  const result = kind === "room"
    ? await db.execute(sql`SELECT r.id FROM rooms r WHERE r.id=${id}
        AND r.deleted_at IS NULL AND r.status='active' AND r.is_active AND NOT r.is_banned AND NOT r.is_suspended
        AND (r.type<>'drop' OR r.drop_ends_at IS NULL OR r.drop_ends_at>NOW())
        AND (r.type<>'limited' OR r.created_at+(r.duration_minutes*INTERVAL '1 minute')>NOW())`)
    : await db.execute(sql`SELECT g.id FROM group_chats g WHERE g.id=${id}
        AND g.is_active AND NOT g.is_deactivated
        AND NOT EXISTS(SELECT 1 FROM group_chat_blocks b WHERE b.group_chat_id=g.id AND b.user_id=${userId})`);
  return result.rows.length > 0;
}
