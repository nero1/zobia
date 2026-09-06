/**
 * lib/support/staffAuth.ts
 *
 * Support-ticket-queue authorization. Neither withAdminAuth (admin-only) nor
 * withModeratorOrAdminAuth (mod-or-admin) covers the new "support" role, and
 * which roles may staff the queue is itself admin-configurable
 * (x_manifest `support_staff_roles`), so this re-checks fresh from the DB on
 * every call — same fail-closed convention as isAdminOrModerator.
 */

import { getStaffRoles, hasAnyRole, type StaffRoles } from "@/lib/auth/roles";
import { loadManifest } from "@/lib/manifest";
import { forbidden } from "@/lib/api/errors";

/**
 * Throws a 403 ApiError unless the user's DB-confirmed roles intersect the
 * admin-configured `support_staff_roles` allow-list. Returns the confirmed
 * roles on success so callers can further branch (e.g. escalation rules).
 */
export async function requireSupportStaff(userId: string): Promise<StaffRoles> {
  const [roles, manifest] = await Promise.all([getStaffRoles(userId), loadManifest()]);
  if (!hasAnyRole(roles, manifest.support.staffRoles)) {
    throw forbidden("You are not authorized to access the support ticket queue.", "SUPPORT_STAFF_ONLY");
  }
  return roles;
}
