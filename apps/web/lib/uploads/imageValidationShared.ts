/**
 * lib/uploads/imageValidationShared.ts
 *
 * Client-safe half of the image-upload constants (no server-only imports —
 * safe to bundle into client components for instant pre-upload feedback).
 * lib/uploads/imageValidation.ts (server-side) re-exports these so there is
 * still one source of truth.
 */

/** Platform-wide default max image upload size: 1 MiB. */
export const MAX_IMAGE_UPLOAD_BYTES = 1 * 1024 * 1024;

export const ALLOWED_IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/avif",
  "image/svg+xml",
]);

/** `accept` attribute value for `<input type="file">` image pickers. */
export const IMAGE_ACCEPT_ATTR = Array.from(ALLOWED_IMAGE_MIME_TYPES).join(",");

export const IMAGE_UPLOAD_MAX_MB = Math.floor(MAX_IMAGE_UPLOAD_BYTES / (1024 * 1024));

export function isImageFileValid(file: File): { ok: true } | { ok: false; message: string } {
  if (file.size > MAX_IMAGE_UPLOAD_BYTES) {
    return { ok: false, message: `Image is too large (max ${IMAGE_UPLOAD_MAX_MB}MB).` };
  }
  if (!ALLOWED_IMAGE_MIME_TYPES.has(file.type)) {
    return { ok: false, message: "Unsupported image type. Use GIF, JPEG, PNG, SVG, AVIF, or WebP." };
  }
  return { ok: true };
}
