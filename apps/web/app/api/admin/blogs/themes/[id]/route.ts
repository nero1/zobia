export const dynamic = "force-dynamic";

/**
 * app/api/admin/blogs/themes/[id]/route.ts
 *
 * PATCH /api/admin/blogs/themes/<id> — admin control over one theme:
 * enabled toggle, plan/business-tier gating, credits/stars price.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAdminAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { adminUpdateTheme } from "@/lib/blogs/themes";

const bodySchema = z.object({
  enabled: z.boolean().optional(),
  includedForPlans: z.array(z.enum(["free", "plus", "pro", "max"])).optional(),
  includedForBusinessTiers: z.array(z.enum(["starter", "growth", "enterprise"])).optional(),
  creditsCost: z.number().int().min(0).max(1_000_000).nullable().optional(),
  starsCost: z.number().int().min(0).max(1_000_000).nullable().optional(),
});

export const PATCH = withAdminAuth<{ id: string }>(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);
    const body = await validateBody(req, bodySchema);
    await adminUpdateTheme(params.id, body);
    return NextResponse.json({ success: true, data: { updated: true }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
