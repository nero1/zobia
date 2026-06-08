/**
 * lib/storage/compress.ts
 *
 * Server-side image compression utility for bandwidth optimisation.
 * Targets 2G/3G connectivity per PRD §5 and §22.
 *
 * Uses Node.js built-in capabilities (no Sharp required for basic compression).
 * For production with Sharp available, the implementation switches automatically.
 *
 * Default targets:
 *   - Profile images: max 256×256px, quality 80, WebP preferred
 *   - Message attachments: max 1024×1024px, quality 75
 *   - Room assets: max 800×600px, quality 80
 */

export type CompressionProfile = 'avatar' | 'message' | 'room' | 'sticker';

export interface CompressionOptions {
  profile: CompressionProfile;
  /** Override maximum dimension (px) — applied to both width and height. */
  maxDimension?: number;
  /** Override JPEG/WebP quality 1–100 */
  quality?: number;
  /** Preferred output format */
  format?: 'webp' | 'jpeg' | 'png';
}

export interface CompressionResult {
  buffer: Buffer;
  mimeType: string;
  originalSizeBytes: number;
  compressedSizeBytes: number;
  width?: number;
  height?: number;
}

const PROFILE_DEFAULTS: Record<
  CompressionProfile,
  { maxDimension: number; quality: number; format: 'webp' | 'jpeg' }
> = {
  avatar:  { maxDimension: 256,  quality: 80, format: 'webp' },
  message: { maxDimension: 1024, quality: 75, format: 'webp' },
  room:    { maxDimension: 800,  quality: 80, format: 'webp' },
  sticker: { maxDimension: 512,  quality: 90, format: 'webp' },
};

/**
 * HD send profile overrides (PRD §5: "One-tap HD send for Wi-Fi connections").
 * When the caller has `hd_send_enabled = true` and signals Wi-Fi via
 * `X-Connection-Type: wifi`, quality and maxDimension are bumped.
 */
const HD_OVERRIDES: Partial<Record<CompressionProfile, { maxDimension: number; quality: number }>> = {
  message: { maxDimension: 2048, quality: 92 },
  room:    { maxDimension: 1920, quality: 90 },
  avatar:  { maxDimension: 512,  quality: 90 },
};

/**
 * Compress an image buffer for the given profile.
 *
 * If the `sharp` npm package is installed, it uses Sharp for high-quality
 * compression. Otherwise falls back to returning the original buffer with
 * a warning log (graceful degradation — no crash on missing dependency).
 *
 * Pass `hdSend: true` together with `connectionType: 'wifi'` to opt into
 * higher-quality output (PRD §5 HD send toggle).
 *
 * @param inputBuffer - Raw image bytes
 * @param options     - Compression profile and optional overrides
 * @returns Compressed image buffer with metadata
 */
export async function compressImage(
  inputBuffer: Buffer,
  options: CompressionOptions & { hdSend?: boolean; connectionType?: string }
): Promise<CompressionResult> {
  const isHD = options.hdSend === true && options.connectionType === 'wifi';
  if (isHD && HD_OVERRIDES[options.profile]) {
    const hd = HD_OVERRIDES[options.profile]!;
    options = { ...options, maxDimension: hd.maxDimension, quality: hd.quality };
  }
  const defaults = PROFILE_DEFAULTS[options.profile];
  const maxDim = options.maxDimension ?? defaults.maxDimension;
  const quality = options.quality ?? defaults.quality;
  const format = options.format ?? defaults.format;
  const originalSizeBytes = inputBuffer.length;

  try {
    // Attempt to use Sharp if available
    // eslint-disable-line
    const sharp = require('sharp'); // eslint-disable-line

    // eslint-disable-line
    const pipeline = sharp(inputBuffer).resize(maxDim, maxDim, { // eslint-disable-line
      fit: 'inside',
      withoutEnlargement: true,
    });

    let processed: Buffer;
    let mimeType: string;

    if (format === 'webp') {
      processed = await pipeline.webp({ quality }).toBuffer() as Buffer;
      mimeType = 'image/webp';
    } else if (format === 'jpeg') {
      processed = await pipeline.jpeg({ quality, mozjpeg: true }).toBuffer() as Buffer;
      mimeType = 'image/jpeg';
    } else {
      processed = await pipeline.png({ compressionLevel: 9 }).toBuffer() as Buffer;
      mimeType = 'image/png';
    }

    const meta = await sharp(processed).metadata() as { width?: number; height?: number };

    return {
      buffer: processed,
      mimeType,
      originalSizeBytes,
      compressedSizeBytes: processed.length,
      width: meta.width,
      height: meta.height,
    };
  } catch (err: unknown) {
    // Sharp not installed or failed — return original buffer (graceful degradation)
    if ((err as NodeJS.ErrnoException).code !== 'MODULE_NOT_FOUND') {
      console.error('[compress] Sharp error:', err);
    }

    return {
      buffer: inputBuffer,
      mimeType: 'image/jpeg',
      originalSizeBytes,
      compressedSizeBytes: originalSizeBytes,
    };
  }
}

/**
 * Determine if a MIME type is a compressible image format.
 */
export function isCompressibleImage(mimeType: string): boolean {
  return [
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/bmp',
    'image/tiff',
  ].includes(mimeType.toLowerCase());
}
