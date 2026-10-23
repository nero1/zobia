import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError, badRequest, forbidden } from "@/lib/api/errors";
import { taleAccount, taleSetting } from "@/lib/tales/service";
import { getRankForXP } from "@/lib/xp/engine";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { uploadValidatedImage } from "@/lib/uploads/uploadImage";
export const POST = withAuth(async (req, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);
    const account = await taleAccount(auth.user.sub);
    if (
      getRankForXP(Number(account.user.xpTotal)).rankNumber <
      (await taleSetting("tales_min_level", 2))
    )
      throw forbidden("Reach the required level to upload a Tales cover.");
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw badRequest("No image provided.");
    return NextResponse.json({
      success: true,
      data: await uploadValidatedImage(file, {
        keyPrefix: "tales",
        userId: auth.user.sub,
        compressionProfile: "message",
        logContext: "tales/cover",
      }),
      error: null,
    });
  } catch (error) {
    return handleApiError(error);
  }
});
