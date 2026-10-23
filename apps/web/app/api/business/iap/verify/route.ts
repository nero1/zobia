export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { requireFeatureEnabled } from "@/lib/manifest";
import { badRequest, handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { EXPECTED_PACKAGE_NAME } from "@/lib/payments/googlePlayVerify";
import { activatePlayBusiness } from "@/lib/plans/playSubscription";
const input = z.object({
  purchaseToken: z.string().min(1).max(4096),
  productId: z.string().regex(/^[a-z0-9][a-z0-9._]{0,147}$/),
  packageName: z.string().min(1),
  business_name: z.string().trim().min(2).max(120).optional(),
  business_type: z.string().max(80).optional(),
});
export const POST = withAuth(async (req, { auth }) => {
  try {
    await requireFeatureEnabled("businessAccounts");
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);
    const body = await validateBody(req, input);
    if (body.packageName !== EXPECTED_PACKAGE_NAME) throw badRequest("Invalid package name", "INVALID_PACKAGE_NAME");
    const data = await activatePlayBusiness(auth.user.sub, body.packageName, body.productId, body.purchaseToken, body);
    return NextResponse.json({ success: true, data });
  } catch (error) { return handleApiError(error); }
});
