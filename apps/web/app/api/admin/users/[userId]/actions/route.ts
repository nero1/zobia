export const dynamic = 'force-dynamic';

/**
 * app/api/admin/users/[userId]/actions/route.ts
 *
 * Admin user action endpoint.
 *
 * POST /api/admin/users/[userId]/actions
 *   Admin-only (is_admin verified from DATABASE, not just JWT).
 *
 *   Supported actions:
 *     - suspend              : Temporarily suspend a user account
 *     - ban                  : Permanently ban a user account
 *     - restore              : Lift a suspension or ban
 *     - upgrade_moderator    : Grant moderator role
 *     - downgrade_moderator  : Revoke moderator role
 *     - reset_password       : Invalidate password + email a reset link (PRD §20)
 *     - force_2fa            : Require 2FA setup on next login (PRD §20)
 *     - verify_account       : Manually mark account email as verified (PRD §20)
 *
 *   All actions are logged to the admin_actions audit table.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { randomBytes } from "crypto";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { withAdminAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, notFound, badRequest, conflict } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { invalidateAllSessions } from "@/lib/auth/session";
import { sendEmail } from "@/lib/notifications/email";

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
  email_verified: boolean;
  require_2fa_setup: boolean;
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
    "reset_password",
    "force_2fa",
    "verify_account",
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
        `SELECT id, email, username, is_admin, is_suspended, is_banned, is_moderator,
                COALESCE(is_email_verified, false) AS email_verified,
                COALESCE(require_2fa_setup, false) AS require_2fa_setup
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

        case "reset_password": {
          // Null out the password hash so the account cannot log in with password,
          // then create a one-time reset token and email it to the user (PRD §20).
          const resetToken = randomBytes(32).toString("hex");
          const tokenExpiry = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour

          await client.query(
            `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at, created_at)
             VALUES ($1, encode(sha256($2::bytea), 'hex'), $3, NOW())
             ON CONFLICT (user_id) DO UPDATE
               SET token_hash = encode(sha256($2::bytea), 'hex'),
                   expires_at = $3,
                   used_at = NULL,
                   created_at = NOW()`,
            [userId, resetToken, tokenExpiry]
          );

          updateSql = `UPDATE users SET password_hash = NULL, updated_at = NOW() WHERE id = $1`;
          updateParams = [userId];

          // Fire-and-forget email with reset link
          if (target.email) {
            const baseUrl = env.NEXT_PUBLIC_APP_URL ?? "https://zobia.app";
            const resetUrl = `${baseUrl}/auth/reset-password?token=${resetToken}`;
            sendEmail(
              target.email,
              "Your Zobia password has been reset by an administrator",
              `An administrator has reset your Zobia account password.\n\nClick the link below to set a new password (expires in 1 hour):\n${resetUrl}\n\nIf you did not request this, contact Zobia support immediately.`,
              `<p>An administrator has reset your Zobia account password.</p><p><a href="${resetUrl}">Set a new password</a> (expires in 1 hour)</p><p>If you did not request this, contact Zobia support immediately.</p>`
            ).catch(() => {});
          }
          break;
        }

        case "force_2fa": {
          // Flag the account to require 2FA setup on next login (PRD §20).
          updateSql = `UPDATE users SET require_2fa_setup = true, totp_secret = NULL, updated_at = NOW() WHERE id = $1`;
          updateParams = [userId];
          break;
        }

        case "verify_account": {
          // Manually mark the user's email as verified (PRD §20).
          updateSql = `UPDATE users SET is_email_verified = true, updated_at = NOW() WHERE id = $1`;
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

    // Invalidate all sessions for suspended/banned/2fa-forced users immediately
    // (outside transaction – Redis is not transactional with DB)
    if (body.action === "suspend" || body.action === "ban" || body.action === "force_2fa" || body.action === "reset_password") {
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
