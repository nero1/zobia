export const dynamic = "force-dynamic";

/**
 * app/api/blogs/[slug]/gifts/route.ts
 *
 * GET  — public: this blog's active, purchasable gift tiers.
 * POST — blog owner only: create a new gift tier.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, notFound } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { getBlogBySlug } from "@/lib/blogs/repo";
import { createGiftTier, listPublicGiftTiers } from "@/lib/blogs/service";

const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).optional().nullable(),
  creditsPrice: z.number().int().min(1).max(1_000_000).optional().nullable(),
  starsPrice: z.number().int().min(1).max(1_000_000).optional().nullable(),
  benefitType: z.enum(["vip_badge", "vip_section_access", "custom_reward"]),
  benefitConfig: z.record(z.any()).optional(),
  maxRedemptions: z.number().int().min(1).max(1_000_000).optional().nullable(),
  expiresAt: z.string().datetime().optional().nullable(),
});

export async function GET(_req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const blog = await getBlogBySlug(slug);
    if (!blog) throw notFound("Blog not found");
    const tiers = await listPublicGiftTiers(blog.id);
    return NextResponse.json({ success: true, data: { tiers }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
}

export const POST = withAuth<{ slug: string }>(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.blogWrite);
    const blog = await getBlogBySlug(params.slug);
    if (!blog) throw notFound("Blog not found");

    const body = await validateBody(req, createSchema);
    const tier = await createGiftTier(auth.user.sub, blog.id, body);
    return NextResponse.json({ success: true, data: { tier }, error: null }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
});
