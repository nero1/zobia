export const dynamic = 'force-dynamic';

/**
 * app/api/referrals/claim/route.ts
 *
 * POST /api/referrals/claim
 *
 * Claim a referral code at the end of onboarding.
 * Typically called by /api/onboarding/complete — may also be called
 * separately if the code was provided after initial sign-up.
 *
 * Body: { referralCode: string }
 *
 * Behaviour:
 *  1. Look up the referrer by referral_code.
 *  2. Create a tier-1 referrals record (referrer → new user).
 *  3. If the referrer was themselves referred by someone (has referred_by_user_id),
 *     create a tier-2 record so the original referrer gets a bonus later.
 *  4. Store referred_by_user_id on the calling user's row.
 *
 * This endpoint is idempotent: if a referral already exists it returns
 * success without creating a duplicate (unique constraint on referrer+referred).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  withAuth,
  validateBody,
} from "@/lib/api/middleware";
import { handleApiError, badRequest } from "@/lib/api/errors";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const claimSchema = z.object({
  /** The alphanumeric referral code belonging to the referring user. */
  referralCode: z.string().min(4).max(20).toUpperCase(),
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ReferrerRow {
  id: string;
  referred_by_user_id: string | null;
}

interface ExistingReferralRow {
  id: string;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/**
 * Claim a referral code for the currently authenticated (newly onboarded) user.
 */
export const POST = withAuth(async (req: NextRequest, { auth }) => {
  try {
    const body = await validateBody(req, claimSchema);
    const newUserId = auth.user.sub;

    // Resolve the referrer
    const referrerResult = await db.query<ReferrerRow>(
      `SELECT id, referred_by_user_id
       FROM users
       WHERE referral_code = $1 AND deleted_at IS NULL LIMIT 1`,
      [body.referralCode]
    );
    const referrer = referrerResult.rows[0];

    if (!referrer) {
      throw badRequest(
        "Referral code not found or invalid.",
        "REFERRAL_CODE_NOT_FOUND"
      );
    }

    if (referrer.id === newUserId) {
      throw badRequest(
        "You cannot refer yourself.",
        "SELF_REFERRAL"
      );
    }

    await db.transaction(async (client) => {
      // Check if tier-1 referral already exists (idempotency)
      const existing = await client.query<ExistingReferralRow>(
        `SELECT id FROM referrals
         WHERE referrer_id = $1 AND referred_id = $2 LIMIT 1`,
        [referrer.id, newUserId]
      );

      if (existing.rows.length === 0) {
        // Create tier-1 referral: direct referrer → new user
        await client.query(
          `INSERT INTO referrals (referrer_id, referred_id, tier, qualified, created_at)
           VALUES ($1, $2, 1, false, NOW())`,
          [referrer.id, newUserId]
        );
      }

      // Tier-2: if the referrer was themselves referred by someone else,
      // create a tier-2 record so that original referrer can be rewarded
      // when the new user qualifies (e.g. completes first action).
      if (referrer.referred_by_user_id) {
        const existingTier2 = await client.query<ExistingReferralRow>(
          `SELECT id FROM referrals
           WHERE referrer_id = $1 AND referred_id = $2 AND tier = 2 LIMIT 1`,
          [referrer.referred_by_user_id, newUserId]
        );

        if (existingTier2.rows.length === 0) {
          await client.query(
            `INSERT INTO referrals (referrer_id, referred_id, tier, qualified, created_at)
             VALUES ($1, $2, 2, false, NOW())`,
            [referrer.referred_by_user_id, newUserId]
          );
        }
      }

      // Store the referrer on the new user's record (idempotent update)
      await client.query(
        `UPDATE users
         SET referred_by_user_id = $1, updated_at = NOW()
         WHERE id = $2 AND referred_by_user_id IS NULL`,
        [referrer.id, newUserId]
      );
    });

    return NextResponse.json({
      success: true,
      data: { referrerId: referrer.id },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});
