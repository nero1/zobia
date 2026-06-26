/**
 * lib/storage/interface.ts
 *
 * TypeScript interface that every storage adapter must implement.
 * Application code should only depend on this interface so the underlying
 * provider (Supabase Storage, Cloudflare R2, AWS S3) can be swapped without
 * touching business logic.
 */

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

/** Metadata returned after a successful upload. */
export interface UploadResult {
  /** Provider-relative path / key of the stored object. */
  key: string;
  /** Publicly accessible URL (or CDN URL) for the object. */
  publicUrl: string;
  /** MIME content type of the stored object. */
  contentType: string;
  /** Size of the stored object in bytes. */
  size: number;
}

/** Options accepted by the upload method. */
export interface UploadOptions {
  /**
   * MIME content type. Inferred from the buffer when omitted.
   * @default 'application/octet-stream'
   */
  contentType?: string;
  /** Cache-Control header value applied to the stored object. */
  cacheControl?: string;
  /** Whether the object should be publicly accessible. @default true */
  isPublic?: boolean;
  /** Additional provider-specific metadata key/value pairs. */
  metadata?: Record<string, string>;
  /**
   * Maximum allowed upload size in bytes. Upload throws if the buffer exceeds
   * this limit. Defaults to 50 MiB when not specified.
   * @default 52428800 (50 MiB)
   */
  maxSizeBytes?: number;
}

/** Options accepted by the delete method. */
export interface DeleteOptions {
  /** Silently succeed if the object does not exist. @default true */
  ignoreNotFound?: boolean;
}

// ---------------------------------------------------------------------------
// Adapter interface
// ---------------------------------------------------------------------------

/**
 * All storage adapters must implement this interface.
 */
export interface StorageAdapter {
  /**
   * Upload a file buffer to the storage backend.
   *
   * @param key     - Storage path / key (e.g. `avatars/user-123.webp`)
   * @param buffer  - Raw file data
   * @param options - Upload options
   * @returns Metadata about the stored object including its public URL
   */
  upload(
    key: string,
    buffer: Buffer,
    options?: UploadOptions
  ): Promise<UploadResult>;

  /**
   * Generate a short-lived pre-signed URL for private object downloads.
   *
   * @param key        - Storage path / key of the object
   * @param expiresIn  - Validity duration in seconds (default 3600)
   * @returns Pre-signed URL string
   */
  getSignedUrl(key: string, expiresIn?: number): Promise<string>;

  /**
   * Delete an object from storage.
   *
   * @param key     - Storage path / key of the object
   * @param options - Delete options
   */
  delete(key: string, options?: DeleteOptions): Promise<void>;

  /**
   * Delete multiple objects from storage in a single request (where supported).
   *
   * @param keys - Array of storage paths / keys
   */
  deleteMany(keys: string[]): Promise<void>;

  /**
   * Check whether an object exists in the storage backend.
   *
   * @param key - Storage path / key
   */
  exists(key: string): Promise<boolean>;

  /**
   * Return the public URL for a given key without hitting the network.
   * Useful when the URL pattern is deterministic (e.g. R2 public buckets).
   *
   * @param key - Storage path / key
   */
  getPublicUrl(key: string): string;
}
