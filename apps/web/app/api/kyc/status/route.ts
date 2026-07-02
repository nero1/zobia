export const dynamic = "force-dynamic";

/**
 * GET /api/kyc/status
 *
 * Returns the caller's current KYC state: approved tier, submission
 * history (most recent first), and the public-facing config the client
 * needs to render the flow (cost, badge threshold).
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { loadManifest } from "@/lib/manifest";

interface SubmissionRow {
  id: string;
  tier: number;
  status: string;
  account_type: string;
  citizenship_country: string | null;
  video_url: string | null;
  rejection_reason: string | null;
  submitted_at: string;
  reviewed_at: string | null;
}

export const GET = withAuth(async (_req: NextRequest, { auth }) => {
  try {
    const userId = auth.user.sub;
    await enforceRateLimit(userId, "user", RATE_LIMITS.apiRead);

    const manifest = await loadManifest();

    const [{ rows: userRows }, { rows: submissions }] = await Promise.all([
      db.query<{ kyc_tier: number; is_verified: boolean }>(
        `SELECT kyc_tier, is_verified FROM users WHERE id = $1`,
        [userId]
      ),
      db.query<SubmissionRow>(
        `SELECT id, tier, status, account_type, citizenship_country, video_url, rejection_reason, submitted_at, reviewed_at
         FROM kyc_submissions WHERE user_id = $1 ORDER BY submitted_at DESC LIMIT 20`,
        [userId]
      ),
    ]);

    return NextResponse.json({
      success: true,
      data: {
        kycTier: userRows[0]?.kyc_tier ?? 0,
        isVerified: userRows[0]?.is_verified ?? false,
        submissions,
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
