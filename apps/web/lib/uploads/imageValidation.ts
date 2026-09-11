/**
 * lib/uploads/imageValidation.ts
 *
 * Single source of truth for image-upload constraints across the platform —
 * tweet/moment/forum attachments, blog cover images, ad creatives, etc.
 * Previously every upload route duplicated its own `MAX_UPLOAD_BYTES`/
 * `ALLOWED_MIME` inline (and disagreed: 8 MiB, JPEG/PNG/WebP/GIF only, no
 * SVG/AVIF support). Any NEW upload surface should import from here instead
 * of re-declaring its own constants, so the platform-wide default (and any
 * future admin-configurable override) only needs to change in one place.
 */

import { badRequest } from "@/lib/api/errors";
import { sanitizeSvg } from "@/lib/uploads/sanitizeSvg";
import {
  MAX_IMAGE_UPLOAD_BYTES,
  ALLOWED_IMAGE_MIME_TYPES,
  IMAGE_UPLOAD_MAX_MB,
} from "@/lib/uploads/imageValidationShared";

export { MAX_IMAGE_UPLOAD_BYTES, ALLOWED_IMAGE_MIME_TYPES };

const MIME_LABEL = "GIF, JPEG, PNG, SVG, AVIF, or WebP";

/**
 * Validate an uploaded image `File` against the platform-wide size/type
 * limits. Throws a `badRequest()` ApiError (400) on failure — callers can
 * let it propagate straight to `handleApiError()`.
 */
export function assertValidImageUpload(file: File): void {
  if (file.size > MAX_IMAGE_UPLOAD_BYTES) {
    throw badRequest(`Image is too large (max ${IMAGE_UPLOAD_MAX_MB}MB).`);
  }
  if (!ALLOWED_IMAGE_MIME_TYPES.has(file.type)) {
    throw badRequest(`Unsupported image type. Use ${MIME_LABEL}.`);
  }
}

/**
 * Prepare a validated image buffer for storage. SVGs are vector markup, not
 * raster data — they must never be run through the raster `compressImage()`
 * pipeline (which would rasterize them), and because a malicious SVG can
 * embed `<script>`/event-handler XSS, they are sanitized (not compressed)
 * before upload. Every other supported type is returned unchanged for the
 * caller to pass to `compressImage()`.
 */
export function isSvg(mimeType: string): boolean {
  return mimeType === "image/svg+xml";
}

export { sanitizeSvg };

/** File extension to use for a given (already-validated) image MIME type. */
export function extensionForMime(mimeType: string): string {
  if (mimeType === "image/svg+xml") return "svg";
  if (mimeType === "image/jpeg") return "jpg";
  return mimeType.split("/")[1] || "bin";
}
