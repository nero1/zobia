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

import { sql, eq } from "drizzle-orm";
import type { DbOrTx } from "@/lib/db/drizzle";
import { schema } from "@/lib/db/schema";
import { conflict, notFound } from "@/lib/api/errors";

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
export async function restoreUserAccount(client: DbOrTx, userId: string): Promise<void> {
  const rows = await client.execute(
    sql`SELECT id, is_suspended, is_banned FROM ${schema.users} WHERE id = ${userId} FOR UPDATE`
  );
  const target = rows.rows[0] as { id: string; is_suspended: boolean; is_banned: boolean } | undefined;
  if (!target) throw notFound("User not found");
  if (!target.is_suspended && !target.is_banned) {
    throw conflict("User is not suspended or banned");
  }

  await client
    .update(schema.users)
    .set({
      isSuspended: false,
      isBanned: false,
      suspendedUntil: null,
      suspensionReason: null,
      banReason: null,
      bannedAt: null,
      updatedAt: new Date(),
    })
    .where(eq(schema.users.id, userId));
}
