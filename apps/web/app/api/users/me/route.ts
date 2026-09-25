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
import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db/drizzle";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, notFound } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { anonymizeUserAccount } from "@/lib/users/anonymizeAccount";
import { applyDefaultAvatarIcon } from "@/lib/profile/avatarService";

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
  is_moderator: boolean;
  is_support: boolean;
  is_senior_support: boolean;
  is_creator: boolean;
  is_verified: boolean;
  /** Active Platform Council seat (platform_council_members, left_at IS NULL). Gates the /council nav link + page. */
  is_council_member: boolean;
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

  // Phone (Settings "Phone Number" field — lib/phone/verification.ts)
  phone_number: string | null;
  phone_verified_at: string | null;

  // Chat theme (Pro/Max cosmetic — see app/api/users/me/theme/route.ts)
  chat_theme: string;

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
  city, country, locale, plan, is_admin, COALESCE(is_moderator, false) AS is_moderator,
  COALESCE(is_support, false) AS is_support, COALESCE(is_senior_support, false) AS is_senior_support,
  is_creator, is_verified,
  EXISTS(SELECT 1 FROM platform_council_members pcm WHERE pcm.user_id = users.id AND pcm.left_at IS NULL) AS is_council_member,
  onboarding_completed, coin_balance, star_balance,
  (password_hash IS NOT NULL) AS has_password,
  (google_id IS NOT NULL OR telegram_id IS NOT NULL) AS has_oauth_login,
  (SELECT s.ends_at FROM subscriptions s
     WHERE s.user_id = users.id AND s.status = 'active'
     ORDER BY s.created_at DESC LIMIT 1) AS plan_ends_at,
  (SELECT ba.current_period_ends_at FROM business_accounts ba
     WHERE ba.user_id = users.id AND ba.status IN ('active', 'grace', 'lapsed')
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
  gender, date_of_birth, COALESCE(chat_theme, 'default') AS chat_theme,
  phone_number, phone_verified_at, created_at, updated_at
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

    const db = await getDb();
    const [profileResult, pinResult] = await Promise.all([
      db.execute(sql`
        SELECT ${sql.raw(SELECT_COLUMNS)}
         FROM users
         WHERE id = ${auth.user.sub} AND deleted_at IS NULL
         LIMIT 1
      `),
      db.execute(sql`
        SELECT EXISTS(SELECT 1 FROM user_pins WHERE user_id = ${auth.user.sub}) AS exists
      `),
    ]);

    const profileRows = profileResult.rows as unknown as UserFullProfile[];
    const pinRows = pinResult.rows as unknown as Array<{ exists: boolean }>;

    if (!profileRows[0]) throw notFound("User profile not found");

    const hasPIN = pinRows[0]?.exists ?? false;

    return NextResponse.json(
      { user: { ...profileRows[0], hasPIN } },
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
 * `avatar_emoji` — Profile Pictures feature: switching to one of the default
 * onboarding icons (lib/profile/defaultAvatars.ts) is always free on any
 * plan, but goes through lib/profile/avatarService.ts's
 * `applyDefaultAvatarIcon` rather than a plain column update, so it (a)
 * rejects emoji not in the recognised default set, (b) clears avatar_url —
 * which otherwise takes rendering precedence, see app/u/[username]/page.tsx
 * — and (c) enforces the same once-a-week cooldown as a custom photo
 * upload. Throws 429 AVATAR_CHANGE_RATE_LIMITED within the cooldown window.
 *
 * @returns JSON { user: UserFullProfile }
 */
export const PUT = withAuth(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);

    const body = await validateBody(req, updateProfileSchema);

    if (body.avatar_emoji !== undefined) {
      await applyDefaultAvatarIcon(auth.user.sub, body.avatar_emoji);
    }

    // Build SET clause dynamically from the remaining provided fields
    const db = await getDb();
    const updates: ReturnType<typeof sql>[] = [];

    if (body.display_name !== undefined) {
      updates.push(sql`display_name = ${body.display_name}`);
    }
    if (body.bio !== undefined) {
      updates.push(sql`bio = ${body.bio}`);
    }
    if (body.locale !== undefined) {
      updates.push(sql`locale = ${body.locale}`);
    }
    if (body.push_token !== undefined) {
      updates.push(sql`push_token = ${body.push_token}`);
    }
    if (body.dm_notifications !== undefined) {
      updates.push(sql`dm_notifications = ${body.dm_notifications}`);
    }
    if (body.guild_notifications !== undefined) {
      updates.push(sql`guild_notifications = ${body.guild_notifications}`);
    }
    if (body.streak_notifications !== undefined) {
      updates.push(sql`streak_notifications = ${body.streak_notifications}`);
    }
    if (body.dm_privacy !== undefined) {
      updates.push(sql`dm_privacy = ${body.dm_privacy}`);
    }
    if (body.gender !== undefined) {
      updates.push(sql`gender = ${body.gender}`);
    }
    if (body.date_of_birth !== undefined) {
      updates.push(sql`date_of_birth = ${body.date_of_birth}`);
    }

    if (updates.length === 0) {
      // Nothing to update – return current profile
      const result = await db.execute(sql`
        SELECT ${sql.raw(SELECT_COLUMNS)} FROM users WHERE id = ${auth.user.sub} AND deleted_at IS NULL LIMIT 1
      `);
      const rows = result.rows as unknown as UserFullProfile[];
      if (!rows[0]) throw notFound("User profile not found");
      return NextResponse.json({ user: rows[0] }, { status: 200 });
    }

    updates.push(sql`updated_at = NOW()`);

    const updateResult = await db.execute(sql`
      UPDATE users
       SET ${sql.join(updates, sql`, `)}
       WHERE id = ${auth.user.sub} AND deleted_at IS NULL
       RETURNING ${sql.raw(SELECT_COLUMNS)}
    `);
    const rows = updateResult.rows as unknown as UserFullProfile[];

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

    // Shared with the admin-triggered delete endpoint
    // (app/api/admin/data-management/users/[id]/route.ts) — see
    // lib/users/anonymizeAccount.ts for the full anonymization/PII-purge logic.
    await anonymizeUserAccount(userId);

    return NextResponse.json(
      { success: true, data: { message: "Account deleted. We're sorry to see you go." }, error: null },
      { status: 200 }
    );
  } catch (err) {
    return handleApiError(err);
  }
});
