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
import { sql, type SQL } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { env } from "@/lib/env";
import { withAdminAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, notFound, badRequest, conflict } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { revokeUserAccess } from "@/lib/auth/session";
import { sendEmail } from "@/lib/notifications/email";
import { logger } from "@/lib/logger";
import { syncSponsoredQuestTemplate } from "@/lib/quests/sponsoredQuestPacing";
import { restoreUserAccount } from "@/lib/moderation/accountActions";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AdminUserParams {
  userId: string;
}

interface TargetUser extends Record<string, unknown> {
  id: string;
  email: string | null;
  username: string | null;
  is_admin: boolean;
  is_suspended: boolean;
  is_banned: boolean;
  is_moderator: boolean;
  is_support: boolean;
  is_senior_support: boolean;
  is_ad_moderator: boolean;
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
    "upgrade_support",
    "downgrade_support",
    "upgrade_senior_support",
    "downgrade_senior_support",
    "upgrade_ad_moderator",
    "downgrade_ad_moderator",
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

    const orm = await getDb();

    const result = await orm.transaction(async (client) => {
      // Fetch target user (locked for update).
      // NOTE: is_support/is_senior_support/is_ad_moderator are not present in
      // lib/db/schema.ts (a genuine schema/DB gap — these columns exist on
      // `users` since migrations 0001 and 0002 — reported separately), so
      // this query is expressed via the `sql` template rather than the
      // Drizzle query builder.
      const { rows } = await client.execute<TargetUser>(sql`
        SELECT id, email, username, is_admin, is_suspended, is_banned, is_moderator,
               COALESCE(is_support, false) AS is_support,
               COALESCE(is_senior_support, false) AS is_senior_support,
               COALESCE(is_ad_moderator, false) AS is_ad_moderator,
               COALESCE(is_email_verified, false) AS email_verified,
               COALESCE(require_2fa_setup, false) AS require_2fa_setup
        FROM users
        WHERE id = ${userId} AND deleted_at IS NULL
        FOR UPDATE
      `);

      const target = rows[0];
      if (!target) throw notFound("User not found");

      // Prevent actioning another admin — except flagging/unflagging senior
      // support, which is explicitly allowed on admin accounts (an admin can
      // be a senior-support escalation target too).
      const seniorSupportActions = ["upgrade_senior_support", "downgrade_senior_support"];
      if (target.is_admin && !seniorSupportActions.includes(body.action)) {
        throw badRequest("Cannot perform moderation actions on admin accounts");
      }

      // Most branches touch only columns present in the Drizzle schema and
      // are built as a plain `sql` UPDATE template, executed once below (a
      // few — upgrade/downgrade_support, *_senior_support, *_ad_moderator —
      // touch columns missing from lib/db/schema.ts; see the note above).
      let updateQuery: SQL | null;
      const appliedAt = new Date().toISOString();

      switch (body.action) {
        case "suspend": {
          if (target.is_banned) {
            throw conflict("User is already banned; use 'restore' first");
          }
          const suspendedUntil = new Date(Date.now() + body.duration_hours! * 3600 * 1000);

          updateQuery = sql`UPDATE users
            SET is_suspended = true, suspended_until = ${suspendedUntil}, suspension_reason = ${body.reason ?? null}, updated_at = NOW()
            WHERE id = ${userId}`;
          break;
        }

        case "ban": {
          updateQuery = sql`UPDATE users
            SET is_banned = true, is_suspended = false, suspended_until = NULL,
                ban_reason = ${body.reason ?? null}, banned_at = NOW(), updated_at = NOW()
            WHERE id = ${userId}`;
          break;
        }

        case "restore": {
          // Shared with the Account Appeals pipeline's approve action
          // (app/api/admin/appeals/[appealId]/route.ts) — see
          // lib/moderation/accountActions.ts. It re-validates and re-locks
          // the row itself (harmless re-lock; already locked above in this
          // same transaction) and throws `conflict` if not suspended/banned.
          await restoreUserAccount(client, userId);
          // No-op — the actual update already happened above.
          updateQuery = null;
          break;
        }

        case "upgrade_moderator": {
          if (target.is_moderator) {
            throw conflict("User is already a moderator");
          }
          updateQuery = sql`UPDATE users SET is_moderator = true, updated_at = NOW() WHERE id = ${userId}`;
          break;
        }

        case "downgrade_moderator": {
          if (!target.is_moderator) {
            throw conflict("User is not a moderator");
          }
          updateQuery = sql`UPDATE users SET is_moderator = false, updated_at = NOW() WHERE id = ${userId}`;
          break;
        }

        case "upgrade_support": {
          if (target.is_support) {
            throw conflict("User is already support staff");
          }
          updateQuery = sql`UPDATE users SET is_support = true, updated_at = NOW() WHERE id = ${userId}`;
          break;
        }

        case "downgrade_support": {
          if (!target.is_support) {
            throw conflict("User is not support staff");
          }
          // Also strips senior_support — a user cannot be senior support
          // without base support/moderator/admin standing.
          updateQuery = sql`UPDATE users SET is_support = false, is_senior_support = false, updated_at = NOW() WHERE id = ${userId}`;
          break;
        }

        case "upgrade_senior_support": {
          if (!target.is_support && !target.is_moderator && !target.is_admin) {
            throw badRequest("User must be support, moderator, or admin before being flagged senior support");
          }
          if (target.is_senior_support) {
            throw conflict("User is already senior support");
          }
          updateQuery = sql`UPDATE users SET is_senior_support = true, updated_at = NOW() WHERE id = ${userId}`;
          break;
        }

        case "downgrade_senior_support": {
          if (!target.is_senior_support) {
            throw conflict("User is not senior support");
          }
          updateQuery = sql`UPDATE users SET is_senior_support = false, updated_at = NOW() WHERE id = ${userId}`;
          break;
        }

        case "upgrade_ad_moderator": {
          if (target.is_ad_moderator) {
            throw conflict("User is already an ad moderator");
          }
          updateQuery = sql`UPDATE users SET is_ad_moderator = true, updated_at = NOW() WHERE id = ${userId}`;
          break;
        }

        case "downgrade_ad_moderator": {
          if (!target.is_ad_moderator) {
            throw conflict("User is not an ad moderator");
          }
          updateQuery = sql`UPDATE users SET is_ad_moderator = false, updated_at = NOW() WHERE id = ${userId}`;
          break;
        }

        case "reset_password": {
          // Null out the password hash so the account cannot log in with password,
          // then create a one-time reset token and email it to the user (PRD §20).
          const resetToken = randomBytes(32).toString("hex");
          const tokenExpiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

          await client
            .insert(schema.passwordResetTokens)
            .values({
              userId,
              tokenHash: sql`encode(sha256(${resetToken}::bytea), 'hex')`,
              expiresAt: tokenExpiry,
            })
            .onConflictDoUpdate({
              target: schema.passwordResetTokens.userId,
              set: {
                tokenHash: sql`encode(sha256(${resetToken}::bytea), 'hex')`,
                expiresAt: tokenExpiry,
                usedAt: null,
                createdAt: sql`NOW()`,
              },
            });

          updateQuery = sql`UPDATE users SET password_hash = NULL, updated_at = NOW() WHERE id = ${userId}`;

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
          updateQuery = sql`UPDATE users SET require_2fa_setup = true, totp_secret = NULL, updated_at = NOW() WHERE id = ${userId}`;
          break;
        }

        case "verify_account": {
          // Manually mark the user's email as verified (PRD §20).
          updateQuery = sql`UPDATE users SET is_email_verified = true, updated_at = NOW() WHERE id = ${userId}`;
          break;
        }
      }

      if (updateQuery) {
        await client.execute(updateQuery);
      }

      // Log the action to the audit table
      await client.insert(schema.adminActions).values({
        adminId: auth.user.sub,
        targetUserId: userId,
        action: body.action,
        reason: body.reason ?? null,
        durationHours: body.duration_hours ?? null,
      });

      return { target, appliedAt };
    });

