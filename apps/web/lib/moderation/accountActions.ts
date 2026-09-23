/**
 * lib/moderation/accountActions.ts
 *
 * Shared account-moderation actions used by more than one admin surface —
 * currently just `restoreUserAccount`, which lifts a suspension/ban. Split
 * out of app/api/admin/users/[userId]/actions/route.ts's "restore" case so
 * the Account Appeals pipeline (app/api/admin/appeals/[appealId]/route.ts)
 * can approve an appeal by calling the exact same unban/unsuspend logic
 * instead of duplicating it.
 */

import type { DatabaseAdapter, TransactionClient } from "@/lib/db/interface";
import { conflict, notFound } from "@/lib/api/errors";

interface RestorableUser {
  id: string;
  is_suspended: boolean;
  is_banned: boolean;
}

/**
 * Lift a suspension or ban on a user account. Must run against a user row
 * already locked `FOR UPDATE` in the caller's transaction (mirrors the
 * pattern in the admin user-actions route) to avoid a race with a concurrent
 * moderation action.
 *
 * Does NOT log to `admin_actions` or call `revokeUserAccess` — callers do
 * that themselves since the audit reason/actor differs (a direct admin
 * action vs. an appeal approval).
 */
export async function restoreUserAccount(
  client: TransactionClient | DatabaseAdapter,
  userId: string
): Promise<void> {
  const { rows } = await client.query<RestorableUser>(
    `SELECT id, is_suspended, is_banned FROM users WHERE id = $1 FOR UPDATE`,
    [userId]
  );
  const target = rows[0];
  if (!target) throw notFound("User not found");
  if (!target.is_suspended && !target.is_banned) {
    throw conflict("User is not suspended or banned");
  }

  await client.query(
    `UPDATE users
     SET is_suspended = false, is_banned = false,
         suspended_until = NULL, suspension_reason = NULL,
         ban_reason = NULL, banned_at = NULL, updated_at = NOW()
     WHERE id = $1`,
    [userId]
  );
}
