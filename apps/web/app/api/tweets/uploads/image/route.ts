export const dynamic = "force-dynamic";

/**
 * app/api/tweets/uploads/image/route.ts
 *
 * POST — upload an image to attach to a Tweet. Multipart form upload
 * (`file` field). Mirrors app/api/moments/uploads/image/route.ts's pattern —
 * this route only stores the file and returns its public URL; the Tweet's
 * own Credits cost (checked at POST /api/tweets, `tweets_image_cost_credits`)
 * is charged atomically with the Tweet's creation, not here.
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api/middleware";
import { requireFeatureEnabled } from "@/lib/manifest";
import { handleApiError, badRequest } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { uploadValidatedImage } from "@/lib/uploads/uploadImage";

export const POST = withAuth(async (req: NextRequest, { auth }: { auth: { user: { sub: string } } }) => {
  try {
    await requireFeatureEnabled("tweets");
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);

    const formData = await req.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) throw badRequest("No file provided");

    const { url } = await uploadValidatedImage(file, {
      keyPrefix: "tweets",
      userId: auth.user.sub,
      compressionProfile: "message",
      logContext: "tweets/uploads",
    });

    return NextResponse.json({
      success: true,
      data: { url },
      error: null,
    }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
});
