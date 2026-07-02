export const dynamic = 'force-dynamic';

/**
 * app/api/users/me/route.ts
 *
 * Authenticated user's own profile endpoints.
 *
 * GET  /api/users/me  – Returns the full profile including all XP tracks,
 *                       rank info, and coin balance.
 * PUT  /api/users/me  – Updates display_name, bio, locale, avatar_emoji,
 *                       and/or push_token.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db, SqlParam } from "@/lib/db";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, notFound } from "@/lib/api/errors";
import { invalidateAllSessions } from "@/lib/auth/session";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface UserFullProfile {
  id: string;
  email: string | null;
  username: string | null;
  display_name: string | null;
  bio: string | null;
  avatar_url: string | null;
  avatar_emoji: string | null;
  city: string | null;
  country: string | null;
  locale: string | null;
  plan: string;
  /** ISO timestamp the user's active personal subscription (subscriptions.ends_at) expires, or null if on free / no active subscription. */
  plan_ends_at: string | null;
  /** ISO timestamp the user's active business plan subscription expires, or null. */
  business_plan_ends_at: string | null;
  is_admin: boolean;
  is_creator: boolean;
  is_verified: boolean;
  onboarding_completed: boolean;
  /** Whether the account has a password set (vs. OAuth-only login). */
  has_password: boolean;
  /** Whether the account has a Google or Telegram login linked. */
  has_oauth_login: boolean;

  // Economy
  coin_balance: number;
  star_balance: number;

  // Main XP & rank
  xp_total: number;
  legacy_score: number;
  rank_name: string;
  rank_level: number;
  rank_sublevel: number;
  prestige_count: number;
  /** Cheap count used by the Wallet page's rank/badges summary widget — full badge details live on the Stats page. */
  badge_count: number;

  // Track XP
  xp_social: number;
  xp_creator: number;
  xp_competitor: number;
  xp_generosity: number;
  xp_knowledge: number;
  xp_explorer: number;
  xp_gaming: number;

  // Track levels
  level_social: number;
  level_creator: number;
  level_competitor: number;
  level_generosity: number;
  level_knowledge: number;
  level_explorer: number;
  level_gaming: number;

  // Streaks
  login_streak: number;
  longest_streak: number;
  last_login_at: string | null;
  last_active_at: string | null;

  // Guild
  guild_id: string | null;

  // Referral
  referral_code: string | null;

  // Push
  push_token: string | null;
  dm_notifications: boolean;
  guild_notifications: boolean;
  streak_notifications: boolean;

  // Security
  totp_enabled: boolean;

  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const updateProfileSchema = z.object({
  display_name: z
    .string()
    .min(1, "Display name cannot be empty")
    .max(50, "Display name cannot exceed 50 characters")
    .optional(),
  bio: z
    .string()
    .max(300, "Bio cannot exceed 300 characters")
    .nullable()
    .optional(),
  locale: z
    .string()
    .regex(
      /^[a-z]{2}(-[A-Z]{2})?$/,
      "locale must be a valid BCP-47 language tag (e.g. 'en' or 'en-US')"
    )
    .optional(),
  avatar_emoji: z
    .string()
    .min(1)
    .max(8, "avatar_emoji too long")
    .optional(),
  push_token: z
    .string()
    .max(500, "push_token too long")
    .nullable()
    .optional(),
  dm_notifications: z.boolean().optional(),
  guild_notifications: z.boolean().optional(),
  streak_notifications: z.boolean().optional(),
  dm_privacy: z.enum(["everyone", "friends_only", "nobody"]).optional(),
  gender: z.enum(["female", "male", "non_binary", "prefer_not_to_say"]).nullable().optional(),
  // Full date of birth — users set this from profile settings after onboarding
  date_of_birth: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "date_of_birth must be in YYYY-MM-DD format")
    .nullable()
    .optional(),
});

// ---------------------------------------------------------------------------
// SELECT clause (reused for both GET and PUT RETURNING)
// ---------------------------------------------------------------------------

