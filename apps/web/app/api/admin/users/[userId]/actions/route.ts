/**
 * app/api/admin/users/[userId]/actions/route.ts
 *
 * Admin user action endpoint.
 *
 * POST /api/admin/users/[userId]/actions
 *   Admin-only (is_admin verified from DATABASE, not just JWT).
 *
 *   Supported actions:
 *     - suspend        : Temporarily suspend a user account
 *     - ban            : Permanently ban a user account
 *     - restore        : Lift a suspension or ban
 *     - upgrade_moderator   : Grant moderator role
 *     - downgrade_moderator : Revoke moderator role
 *
 *   All actions are logged to the admin_actions audit table.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withAdminAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, notFound, badRequest, conflict } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { invalidateAllSessions } from "@/lib/auth/session";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AdminUserParams {
  userId: string;
}

interface TargetUser {
  id: string;
  email: string | null;
  username: string | null;
  is_admin: boolean;
  is_suspended: boolean;
  is_banned: boolean;
  is_moderator: boolean;
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const actionSchema = z.object({
  action: z.enum([
    "suspend",
    "ban",
    "restore",
    "upgrade_moderator",
    "downgrade_moderator",
  ]),
  reason: z.string().max(1000).optional().nullable(),
  duration_hours: z
    .number()
    .int()
    .positive()
    .max(8760) // max 1 year
    .optional()
    .nullable(),
});

// ---------------------------------------------------------------------------
// POST /api/admin/users/[userId]/actions
// ---------------------------------------------------------------------------

/**
 * Perform a moderation action on a user account.
 *
 * All actions are atomic and logged to the admin_actions audit table.
 * Suspending/banning immediately invalidates all active sessions in Redis.
 *
 * @returns JSON { success: true, action, userId, appliedAt }
 */
export const POST = withAdminAuth<AdminUserParams>(async (req, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);

    const { userId } = params;
    const UUID_RE =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_RE.test(userId)) {
      throw badRequest("userId must be a valid UUID");
    }

    // Prevent admin from actioning themselves
    if (userId === auth.user.sub) {
      throw badRequest("You cannot perform moderation actions on your own account");
    }

    const body = await validateBody(req, actionSchema);

    // Validate duration_hours is provided when suspending
    if (body.action === "suspend" && !body.duration_hours) {
      throw badRequest("duration_hours is required for the 'suspend' action");
    }

    const result = await db.transaction(async (client) => {
      // Fetch target user (locked for update)
      const { rows } = await client.query<TargetUser>(
        `SELECT id, email, username, is_admin, is_suspended, is_banned, is_moderator
         FROM users
         WHERE id = $1 AND deleted_at IS NULL
         FOR UPDATE`,
        [userId]
      );

      const target = rows[0];
      if (!target) throw notFound("User not found");

      // Prevent actioning another admin
      if (target.is_admin) {
        throw badRequest("Cannot perform moderation actions on admin accounts");
      }

      let updateSql: string;
      let updateParams: (string | boolean | number | null)[];
      const appliedAt = new Date().toISOString();

      switch (body.action) {
        case "suspend": {
          if (target.is_banned) {
            throw conflict("User is already banned; use 'restore' first");
          }
          const suspendedUntil = new Date(
            Date.now() + (body.duration_hours! * 3600 * 1000)
          ).toISOString();

          updateSql = `UPDATE users
            SET is_suspended = true, suspended_until = $1, suspension_reason = $2, updated_at = NOW()
            WHERE id = $3`;
          updateParams = [suspendedUntil, body.reason ?? null, userId];
          break;
        }

        case "ban": {
          updateSql = `UPDATE users
            SET is_banned = true, is_suspended = false, suspended_until = NULL,
                ban_reason = $1, banned_at = NOW(), updated_at = NOW()
            WHERE id = $2`;
          updateParams = [body.reason ?? null, userId];
          break;
        }

        case "restore": {
          if (!target.is_suspended && !target.is_banned) {
            throw conflict("User is not suspended or banned");
          }
          updateSql = `UPDATE users
            SET is_suspended = false, is_banned = false,
                suspended_until = NULL, suspension_reason = NULL,
                ban_reason = NULL, banned_at = NULL, updated_at = NOW()
            WHERE id = $1`;
          updateParams = [userId];
          break;
        }

        case "upgrade_moderator": {
          if (target.is_moderator) {
            throw conflict("User is already a moderator");
          }
          updateSql = `UPDATE users SET is_moderator = true, updated_at = NOW() WHERE id = $1`;
          updateParams = [userId];
          break;
        }

        case "downgrade_moderator": {
          if (!target.is_moderator) {
            throw conflict("User is not a moderator");
          }
          updateSql = `UPDATE users SET is_moderator = false, updated_at = NOW() WHERE id = $1`;
          updateParams = [userId];
          break;
        }
      }

      await client.query(updateSql, updateParams);

      // Log the action to the audit table
      await client.query(
        `INSERT INTO admin_actions
           (admin_id, target_user_id, action, reason, duration_hours, created_at)
         VALUES ($1, $2, $3, $4, $5, NOW())`,
        [
          auth.user.sub,
          userId,
          body.action,
          body.reason ?? null,
          body.duration_hours ?? null,
        ]
      );

      return { target, appliedAt };
    });

    // Invalidate all sessions for suspended/banned users immediately
    // (outside transaction – Redis is not transactional with DB)
    if (body.action === "suspend" || body.action === "ban") {
      await invalidateAllSessions(userId).catch((err) => {
        console.error("[admin:actions] Failed to invalidate sessions", err);
      });
    }

    return NextResponse.json(
      {
        success: true,
        action: body.action,
        userId,
        appliedAt: result.appliedAt,
      },
      { status: 200 }
    );
  } catch (err) {
    return handleApiError(err);
  }
});
