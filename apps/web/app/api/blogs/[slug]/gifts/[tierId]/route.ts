export const dynamic = "force-dynamic";

/**
 * app/api/blogs/[slug]/gifts/[tierId]/route.ts
 *
 * PATCH — blog owner only: update/enable/disable a gift tier.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { updateGiftTier } from "@/lib/blogs/service";

const patchSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().trim().max(500).optional().nullable(),
  creditsPrice: z.number().int().min(1).max(1_000_000).optional().nullable(),
  starsPrice: z.number().int().min(1).max(1_000_000).optional().nullable(),
  benefitType: z.enum(["vip_badge", "vip_section_access", "custom_reward"]).optional(),
  benefitConfig: z.record(z.any()).optional(),
  maxRedemptions: z.number().int().min(1).max(1_000_000).optional().nullable(),
  expiresAt: z.string().datetime().optional().nullable(),
  enabled: z.boolean().optional(),
});

export const PATCH = withAuth<{ slug: string; tierId: string }>(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.blogWrite);
    const body = await validateBody(req, patchSchema);
    const tier = await updateGiftTier(auth.user.sub, params.tierId, body);
    return NextResponse.json({ success: true, data: { tier }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