    // Invalidate all sessions for suspended/banned/2fa-forced/demoted users immediately
    // (outside transaction – Redis is not transactional with DB)
    // BUG-028: include downgrade_moderator (and, following the same fix,
    // downgrade_ad_moderator) so demoted users' JWTs — which still carry the
    // stale is_moderator/is_ad_moderator claim — cannot be replayed until
    // their next login issues a fresh token.
    if (
      body.action === "suspend" ||
      body.action === "ban" ||
      body.action === "force_2fa" ||
      body.action === "reset_password" ||
      body.action === "downgrade_moderator" ||
      body.action === "downgrade_ad_moderator"
    ) {
      await revokeUserAccess(userId, `admin:${body.action}`);
    }

    // Banning a business owner or an admin-assigned quest "creator" pauses
    // their running Sponsored Quests — never auto-resumed; they (or a new
    // admin decision) must explicitly restart once the account is restored.
    if (body.action === "ban") {
      try {
        const stoppedQuests = await orm
          .update(schema.sponsoredQuests)
          .set({
            isActive: false,
            autoPaused: true,
            pauseReason: "Account banned",
            pausedAt: new Date(),
          })
          .where(
            sql`${schema.sponsoredQuests.isActive} = TRUE AND ${schema.sponsoredQuests.deletedAt} IS NULL
              AND (${schema.sponsoredQuests.ownerUserId} = ${userId}
                OR ${schema.sponsoredQuests.businessAccountId} IN (
                  SELECT id FROM ${schema.businessAccounts} WHERE user_id = ${userId}
                ))`
          )
          .returning({ id: schema.sponsoredQuests.id });
        for (const q of stoppedQuests) await syncSponsoredQuestTemplate(orm, q.id);
      } catch (err) {
        logger.error({ err, userId }, "[admin:actions] Failed to pause sponsored quests on ban");
      }
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
