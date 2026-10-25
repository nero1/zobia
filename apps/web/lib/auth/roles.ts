/**
 * lib/auth/roles.ts
 *
 * Shared role-check helper for routes that need to conditionally grant a
 * viewer extra visibility (e.g. a moderator/admin viewing another user's
 * Stats page or profile) without gating the entire route behind
 * `withModeratorOrAdminAuth`. Always re-checks the database — never trusts
 * a role claim from the JWT.
 */

import { requestContext } from "@/lib/logger";
import { eq, and, isNull, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";

/**
 * Returns true if the given user currently has `is_admin` or `is_moderator`
 * set. Fails closed (returns false) on a DB error so a transient failure
 * never silently grants elevated visibility.
 */
export async function isAdminOrModerator(userId: string): Promise<boolean> {
  const roles = await getStaffRoles(userId, { requireAdminSession: true });
  return roles.isAdmin || roles.isModerator;
}

/** A user's confirmed (DB-verified) staff roles. */
export interface StaffRoles {
  isAdmin: boolean;
  isModerator: boolean;
  /** Sitewide "support" role — grantable like moderator (0001_consolidated_schema.sql). */
  isSupport: boolean;
  /** Any support/moderator/admin user additionally flagged senior support. */
  isSeniorSupport: boolean;
  /** Reviews AI-escalated ad creative images at /gate44/ads/moderation-queue. A narrower role than full moderator/admin. */
  isAdModerator: boolean;
}

const EMPTY_STAFF_ROLES: StaffRoles = {
  isAdmin: false,
  isModerator: false,
  isSupport: false,
  isSeniorSupport: false,
  isAdModerator: false,
};

/**
 * Returns a user's confirmed staff roles, always re-read from the database.
 * Fails closed (all false) on any DB error — never trust a cached/JWT claim
 * for role-gated access.
 */
export async function getStaffRoles(
  userId: string,
  options: { requireAdminSession?: boolean } = {},
): Promise<StaffRoles> {
  try {
    const orm = await getDb();
    // NOTE (schema gap): `is_ad_moderator` (db/migrations/0002_ai_vision_and_ad_moderator.sql)
    // has no corresponding column in lib/db/schema.ts's `users` pgTable, so it
    // can't be selected via the query builder — pulled in via a raw `sql`
    // fragment alongside the builder-selected columns, still through the
    // shared Drizzle-wrapped pg.Pool and still fully parameterised.
    const rows = await orm
      .select({
        isAdmin: schema.users.isAdmin,
        totpEnabled: schema.users.totpEnabled,
        isModerator: schema.users.isModerator,
        isSupport: schema.users.isSupport,
        isSeniorSupport: schema.users.isSeniorSupport,
        isAdModerator: sql<boolean>`${schema.users}.is_ad_moderator`,
      })
      .from(schema.users)
      .where(
        and(
          eq(schema.users.id, userId),
          isNull(schema.users.deletedAt),
          eq(schema.users.isBanned, false),
          sql`NOT (COALESCE(${schema.users.isSuspended}, false) AND (${schema.users.suspendedUntil} IS NULL OR ${schema.users.suspendedUntil} > NOW()))`,
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row) return EMPTY_STAFF_ROLES;
    const context = requestContext.getStore();
    // Enforce the current account's opt-in 2FA policy for staff visibility.
    // Background work and role lookups for escalation targets are unaffected.
    if (
      options.requireAdminSession &&
      row.isAdmin &&
      context?.userId === userId &&
      (context.adminImpersonated === true ||
        (row.totpEnabled !== false && context.adminSessionVerified !== true))
    )
      return EMPTY_STAFF_ROLES;
    return {
      isAdmin: Boolean(row.isAdmin),
      isModerator: Boolean(row.isModerator),
      isSupport: Boolean(row.isSupport),
      isSeniorSupport: Boolean(row.isSeniorSupport),
      isAdModerator: Boolean(row.isAdModerator),
    };
  } catch {
    return EMPTY_STAFF_ROLES;
  }
}

/** Returns true if the given user currently has `is_admin` or `is_ad_moderator` set. Fails closed on DB error. */
export async function isAdminOrAdModerator(userId: string): Promise<boolean> {
  const roles = await getStaffRoles(userId, { requireAdminSession: true });
  return roles.isAdmin || roles.isAdModerator;
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
