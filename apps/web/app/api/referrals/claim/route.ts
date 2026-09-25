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
import { and, eq, isNull } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
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

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/**
 * Claim a referral code for the currently authenticated (newly onboarded) user.
 */
export const POST = withAuth(async (req: NextRequest, { params, auth }) => {
  try {
    const body = await validateBody(req, claimSchema);
    const newUserId = auth.user.sub;
    const orm = await getDb();

    // Resolve the referrer
    const [referrer] = await orm
      .select({ id: schema.users.id, referredBy: schema.users.referredBy })
      .from(schema.users)
      .where(
        and(
          eq(schema.users.referralCode, body.referralCode),
          isNull(schema.users.deletedAt)
        )
      )
      .limit(1);

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

    await orm.transaction(async (tx) => {
      // Check if tier-1 referral already exists (idempotency)
      const [existing] = await tx
        .select({ id: schema.referrals.id })
        .from(schema.referrals)
        .where(
          and(
            eq(schema.referrals.referrerId, referrer.id),
            eq(schema.referrals.referredId, newUserId)
          )
        )
        .limit(1);

      if (!existing) {
        // Create tier-1 referral: direct referrer → new user
        await tx.insert(schema.referrals).values({
          referrerId: referrer.id,
          referredId: newUserId,
          tier: 1,
          qualified: false,
        });
      }

      // Tier-2: if the referrer was themselves referred by someone else,
      // create a tier-2 record so that original referrer can be rewarded
      // when the new user qualifies (e.g. completes first action).
      if (referrer.referredBy) {
        const [existingTier2] = await tx
          .select({ id: schema.referrals.id })
          .from(schema.referrals)
          .where(
            and(
              eq(schema.referrals.referrerId, referrer.referredBy),
              eq(schema.referrals.referredId, newUserId),
              eq(schema.referrals.tier, 2)
            )
          )
          .limit(1);

        if (!existingTier2) {
          await tx.insert(schema.referrals).values({
            referrerId: referrer.referredBy,
            referredId: newUserId,
            tier: 2,
            qualified: false,
          });
        }
      }

      // Store the referrer on the new user's record (idempotent update)
      await tx
        .update(schema.users)
        .set({ referredBy: referrer.id, updatedAt: new Date() })
        .where(
          and(eq(schema.users.id, newUserId), isNull(schema.users.referredBy))
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
