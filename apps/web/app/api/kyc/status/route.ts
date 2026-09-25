export const dynamic = "force-dynamic";

/**
 * GET /api/kyc/status
 *
 * Returns the caller's current KYC state: approved tier, submission
 * history (most recent first), and the public-facing config the client
 * needs to render the flow (cost, badge threshold).
 */

import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { loadManifest } from "@/lib/manifest";

export const GET = withAuth(async (_req: NextRequest, { auth }) => {
  try {
    const userId = auth.user.sub;
    await enforceRateLimit(userId, "user", RATE_LIMITS.apiRead);

    const manifest = await loadManifest();
    const orm = await getDb();

    const [userRows, submissionRows] = await Promise.all([
      orm
        .select({ kycTier: schema.users.kycTier, isVerified: schema.users.isVerified })
        .from(schema.users)
        .where(eq(schema.users.id, userId))
        .limit(1),
      orm
        .select({
          id: schema.kycSubmissions.id,
          tier: schema.kycSubmissions.tier,
          status: schema.kycSubmissions.status,
          account_type: schema.kycSubmissions.accountType,
          citizenship_country: schema.kycSubmissions.citizenshipCountry,
          video_url: schema.kycSubmissions.videoUrl,
          rejection_reason: schema.kycSubmissions.rejectionReason,
          submitted_at: schema.kycSubmissions.submittedAt,
          reviewed_at: schema.kycSubmissions.reviewedAt,
        })
        .from(schema.kycSubmissions)
        .where(eq(schema.kycSubmissions.userId, userId))
        .orderBy(desc(schema.kycSubmissions.submittedAt))
        .limit(20),
    ]);

    return NextResponse.json({
      success: true,
      data: {
        kycTier: userRows[0]?.kycTier ?? 0,
        isVerified: userRows[0]?.isVerified ?? false,
        submissions: submissionRows,
        config: {
          costCredits: manifest.kyc.costCredits,
          badgeMinTier: manifest.kyc.badgeMinTier,
        },
      },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});
