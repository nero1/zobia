export const dynamic = "force-dynamic";

/**
 * app/api/moments/uploads/image/route.ts
 *
 * POST — upload an image to attach to a Moment. Multipart form upload
 * (`file` field). Mirrors app/api/forum/uploads/image/route.ts's pattern;
 * unlike the forum's attachment, Moments images aren't separately priced —
 * the Moment's own Credits/Stars cost (checked at POST /api/moments) already
 * covers it — so this route only stores the file and returns its public URL.
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api/middleware";
import { requireFeatureEnabled } from "@/lib/manifest";
import { handleApiError, badRequest } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { storage } from "@/lib/storage";
import { compressImage } from "@/lib/storage/compress";
import { logger } from "@/lib/logger";

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024; // 8 MiB raw input cap
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export const POST = withAuth(async (req: NextRequest, { auth }: { auth: { user: { sub: string } } }) => {
  try {
    await requireFeatureEnabled("moments");
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);

    const formData = await req.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) throw badRequest("No file provided");
    if (file.size > MAX_UPLOAD_BYTES) throw badRequest("Image is too large (max 8MB).");
    if (!ALLOWED_MIME.has(file.type)) throw badRequest("Unsupported image type. Use JPEG, PNG, WebP, or GIF.");

    const rawBuffer = Buffer.from(await file.arrayBuffer());
    const compressed = await compressImage(rawBuffer, { profile: "message" }).catch((err) => {
      logger.error({ err, userId: auth.user.sub }, "[moments/uploads] image compression failed, using original");
      return { buffer: rawBuffer, mimeType: file.type, originalSizeBytes: rawBuffer.length, compressedSizeBytes: rawBuffer.length };
    });

    const ext = compressed.mimeType === "image/webp" ? "webp" : compressed.mimeType.split("/")[1] || "jpg";
    const key = `moments/${auth.user.sub}/${Date.now()}-${crypto.randomUUID()}.${ext}`;
    const result = await storage.upload(key, compressed.buffer, { contentType: compressed.mimeType, isPublic: true, maxSizeBytes: MAX_UPLOAD_BYTES });

    return NextResponse.json({
      success: true,
      data: { url: result.publicUrl },
      error: null,
    }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
});
