/**
 * lib/uploads/uploadImage.ts
 *
 * Shared "validate → compress-or-sanitize → store" pipeline for platform
 * image uploads (tweets, moments, forum attachments, and any future upload
 * surface). Extracted from what were three near-identical copies of this
 * logic in app/api/{tweets,moments,forum}/uploads/image/route.ts.
 */

import crypto from "crypto";
import { uploadPublicMedia } from "@/lib/storage/publicMedia";
import { compressImage, type CompressionProfile } from "@/lib/storage/compress";
import { badRequest } from "@/lib/api/errors";
import {
  MAX_IMAGE_UPLOAD_BYTES,
  assertValidImageUpload,
  isSvg,
  sanitizeSvg,
  extensionForMime,
} from "@/lib/uploads/imageValidation";

export interface UploadImageOptions {
  /** Storage key prefix, e.g. "tweets", "moments", "forum". Final key is `${keyPrefix}/${userId}/${timestamp}-${uuid}.${ext}`. */
  keyPrefix: string;
  userId: string;
  /** Raster compression profile (ignored for SVGs, which are never rasterized). */
  compressionProfile: CompressionProfile;
  /** Included in the compression-failure log line to identify the caller. */
  logContext: string;
}

/**
 * Validate, then (for raster formats) compress or (for SVG) sanitize, then
 * upload `file` to storage. Throws a `badRequest()` ApiError on invalid
 * input — let it propagate to the route's `handleApiError()`.
 */
export async function uploadValidatedImage(
  file: File,
  opts: UploadImageOptions
): Promise<{ url: string }> {
  assertValidImageUpload(file);

  const rawBuffer = Buffer.from(await file.arrayBuffer());
  let finalBuffer: Buffer;
  let finalMimeType: string;

  if (isSvg(file.type)) {
    finalBuffer = Buffer.from(sanitizeSvg(rawBuffer.toString("utf8")), "utf8");
    finalMimeType = "image/svg+xml";
  } else {
    const compressed = await compressImage(rawBuffer, { profile: opts.compressionProfile }).catch(() => { throw badRequest("Invalid or unsupported image data"); });
    finalBuffer = compressed.buffer;
    finalMimeType = compressed.mimeType;
  }

  const ext = extensionForMime(finalMimeType);
  const key = `${opts.keyPrefix}/${opts.userId}/${Date.now()}-${crypto.randomUUID()}.${ext}`;
  const result = await uploadPublicMedia(opts.userId,key, finalBuffer, {
    contentType: finalMimeType,
    isPublic: true,
    maxSizeBytes: MAX_IMAGE_UPLOAD_BYTES,
  });

  return { url: result.publicUrl };
}
