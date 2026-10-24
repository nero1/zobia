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
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import {enforceRateLimit,RATE_LIMITS} from "@/lib/security/rateLimit";
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
    await enforceRateLimit(auth.user.sub,"user",RATE_LIMITS.apiWrite);
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

    const claim=()=>orm.transaction(async (tx) => {
      await tx.select({id:schema.users.id}).from(schema.users).where(inArray(schema.users.id,[newUserId,referrer.id])).orderBy(schema.users.id).for("update");
      const [currentReferrer]=await tx.select({id:schema.users.id,referredBy:schema.users.referredBy}).from(schema.users).where(and(eq(schema.users.id,referrer.id),eq(schema.users.referralCode,body.referralCode),isNull(schema.users.deletedAt),eq(schema.users.isBanned,false),sql`NOT(COALESCE(${schema.users.isSuspended},false) AND (${schema.users.suspendedUntil} IS NULL OR ${schema.users.suspendedUntil}>NOW()))`));
      if(!currentReferrer)throw badRequest("Referral code is no longer available");
      const ancestry=await tx.execute<{unsafe:boolean}>(sql`WITH RECURSIVE chain AS (
        SELECT id,referred_by,ARRAY[id] path,false cycle FROM users WHERE id=${referrer.id}
        UNION ALL SELECT u.id,u.referred_by,c.path||u.id,u.id=ANY(c.path) FROM chain c JOIN users u ON u.id=c.referred_by WHERE NOT c.cycle AND cardinality(c.path)<64
      ) SELECT COALESCE(bool_or(id=${newUserId} OR cycle OR (cardinality(path)>=64 AND referred_by IS NOT NULL)),false) unsafe FROM chain`);
      if(ancestry.rows[0].unsafe)throw badRequest("This referral would create a cyclic or unsupported referral chain","REFERRAL_CYCLE");
      const [account] = await tx.select({referredBy:schema.users.referredBy}).from(schema.users).where(eq(schema.users.id,newUserId)).for("update");
      if (!account) throw badRequest("Account unavailable");
      if (account.referredBy && account.referredBy !== referrer.id) throw badRequest("A referrer has already been assigned", "REFERRER_ALREADY_ASSIGNED");
      // Check if tier-1 referral already exists (idempotency)
      const [existing] = await tx
        .select({ id: schema.referrals.id,referrerId:schema.referrals.referrerId })
        .from(schema.referrals)
        .where(
          and(
            eq(schema.referrals.tier, 1),
            eq(schema.referrals.referredId, newUserId)
          )
        )
        .limit(1);

      if(existing&&existing.referrerId!==referrer.id)throw badRequest("A referrer has already been assigned","REFERRER_ALREADY_ASSIGNED");
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
      if (currentReferrer.referredBy && currentReferrer.referredBy !== newUserId && currentReferrer.referredBy !== referrer.id) {
        const [existingTier2] = await tx
          .select({ id: schema.referrals.id })
          .from(schema.referrals)
          .where(
            and(
              eq(schema.referrals.referrerId, currentReferrer.referredBy),
              eq(schema.referrals.referredId, newUserId),
              eq(schema.referrals.tier, 2)
            )
          )
          .limit(1);

        if (!existingTier2) {
          await tx.insert(schema.referrals).values({
            referrerId: currentReferrer.referredBy,
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
    },{isolationLevel:"serializable"});
    for(let attempt=0;;attempt++){
      try{await claim();break;}catch(error){
        let cause=error as {code?:string;cause?:unknown};for(let depth=0;depth<3&&cause.cause;depth++)cause=cause.cause as typeof cause;
        if(!['40001','40P01'].includes(cause.code??'')||attempt>=2)throw error;
        await new Promise(resolve=>setTimeout(resolve,Math.round((5+Math.random()*10)*2**attempt)));
      }
    }

    return NextResponse.json({
      success: true,
      data: { referrerId: referrer.id },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});