const SELECT_COLUMNS = `
  id, email, username, display_name, bio, avatar_url, avatar_emoji,
  city, country, locale, plan, is_admin, is_creator, is_verified,
  onboarding_completed, coin_balance, star_balance,
  (password_hash IS NOT NULL) AS has_password,
  (google_id IS NOT NULL OR telegram_id IS NOT NULL) AS has_oauth_login,
  (SELECT s.ends_at FROM subscriptions s
     WHERE s.user_id = users.id AND s.status = 'active'
     ORDER BY s.created_at DESC LIMIT 1) AS plan_ends_at,
  (SELECT s2.ends_at FROM business_accounts ba
     JOIN subscriptions s2 ON s2.id = ba.subscription_id
     WHERE ba.user_id = users.id AND ba.status = 'active'
     LIMIT 1) AS business_plan_ends_at,
  xp_total, legacy_score, rank_name, rank_level, rank_sublevel, prestige_count,
  (SELECT COUNT(*) FROM user_badges WHERE user_badges.user_id = users.id) AS badge_count,
  xp_social, xp_creator, xp_competitor, xp_generosity, xp_knowledge, xp_explorer, xp_gaming,
  level_social, level_creator, level_competitor, level_generosity, level_knowledge, level_explorer, level_gaming,
  login_streak, longest_streak, last_login_at, last_active_at,
  guild_id, referral_code, push_token,
  dm_notifications, guild_notifications, streak_notifications,
  COALESCE(dm_privacy, 'everyone') AS dm_privacy,
  COALESCE(totp_enabled, false) AS totp_enabled,
  gender, date_of_birth, created_at, updated_at
`;

// ---------------------------------------------------------------------------
// GET /api/users/me
// ---------------------------------------------------------------------------

/**
 * Return the authenticated user's full profile, including all XP tracks,
 * rank information, coin balance, and PIN status.
 *
 * @returns JSON { user: UserFullProfile & { hasPIN: boolean } }
 */
export const GET = withAuth(async (_req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);

    const [profileResult, pinResult] = await Promise.all([
      db.query<UserFullProfile>(
        `SELECT ${SELECT_COLUMNS}
         FROM users
         WHERE id = $1 AND deleted_at IS NULL
         LIMIT 1`,
        [auth.user.sub]
      ),
      db.query<{ exists: boolean }>(
        `SELECT EXISTS(SELECT 1 FROM user_pins WHERE user_id = $1) AS exists`,
        [auth.user.sub]
      ),
    ]);

    if (!profileResult.rows[0]) throw notFound("User profile not found");

    const hasPIN = pinResult.rows[0]?.exists ?? false;

    return NextResponse.json(
      { user: { ...profileResult.rows[0], hasPIN } },
      { status: 200 }
    );
  } catch (err) {
    return handleApiError(err);
  }
});

// ---------------------------------------------------------------------------
// PUT /api/users/me
// ---------------------------------------------------------------------------

/**
 * Update the authenticated user's mutable profile fields.
 * Accepted fields: display_name, bio, locale, avatar_emoji, push_token,
 * dm_notifications, guild_notifications, streak_notifications.
 *
 * @returns JSON { user: UserFullProfile }
 */
