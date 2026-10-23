/**
 * lib/storage/providers/r2.ts
 *
 * Cloudflare R2 storage adapter.
 *
 * R2 is S3-compatible, so this adapter uses the AWS SDK v3 S3 client with
 * the R2 endpoint.  All credentials are read from validated env vars.
 */

import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  HeadObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl as awsGetSignedUrl } from "@aws-sdk/s3-request-presigner";
import type {
  StorageAdapter,
  UploadOptions,
  UploadResult,
  DeleteOptions,
} from "../interface";
import { env } from "@/lib/env";
import { isPrivateStorageKey, storageKey } from "../privacy";

// ---------------------------------------------------------------------------
// Client factory
// ---------------------------------------------------------------------------

let _client: S3Client | null = null;

/**
 * Returns the shared S3Client configured for Cloudflare R2.
 * Validates required env vars at first call.
 */
function getClient(): S3Client {
  if (!_client) {
    const s3 = env.STORAGE_PROVIDER === "s3";
    const accountId = s3 ? "s3" : env.R2_ACCOUNT_ID;
    const accessKeyId = s3 ? process.env.S3_ACCESS_KEY_ID : env.R2_ACCESS_KEY_ID;
    const secretAccessKey = s3 ? process.env.S3_SECRET_ACCESS_KEY : env.R2_SECRET_ACCESS_KEY;

    if (!accountId || !accessKeyId || !secretAccessKey) {
      throw new Error(
        "[storage:r2] R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY " +
          "must be set when STORAGE_PROVIDER=r2"
      );
    }

    _client = new S3Client({
      region: s3 ? process.env.S3_REGION ?? "us-east-1" : "auto",
      ...(s3 ? (process.env.S3_ENDPOINT ? { endpoint: process.env.S3_ENDPOINT } : {}) : { endpoint: `https://${accountId}.r2.cloudflarestorage.com` }),
      requestHandler: { requestTimeout: 10_000, connectionTimeout: 5_000 },
      credentials: { accessKeyId, secretAccessKey },
    });
  }
  return _client;
}

/** Resolve bucket name from env. */
function getBucket(key = ""): string {
  const publicBucket = env.STORAGE_PROVIDER === "s3" ? process.env.S3_BUCKET_NAME : env.R2_BUCKET_NAME;
  if (isPrivateStorageKey(key)) {
    const bucket = env.STORAGE_PROVIDER === "s3" ? process.env.S3_PRIVATE_BUCKET_NAME : process.env.R2_PRIVATE_BUCKET_NAME;
    if (!bucket || bucket === publicBucket) throw new Error("Configure a separate private storage bucket for KYC and exports");
    return bucket;
  }
  if (!publicBucket) {
    throw new Error("[storage:r2] R2_BUCKET_NAME must be set when STORAGE_PROVIDER=r2");
  }
  return publicBucket;
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

/**
 * Cloudflare R2 storage adapter (S3-compatible).
 * Uses @aws-sdk/client-s3 with the R2 endpoint for all operations.
 */
export class R2StorageAdapter implements StorageAdapter {
  /** @inheritdoc */
  getPublicUrl(key: string): string {
    if (isPrivateStorageKey(key)) return "";
    const base = env.STORAGE_PROVIDER === "s3" ? process.env.S3_PUBLIC_URL : env.R2_PUBLIC_URL;
    if (!base) {
      throw new Error("[storage:r2] R2_PUBLIC_URL must be set to build public URLs");
    }
    return `${base.replace(/\/$/, "")}/${key}`;
  }

  /** @inheritdoc */
  async upload(
    key: string,
    buffer: Buffer,
    options: UploadOptions = {}
  ): Promise<UploadResult> {
    key = storageKey(key, options.isPublic ?? true);
    const {
      contentType = "application/octet-stream",
      cacheControl = "public, max-age=31536000, immutable",
      metadata,
      maxSizeBytes = 50 * 1024 * 1024,
    } = options;

    // BUG-016: Enforce upload size limit before sending to R2.
    if (buffer.byteLength > maxSizeBytes) {
      throw new Error(
        `Upload size exceeded: file is ${buffer.byteLength} bytes but limit is ${maxSizeBytes} bytes`
      );
    }

    await getClient().send(
      new PutObjectCommand({
        Bucket: getBucket(key),
        Key: key,
        Body: buffer,
        ContentType: contentType,
        CacheControl: isPrivateStorageKey(key) ? "private, no-store" : cacheControl,
        Metadata: metadata,
      })
    );

    return {
      key,
      publicUrl: this.getPublicUrl(key),
      contentType,
      size: buffer.byteLength,
    };
  }

  /** @inheritdoc */
  async getSignedUrl(key: string, expiresIn = 3600): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: getBucket(key),
      Key: key,
    });
    return awsGetSignedUrl(getClient(), command, { expiresIn });
  }

  /** @inheritdoc */
  async delete(key: string, options: DeleteOptions = {}): Promise<void> {
    const { ignoreNotFound = true } = options;
    try {
      await getClient().send(
        new DeleteObjectCommand({ Bucket: getBucket(key), Key: key })
      );
    } catch (err: unknown) {
      const code = (err as { Code?: string; name?: string })?.Code ?? (err as { name?: string })?.name;
      if (ignoreNotFound && (code === "NoSuchKey" || code === "NotFound")) return;
      throw err;
    }
  }

  /** @inheritdoc */
  async deleteMany(keys: string[]): Promise<void> {
    // DeleteObjects has a 1,000-object limit and can report partial success.
    for (const key of keys) await this.delete(key);
  }

  /** @inheritdoc */
  async exists(key: string): Promise<boolean> {
    try {
      await getClient().send(
        new HeadObjectCommand({ Bucket: getBucket(key), Key: key })
      );
      return true;
    } catch {
      return false;
    }
  }
}
