export const dynamic = 'force-dynamic';

/**
 * app/api/onboarding/complete/route.ts
 *
 * Onboarding completion endpoint.
 *
 * POST /api/onboarding/complete
 *   - Validates username uniqueness in real-time
 *   - Saves: username, display_name, avatar_emoji, city, vibe_quiz_responses, date_of_birth
 *   - Checks minimum age against x_manifest value (default 13)
 *   - Awards 500 XP welcome drop
 *   - Credits coin_ledger for welcome XP event
 *   - Creates a referral code for the user
 *   - Marks onboarding_completed = true
 *   - All writes occur in a single database transaction
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, badRequest, conflict } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { loadManifest } from "@/lib/manifest";
import { verifyCaptcha } from "@/lib/security/captcha";
import { randomBytes } from "crypto";
import { creditCoins } from "@/lib/economy/coins";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WELCOME_XP = 500;
const WELCOME_COINS = 100;
const USERNAME_REGEX = /^[a-z0-9_-]{3,30}$/;

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const onboardingSchema = z.object({
  username: z
    .string()
    .min(3, "Username must be at least 3 characters")
    .max(30, "Username cannot exceed 30 characters")
    .regex(
      USERNAME_REGEX,
      "Username may only contain lowercase letters, numbers, underscores, and hyphens"
    )
    .transform((v) => v.toLowerCase()),
  display_name: z
    .string()
    .min(1, "Display name is required")
    .max(50, "Display name cannot exceed 50 characters"),
  avatar_emoji: z
    .string()
    .max(8, "Avatar emoji is too long")
    .optional()
    .nullable(),
  city: z.string().max(100).optional().nullable(),
  vibe_quiz_responses: z
    .record(z.string(), z.unknown())
    .optional()
    .nullable(),
  // Onboarding collects only birth year; stored as YYYY-01-01 in the DB.
  // Users may update to their full date of birth later in profile settings.
  birth_year: z.coerce
    .number()
    .int()
    .min(1900, "birth_year must be 1900 or later")
    .max(new Date().getFullYear(), "birth_year cannot be in the future"),
  referral_code: z.string().max(20).optional().nullable(),
  captcha_token: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Calculate age in full years from a birth year integer.
 * Conservative: assumes the birthday hasn't occurred yet this year.
 *
 * @param birthYear - Four-digit birth year
 * @returns Minimum age in years
 */
function calculateAge(birthYear: number): number {
  return new Date().getFullYear() - birthYear;
}

/**
 * Generate a unique referral code for a user.
 * Format: 9-digit numeric string (e.g. 471370973) per PRD §15.
 *
 * @returns Referral code string
 */
function generateReferralCode(): string {
  // Produce a random 9-digit number: 100_000_000 – 999_999_999
  const min = 100_000_000;
  const max = 999_999_999;
  const buf = randomBytes(4);
  const rand = buf.readUInt32BE(0);
  return String(min + (rand % (max - min + 1)));
}

// ---------------------------------------------------------------------------
// POST /api/onboarding/complete
// ---------------------------------------------------------------------------

/**
 * Complete user onboarding.
 *
 * Validates input, enforces minimum age, persists profile data,
 * awards welcome XP + coins, creates referral code, and marks the user
 * as onboarded – all within a single database transaction.
 *
 * @returns JSON { success: true, xpAwarded: number, referralCode: string }
 */
