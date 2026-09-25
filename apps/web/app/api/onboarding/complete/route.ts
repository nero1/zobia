export const dynamic = 'force-dynamic';

/**
 * app/api/onboarding/complete/route.ts
 *
 * Onboarding completion endpoint.
 *
 * POST /api/onboarding/complete
 *   - Validates username uniqueness in real-time
 *   - Saves: username, display_name, avatar_emoji, city, vibe_quiz_responses, date_of_birth, gender
 *   - Checks minimum age against x_manifest value (default 13)
 *   - Awards 500 XP welcome drop
 *   - Credits coin_ledger for welcome XP event
 *   - Creates a referral code for the user
 *   - Marks onboarding_completed = true
 *   - All writes occur in a single database transaction
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, isNull, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, badRequest, conflict, ApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { loadManifest } from "@/lib/manifest";
import { verifyCaptcha, isCaptchaSurfaceEnabled } from "@/lib/security/captcha";
import { randomBytes } from "crypto";
import { creditCoins } from "@/lib/economy/coins";
import { logger } from "@/lib/logger";
import { checkUsernameAvailability } from "@/lib/username/availability";

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
  // Birth year is required; month and day are optional (collected since BUG-M17 fix).
  // When all three are provided the date_of_birth is stored as the exact date;
  // otherwise falls back to YYYY-01-01. Users can update from profile settings.
  birth_year: z.coerce
    .number()
    .int()
    .min(1900, "birth_year must be 1900 or later")
    .max(new Date().getFullYear(), "birth_year cannot be in the future"),
  birth_month: z.coerce.number().int().min(1).max(12).optional(),
  birth_day: z.coerce.number().int().min(1).max(31).optional(),
  gender: z.enum(["male", "female", "non_binary", "prefer_not_to_say"]).optional().nullable(),
  referral_code: z.string().max(20).optional().nullable(),
  captcha_token: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Calculate age in full years. Uses exact date when month and day are provided;
 * falls back to a conservative year-only check otherwise (birthday assumed
 * not yet occurred this year).
 */
