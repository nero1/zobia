export const dynamic = "force-dynamic";

/**
 * app/api/forum/uploads/image/route.ts
 *
 * POST — upload an image to attach to a forum thread/post. Multipart form
 * upload (`file` field). Charges the admin-configured Credits/Stars cost
 * (manifest.bbforum.imageCostCredits/imageCostStars) — the actual debit
 * happens atomically with the thread/post insert in lib/bbforum/service, so
 * this route only checks affordability up front and returns the uploaded
 * URL; the caller (NewThreadForm/ReplyForm) then submits that URL as
 * `imageUrl` on the create-thread/reply call.
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api/middleware";
import { requireFeatureEnabled } from "@/lib/manifest";
import { handleApiError, badRequest } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { getBbforumEligibility } from "@/lib/bbforum/service";
import { uploadValidatedImage } from "@/lib/uploads/uploadImage";

export const POST = withAuth(async (req: NextRequest, { auth }: { auth: { user: { sub: string } } }) => {
  try {
    await requireFeatureEnabled("bbforum");
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);

    const eligibility = await getBbforumEligibility(auth.user.sub);
    const { imageCostCredits, imageCostStars } = eligibility.config;
    if (imageCostCredits > 0 && eligibility.creditBalance < imageCostCredits) {
      throw badRequest(`You need ${imageCostCredits} Credits to attach an image.`, "INSUFFICIENT_BBFORUM_IMAGE_FUNDS");
    }
    if (imageCostStars > 0 && eligibility.starBalance < imageCostStars) {
      throw badRequest(`You need ${imageCostStars} Stars to attach an image.`, "INSUFFICIENT_BBFORUM_IMAGE_FUNDS");
    }

    const formData = await req.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) throw badRequest("No file provided");

    const { url } = await uploadValidatedImage(file, {
      keyPrefix: "forum",
      userId: auth.user.sub,
      compressionProfile: "message",
      logContext: "bbforum/uploads",
    });

    return NextResponse.json({
      success: true,
      data: { url, costCredits: imageCostCredits, costStars: imageCostStars },
      error: null,
    }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
});