export const POST = withAuth(async (req, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.onboarding);

    const body = await validateBody(req, onboardingSchema);

    // Load manifest to get minimum age and captcha settings
    const manifest = await loadManifest();
    const minimumAge: number = manifest.minimumAge;

    // CAPTCHA verification — skip in development if no token provided
    const isDev = process.env.NODE_ENV !== "production";
    if (body.captcha_token) {
      const clientIp = req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? undefined;
      const captchaOk = await verifyCaptcha(body.captcha_token, clientIp ?? undefined, "onboarding");
      if (!captchaOk) {
        throw badRequest("CAPTCHA verification failed. Please try again.", "CAPTCHA_FAILED");
      }
    } else if (!isDev && manifest.captchaProvider !== "none") {
      throw badRequest("CAPTCHA token is required.", "CAPTCHA_REQUIRED");
    }

    // Check age requirement (conservative: uses birth year only)
    const age = calculateAge(body.birth_year);
    if (age < minimumAge) {
      throw badRequest(
        `You must be at least ${minimumAge} years old to use Zobia Social`,
        "AGE_REQUIREMENT_NOT_MET"
      );
    }

    // Build ISO date from birth year for DB storage (YYYY-01-01).
    // Users can update to their full date of birth from profile settings.
    const dateOfBirth = `${body.birth_year}-01-01`;

    // Holds the referrer's user ID after the transaction commits (if a referral was used)
    let referrerId: string | null = null;

    // Execute all writes in a single transaction
    const result = await db.transaction(async (client) => {
      // 1. Re-check username uniqueness inside the transaction (TOCTOU protection)
      const usernameCheck = await client.query<{ exists: boolean }>(
        `SELECT EXISTS(
           SELECT 1 FROM users
           WHERE LOWER(username) = $1 AND deleted_at IS NULL AND id != $2
         ) AS exists`,
        [body.username, auth.user.sub]
      );

      if (usernameCheck.rows[0]?.exists) {
        throw conflict("This username is already taken", "USERNAME_TAKEN");
      }

      // 2. Generate referral code (ensure uniqueness with retry)
      let referralCode = generateReferralCode();
      const codeCheck = await client.query<{ exists: boolean }>(
        `SELECT EXISTS(SELECT 1 FROM users WHERE referral_code = $1) AS exists`,
        [referralCode]
      );
      if (codeCheck.rows[0]?.exists) {
        referralCode = generateReferralCode() + "X"; // simple collision avoidance
      }

      // 3. Update user profile + mark onboarding complete
      // Derive personalization tags from quiz answers for Room/Guild seeding
      const personalization = body.vibe_quiz_responses
        ? {
            ...body.vibe_quiz_responses,
            // PRD §4: q1 seeds Room recommendations
            roomAffinity: (body.vibe_quiz_responses as Record<string, string>).q1 ?? null,
            // PRD §4: q2 surfaces Guild vs solo emphasis
            guildEmphasis: ['crew', 'mostly_crew'].includes(
              (body.vibe_quiz_responses as Record<string, string>).q2 ?? ''
            ) ? 'guild' : 'solo',
            // PRD §4: q3 adjusts onboarding tone
            intent: (body.vibe_quiz_responses as Record<string, string>).q3 ?? null,
            // PRD §4: q4 seeds competitive/social graph
            cityVibe: (body.vibe_quiz_responses as Record<string, string>).q4 ?? null,
          }
        : null;

      await client.query(
        `UPDATE users SET
           username                   = $1,
           display_name               = $2,
           avatar_emoji               = $3,
           city                       = $4,
           vibe_quiz_responses        = $5,
           onboarding_personalization = $6,
           date_of_birth              = $7,
           referral_code              = $8,
           onboarding_completed       = true,
           updated_at                 = NOW()
         WHERE id = $9 AND deleted_at IS NULL`,
        [
          body.username,
          body.display_name,
          body.avatar_emoji ?? null,
          body.city ?? null,
          body.vibe_quiz_responses ? JSON.stringify(body.vibe_quiz_responses) : null,
          personalization ? JSON.stringify(personalization) : null,
          dateOfBirth,
          referralCode,
          auth.user.sub,
        ]
      );

      // 4. Award XP – write to xp_ledger
      await client.query(
        `INSERT INTO xp_ledger (user_id, amount, track, source, base_amount, created_at)
         VALUES ($1, $2, 'main', 'welcome_drop', $2, NOW())`,
        [auth.user.sub, WELCOME_XP]
      );

      // 5. Update user's xp_total
      await client.query(
        `UPDATE users SET xp_total = COALESCE(xp_total, 0) + $1 WHERE id = $2`,
        [WELCOME_XP, auth.user.sub]
      );

      // 6. Credit welcome coins (locks row, writes ledger with balance_before/after, updates balance)
      await creditCoins(
        auth.user.sub,
        WELCOME_COINS,
        "welcome_bonus",
        "onboarding_welcome",
        "Welcome bonus",
        null,
        client
      );

      // 8. Track referral if a code was supplied
      if (body.referral_code) {
        const referrer = await client.query<{ id: string }>(
          `SELECT id FROM users WHERE referral_code = $1 AND deleted_at IS NULL LIMIT 1`,
          [body.referral_code.toUpperCase()]
        );
        if (referrer.rows[0]) {
          referrerId = referrer.rows[0].id;
          await client.query(
            `INSERT INTO referrals (referrer_id, referred_id, code, created_at)
             VALUES ($1, $2, $3, NOW())
             ON CONFLICT DO NOTHING`,
            [referrerId, auth.user.sub, body.referral_code.toUpperCase()]
          );
        }
      }

      // 9. Create the New Member Quest for this user.
      //    Tracks 5 steps: send_message, join_room, gift_someone, add_friend, daily_login
      //    Payout on completion: 1,000 Coins + 2,000 XP
      const newMemberQuestProgress = {
        steps: [
          { id: 'send_message',    label: 'Send a message',         completed: false },
          { id: 'join_room',       label: 'Join a Room',            completed: false },
          { id: 'gift_someone',    label: 'Gift someone',           completed: false },
          { id: 'add_friend',      label: 'Add a friend',           completed: false },
          { id: 'friend_request',  label: 'Send 3 friend requests', completed: false, count: 0, target: 3 },
          { id: 'daily_login',     label: 'Complete a daily login', completed: false },
        ],
      };

      await client.query(
        `INSERT INTO new_member_quests
           (user_id, quest_type, progress, completed, created_at, updated_at)
         VALUES ($1, 'new_member', $2, FALSE, NOW(), NOW())
         ON CONFLICT (user_id, quest_type) DO NOTHING`,
        [auth.user.sub, JSON.stringify(newMemberQuestProgress)]
      ).catch(() => {
        logger.warn('[onboarding/complete] Could not insert new_member quest (non-fatal)');
      });

      return { referralCode };
    });

    // Fire referral notification to referrer (fire-and-forget — never blocks the response)
    if (referrerId) {
      import("@/lib/realtime").then(({ publishRealtimeEvent }) => {
        publishRealtimeEvent(
          `user:${referrerId}`,
          "reward_earned",
          { type: "referral", amount: 1 }
        ).catch(() => {});
      }).catch(() => {});
    }

    return NextResponse.json(
      {
        success: true,
        xpAwarded: WELCOME_XP,
        coinsAwarded: WELCOME_COINS,
        referralCode: result.referralCode,
      },
      { status: 200 }
    );
  } catch (err) {
    return handleApiError(err);
  }
});