export const PUT = withAuth(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);

    const body = await validateBody(req, updateProfileSchema);

    // Build SET clause dynamically from provided fields
    const updates: string[] = [];
    const params: SqlParam[] = [auth.user.sub];
    let paramIdx = 2;

    if (body.display_name !== undefined) {
      updates.push(`display_name = $${paramIdx++}`);
      params.push(body.display_name);
    }
    if (body.bio !== undefined) {
      updates.push(`bio = $${paramIdx++}`);
      params.push(body.bio);
    }
    if (body.locale !== undefined) {
      updates.push(`locale = $${paramIdx++}`);
      params.push(body.locale);
    }
    if (body.avatar_emoji !== undefined) {
      updates.push(`avatar_emoji = $${paramIdx++}`);
      params.push(body.avatar_emoji);
    }
    if (body.push_token !== undefined) {
      updates.push(`push_token = $${paramIdx++}`);
      params.push(body.push_token);
    }
    if (body.dm_notifications !== undefined) {
      updates.push(`dm_notifications = $${paramIdx++}`);
      params.push(body.dm_notifications);
    }
    if (body.guild_notifications !== undefined) {
      updates.push(`guild_notifications = $${paramIdx++}`);
      params.push(body.guild_notifications);
    }
    if (body.streak_notifications !== undefined) {
      updates.push(`streak_notifications = $${paramIdx++}`);
      params.push(body.streak_notifications);
    }
    if (body.dm_privacy !== undefined) {
      updates.push(`dm_privacy = $${paramIdx++}`);
      params.push(body.dm_privacy);
    }
    if (body.gender !== undefined) {
      updates.push(`gender = $${paramIdx++}`);
      params.push(body.gender);
    }
    if (body.date_of_birth !== undefined) {
      updates.push(`date_of_birth = $${paramIdx++}`);
      params.push(body.date_of_birth);
    }

    if (updates.length === 0) {
      // Nothing to update – return current profile
      const { rows } = await db.query<UserFullProfile>(
        `SELECT ${SELECT_COLUMNS} FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
        [auth.user.sub]
      );
      if (!rows[0]) throw notFound("User profile not found");
      return NextResponse.json({ user: rows[0] }, { status: 200 });
    }

    updates.push("updated_at = NOW()");

    const { rows } = await db.query<UserFullProfile>(
      `UPDATE users
       SET ${updates.join(", ")}
       WHERE id = $1 AND deleted_at IS NULL
       RETURNING ${SELECT_COLUMNS}`,
      params
    );

    if (!rows[0]) throw notFound("User profile not found");

    return NextResponse.json({ user: rows[0] }, { status: 200 });
  } catch (err) {
    return handleApiError(err);
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/users/me — Account deletion (soft delete + anonymisation)
// ---------------------------------------------------------------------------

/**
 * Delete the authenticated user's account.
 *
 * Per PRD §23: "User deletion anonymises records rather than hard-deleting
 * to preserve referential integrity."
 *
 * Anonymisation:
 *   - email → NULL
 *   - display_name → "Deleted User"
 *   - username → "deleted_<id_suffix>"
 *   - bio, avatar_emoji, city → NULL
 *   - push_token → NULL
 *   - deleted_at → NOW()
 *
 * The user's messages and content remain but are attributed to an
 * anonymous "Deleted User" to preserve conversation integrity.
 */
export const DELETE = withAuth(async (_req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);

    const userId = auth.user.sub;
    const shortId = userId.replace(/-/g, "").slice(0, 8);

    await db.transaction(async (tx) => {
      // Soft delete: anonymise public-facing fields but KEEP identifiers (email, google_id, etc.)
      // so the user can reactivate within the 30-day grace period by logging in again.
      // PII identifiers are only wiped by the scheduled purge job after pending_deletion_at.
      await tx.query(
        `UPDATE users
         SET display_name    = 'Deleted User',
             bio             = NULL,
             avatar_emoji    = '👤',
             city            = NULL,
             push_token      = NULL,
             pin_hash        = NULL,
             deleted_at      = NOW(),
             updated_at      = NOW()
         WHERE id = $1 AND deleted_at IS NULL`,
        [userId]
      );

      // Hard-delete payment PII — bank accounts and wallet addresses are PII
      // that cannot be retained; payout records preserve accounting data via snapshots.
      await tx.query(
        `DELETE FROM creator_bank_accounts WHERE creator_id = $1`,
        [userId]
      );
      await tx.query(
        `DELETE FROM creator_wallet_addresses WHERE creator_id = $1`,
        [userId]
      );
      await tx.query(
        `DELETE FROM creator_kyc WHERE creator_id = $1`,
        [userId]
      ).catch(() => {});
    });

    // ZB-16: Invalidate all active sessions so deleted user can't keep refreshing tokens
    await invalidateAllSessions(userId).catch(() => {});

    return NextResponse.json(
      { success: true, data: { message: "Account deleted. We're sorry to see you go." }, error: null },
      { status: 200 }
    );
  } catch (err) {
    return handleApiError(err);
  }
});