function calculateAge(birthYear: number, birthMonth?: number, birthDay?: number): number {
  const today = new Date();
  if (birthMonth != null && birthDay != null) {
    const birthdayThisYear = new Date(today.getFullYear(), birthMonth - 1, birthDay);
    return today.getFullYear() - birthYear - (today < birthdayThisYear ? 1 : 0);
  }
  // Conservative year-only: assume birthday hasn't passed yet this year
  return today.getFullYear() - birthYear - 1;
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

    // CAPTCHA verification — skip in development if no token provided, and
    // skip entirely when the "signup" surface is disabled (admin per-surface toggle).
    const isDev = process.env.NODE_ENV !== "production";
    const signupCaptchaRequired = await isCaptchaSurfaceEnabled("signup");
    if (signupCaptchaRequired) {
      if (body.captcha_token) {
        const clientIp = req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? undefined;
        const captchaOk = await verifyCaptcha(body.captcha_token, clientIp ?? undefined, "signup");
        if (!captchaOk) {
          throw badRequest("CAPTCHA verification failed. Please try again.", "CAPTCHA_FAILED");
        }
      } else if (!isDev) {
        throw badRequest("CAPTCHA token is required.", "CAPTCHA_REQUIRED");
      }
    }

    const age = calculateAge(body.birth_year, body.birth_month, body.birth_day);
    if (age < minimumAge) {
      // params.minAge lets clients render "You must be at least {{age}}..." with
      // the server's actual configured minimum instead of a hardcoded guess.
      throw new ApiError(
        400,
        "AGE_REQUIREMENT_NOT_MET",
        `You must be at least ${minimumAge} years old to use Zobia Social`,
        undefined,
        undefined,
        { minAge: minimumAge }
      );
    }

    // Build ISO date for DB storage. Use the exact date when all three parts are
    // provided; otherwise store as YYYY-01-01 (year-only placeholder).
    const mm = body.birth_month != null ? String(body.birth_month).padStart(2, '0') : '01';
    const dd = body.birth_day != null ? String(body.birth_day).padStart(2, '0') : '01';
    const dateOfBirth = `${body.birth_year}-${mm}-${dd}`;

    // Holds the referrer's user ID after the transaction commits (if a referral was used)
    let referrerId: string | null = null;

    // Re-check username availability just before the transaction (TOCTOU
    // protection) — via the shared checkUsernameAvailability() helper so a
    // username under an active username_reservations hold (Username Change
    // redirect/reservation) is rejected here too, not just at
    // registration-time format/uniqueness checks. checkUsernameAvailability()
    // still talks to the raw `db` adapter internally (lib/username/availability.ts
    // is shared with non-migrated callers), so it cannot accept a Drizzle
    // transaction handle — it runs just outside the transaction below instead
    // of nested inside it.
    const availability = await checkUsernameAvailability(body.username, {
      excludeUserId: auth.user.sub,
    });
    if (!availability.available) {
      throw conflict(availability.reason ?? "This username is already taken", "USERNAME_TAKEN");
    }

    const orm = await getDb();

    // Execute all writes in a single transaction
    const result = await orm.transaction(async (client) => {
      // 2. Generate referral code (ensure uniqueness with retry)
      let referralCode = generateReferralCode();
      const [codeCheck] = await client
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.referralCode, referralCode))
        .limit(1);
      if (codeCheck) {
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

      await client
        .update(schema.users)
        .set({
          username: body.username,
          displayName: body.display_name,
          avatarEmoji: body.avatar_emoji ?? undefined,
          city: body.city ?? null,
          vibeQuizResponses: body.vibe_quiz_responses ?? null,
          onboardingPersonalization: personalization ?? null,
          dateOfBirth,
          referralCode,
          gender: body.gender ?? null,
          onboardingCompleted: true,
          updatedAt: new Date(),
        })
        .where(and(eq(schema.users.id, auth.user.sub), isNull(schema.users.deletedAt)));

      // 4. Award XP – write to xp_ledger
      await client.insert(schema.xpLedger).values({
        userId: auth.user.sub,
        amount: WELCOME_XP,
        track: "main",
        source: "welcome_drop",
        baseAmount: WELCOME_XP,
      });

      // 5. Update user's xp_total
      await client
        .update(schema.users)
        .set({ xpTotal: sql`COALESCE(${schema.users.xpTotal}, 0) + ${WELCOME_XP}` })
        .where(eq(schema.users.id, auth.user.sub));

      // 8. Track referral if a code was supplied
      if (body.referral_code) {
        const [referrer] = await client
          .select({ id: schema.users.id })
          .from(schema.users)
          .where(and(eq(schema.users.referralCode, body.referral_code.toUpperCase()), isNull(schema.users.deletedAt)))
          .limit(1);
        if (referrer) {
          referrerId = referrer.id;
          await client
            .insert(schema.referrals)
            .values({
              referrerId,
              referredId: auth.user.sub,
              code: body.referral_code.toUpperCase(),
            })
            .onConflictDoNothing();
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

      await client
        .insert(schema.newMemberQuests)
        .values({
          userId: auth.user.sub,
          questType: "new_member",
          progress: newMemberQuestProgress,
          completed: false,
        })
        .onConflictDoNothing()
        .catch(() => {
          logger.warn('[onboarding/complete] Could not insert new_member quest (non-fatal)');
        });

      return { referralCode };
    });

    // 6. Credit welcome coins (locks row, writes ledger with balance_before/after,
    // updates balance). Runs in its own atomic transaction — creditCoins is
    // idempotent on (user, type, referenceId), so it is safe to run just after
    // the profile-update transaction commits rather than nested inside it.
    await creditCoins(
      auth.user.sub,
      WELCOME_COINS,
      "welcome_bonus",
      "onboarding_welcome",
      "Welcome bonus",
      null
    );

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
