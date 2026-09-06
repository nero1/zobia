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
  const roles = await getStaffRoles(userId);
  return roles.isAdmin || roles.isModerator;
}

/** A user's confirmed (DB-verified) staff roles. */
export interface StaffRoles {
  isAdmin: boolean;
  isModerator: boolean;
  /** Sitewide "support" role — grantable like moderator (0033_support_tickets.sql). */
  isSupport: boolean;
  /** Any support/moderator/admin user additionally flagged senior support. */
  isSeniorSupport: boolean;
}

const EMPTY_STAFF_ROLES: StaffRoles = {
  isAdmin: false,
  isModerator: false,
  isSupport: false,
  isSeniorSupport: false,
};

/**
 * Returns a user's confirmed staff roles, always re-read from the database.
 * Fails closed (all false) on any DB error — never trust a cached/JWT claim
 * for role-gated access.
 */
export async function getStaffRoles(userId: string): Promise<StaffRoles> {
  try {
    const { rows } = await db.query<{
      is_admin: boolean;
      is_moderator: boolean;
      is_support: boolean;
      is_senior_support: boolean;
    }>(
      `SELECT is_admin, is_moderator, is_support, is_senior_support
       FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [userId]
    );
    const row = rows[0];
    if (!row) return EMPTY_STAFF_ROLES;
    return {
      isAdmin: Boolean(row.is_admin),
      isModerator: Boolean(row.is_moderator),
      isSupport: Boolean(row.is_support),
      isSeniorSupport: Boolean(row.is_senior_support),
    };
  } catch {
    return EMPTY_STAFF_ROLES;
  }
}

/**
 * Checks a user's confirmed roles against an admin-configured allow-list of
 * role names (e.g. x_manifest `support_staff_roles`: `["support","moderator","admin"]`).
 * An admin always passes regardless of the list (admins can always reach any
 * staff-gated surface).
 */
export function hasAnyRole(roles: StaffRoles, allowed: string[]): boolean {
  if (roles.isAdmin) return true;
  if (allowed.includes("admin") && roles.isAdmin) return true;
  if (allowed.includes("moderator") && roles.isModerator) return true;
  if (allowed.includes("support") && roles.isSupport) return true;
  return false;
}
