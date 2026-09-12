export const dynamic = "force-dynamic";

/**
 * app/api/users/me/avatar/route.ts
 *
 * Profile Pictures feature — custom avatar photo upload.
 *
 * POST /api/users/me/avatar
 *   Multipart form upload (`file` field, plus optional `currency` field —
 *   "credits" | "stars" — the caller's preferred payment method when a
 *   charge is required).
 *
 *   - Paid-plan users (plan !== "free"): free, no charge.
 *   - Free-plan users: charged the admin-configured cost (Credits or Stars,
 *     see manifest.avatarChange) atomically with the change.
 *   - Rejected with 429 if within the once-a-week cooldown
 *     (see lib/profile/avatarService.ts).
 *   - Animated GIFs are reduced to their 2nd frame server-side before
 *     storing — avatars are never animated (avatar-path-specific; other
 *     upload surfaces keep full animated GIFs).
 *
 * GET /api/users/me/avatar
 *   Returns the caller's current avatar-change eligibility (cost, cooldown)
 *   so the client can render the crop modal's cost/cooldown copy up front.
 */

import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError, badRequest } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { storage } from "@/lib/storage";
import { compressImage, extractGifSecondFrame } from "@/lib/storage/compress";
import { getAvatarEligibility, applyCustomAvatar, type AvatarCurrency } from "@/lib/profile/avatarService";
import { logger } from "@/lib/logger";

// Raw upload cap before crop/compression — the client-side crop modal
// already downsizes to a square before sending, so this is a generous
// backstop against abuse rather than the expected size.
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024; // 8 MiB
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

// ---------------------------------------------------------------------------
// GET — eligibility (cost + cooldown) for the crop modal
// ---------------------------------------------------------------------------

export const GET = withAuth(async (_req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);
    const eligibility = await getAvatarEligibility(auth.user.sub);
    return NextResponse.json({ success: true, data: eligibility, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});

// ---------------------------------------------------------------------------
// POST — upload a custom avatar photo
// ---------------------------------------------------------------------------

export const POST = withAuth(async (req: NextRequest, { auth }: { auth: { user: { sub: string } } }) => {
  const userId = auth.user.sub;
  try {
    await enforceRateLimit(userId, "user", RATE_LIMITS.apiWrite);

    const formData = await req.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) throw badRequest("No file provided");
    if (file.size > MAX_UPLOAD_BYTES) throw badRequest("Image is too large (max 8MB).");
    if (!ALLOWED_MIME.has(file.type)) {
      throw badRequest("Unsupported image type. Use JPEG, PNG, WebP, or GIF.");
    }

    const currencyRaw = formData.get("currency");
    const currency: AvatarCurrency | null =
      currencyRaw === "credits" || currencyRaw === "stars" ? currencyRaw : null;

    let rawBuffer: Buffer = Buffer.from(await file.arrayBuffer());
    let sourceMimeType = file.type;

    // Avatar-specific: an animated GIF is reduced to its 2nd frame so the
    // stored avatar is always static. Other upload surfaces (tweets,
    // moments, forum) are untouched by this and keep full animated GIFs.
    if (sourceMimeType === "image/gif") {
      const secondFrame = await extractGifSecondFrame(rawBuffer);
      if (secondFrame) {
        rawBuffer = secondFrame.buffer;
        sourceMimeType = secondFrame.mimeType;
      }
    }

    const compressed = await compressImage(rawBuffer, { profile: "avatar" }).catch((err) => {
      logger.error({ err, userId }, "[users/me/avatar] compression failed, using uncompressed frame");
      return {
        buffer: rawBuffer,
        mimeType: sourceMimeType,
        originalSizeBytes: rawBuffer.length,
        compressedSizeBytes: rawBuffer.length,
      };
    });

    const ext = compressed.mimeType === "image/webp" ? "webp" : compressed.mimeType.split("/")[1] || "jpg";
    const key = `avatars/${userId}/${Date.now()}-${randomUUID()}.${ext}`;
    const uploaded = await storage.upload(key, compressed.buffer, {
      contentType: compressed.mimeType,
      isPublic: true,
      maxSizeBytes: MAX_UPLOAD_BYTES,
    });

    // Charge (if required) and persist atomically. If this throws (cooldown
    // race, insufficient funds), the object above is left orphaned in
    // storage but the user is never charged for a change that didn't apply —
    // same trade-off lib/moments/service.ts makes for its media uploads.
    const result = await applyCustomAvatar(userId, uploaded.publicUrl, currency);

    return NextResponse.json(
      {
        success: true,
        data: {
          avatarUrl: result.avatarUrl,
          charged: result.charged,
          costCredits: result.costCredits,
          costStars: result.costStars,
        },
        error: null,
      },
      { status: 201 }
    );
  } catch (err) {
    return handleApiError(err);
  }
});
