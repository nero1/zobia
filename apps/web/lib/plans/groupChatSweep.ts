/**
 * lib/plans/groupChatSweep.ts
 *
 * Group chat deactivation/reactivation tied to subscription grace periods.
 *
 * PRD: "group deactivated after grace period when the user's plan expires" —
 * i.e. NOT immediately on lapse (the grace period itself preserves access,
 * consistent with every other grace-gated feature), but once the grace
 * period elapses without renewal, unless the admin has opted to preserve
 * "group_chats" for that plan/tier (lib/plans/graceFeatures.ts registry).
 *
 * Called from lib/plans/subscriptionSweep.ts's grace->lapsed passes.
 */

import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db/drizzle";
import { logger } from "@/lib/logger";

/**
 * Deactivate every group chat the user created that is still active.
 * Idempotent — already-deactivated groups are left untouched.
 *
 * NOTE: `group_chats.is_deactivated` / `deactivated_at` / `deactivated_reason`
 * are not present on `schema.groupChats` in lib/db/schema.ts (schema/DB
 * mismatch — reported upstream), so this uses Drizzle's `sql` tag directly
 * rather than the query builder.
 */
export async function deactivateGroupsForUser(userId: string): Promise<number> {
  try {
    const orm = await getDb();
    const result = await orm.execute(sql`
      UPDATE group_chats
      SET is_deactivated = TRUE, deactivated_at = NOW(),
          deactivated_reason = 'grace_period_expired', updated_at = NOW()
      WHERE creator_id = ${userId} AND is_active = TRUE AND is_deactivated = FALSE
    `);
    return result.rowCount ?? 0;
  } catch (err) {
    logger.error({ err, userId }, "[groupChatSweep] deactivateGroupsForUser failed");
    return 0;
  }
}

type DeactivatedGroupRow = {
  id: string;
  name: string;
  avatar_emoji: string;
  member_count: number;
  deactivated_at: string;
};

/**
 * List a user's deactivated groups eligible for the renewal-time
 * reactivation prompt ("select/deselect each one separately").
 */
export async function listDeactivatedGroupsForUser(userId: string): Promise<DeactivatedGroupRow[]> {
  const orm = await getDb();
  const result = await orm.execute<DeactivatedGroupRow>(sql`
    SELECT gc.id, gc.name, gc.avatar_emoji, gc.member_count, gc.deactivated_at
    FROM group_chats gc
    WHERE gc.creator_id = ${userId} AND gc.is_active = TRUE AND gc.is_deactivated = TRUE
      AND NOT EXISTS (
        SELECT 1 FROM group_chat_reactivation_choices c
        WHERE c.group_chat_id = gc.id AND c.user_id = ${userId} AND c.reactivated = FALSE
      )
    ORDER BY gc.deactivated_at DESC
  `);
  return result.rows;
}
