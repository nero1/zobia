/**
 * lib/auth/roles.ts
 *
 * Shared role-check helper for routes that need to conditionally grant a
 * viewer extra visibility (e.g. a moderator/admin viewing another user's
 * Stats page or profile) without gating the entire route behind
 * `withModeratorOrAdminAuth`. Always re-checks the database — never trusts
 * a role claim from the JWT.
 */

import { db } from "@/lib/db";

/**
 * Returns true if the given user currently has `is_admin` or `is_moderator`
 * set. Fails closed (returns false) on a DB error so a transient failure
 * never silently grants elevated visibility.
 */
export async function isAdminOrModerator(userId: string): Promise<boolean> {
  try {
    const { rows } = await db.query<{ is_admin: boolean; is_moderator: boolean }>(
      `SELECT is_admin, is_moderator FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [userId]
    );
    return Boolean(rows[0]?.is_admin || rows[0]?.is_moderator);
  } catch {
    return false;
  }
}
