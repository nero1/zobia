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
    const accountId = env.R2_ACCOUNT_ID;
    const accessKeyId = env.R2_ACCESS_KEY_ID;
    const secretAccessKey = env.R2_SECRET_ACCESS_KEY;

    if (!accountId || !accessKeyId || !secretAccessKey) {
      throw new Error(
        "[storage:r2] R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY " +
          "must be set when STORAGE_PROVIDER=r2"
      );
    }

    _client = new S3Client({
      region: "auto",
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
    });
  }
  return _client;
}

/** Resolve bucket name from env. */
function getBucket(): string {
  if (!env.R2_BUCKET_NAME) {
    throw new Error("[storage:r2] R2_BUCKET_NAME must be set when STORAGE_PROVIDER=r2");
  }
  return env.R2_BUCKET_NAME;
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
    const base = env.R2_PUBLIC_URL;
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
    const {
      contentType = "application/octet-stream",
      cacheControl = "public, max-age=31536000, immutable",
      metadata,
    } = options;

    await getClient().send(
      new PutObjectCommand({
        Bucket: getBucket(),
        Key: key,
        Body: buffer,
        ContentType: contentType,
        CacheControl: cacheControl,
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
      Bucket: getBucket(),
      Key: key,
    });
    return awsGetSignedUrl(getClient(), command, { expiresIn });
  }

  /** @inheritdoc */
  async delete(key: string, options: DeleteOptions = {}): Promise<void> {
    const { ignoreNotFound = true } = options;
    try {
      await getClient().send(
        new DeleteObjectCommand({ Bucket: getBucket(), Key: key })
      );
    } catch (err: unknown) {
      const code = (err as { Code?: string; name?: string })?.Code ?? (err as { name?: string })?.name;
      if (ignoreNotFound && (code === "NoSuchKey" || code === "NotFound")) return;
      throw err;
    }
  }

  /** @inheritdoc */
  async deleteMany(keys: string[]): Promise<void> {
    if (keys.length === 0) return;

    await getClient().send(
      new DeleteObjectsCommand({
        Bucket: getBucket(),
        Delete: {
          Objects: keys.map((k) => ({ Key: k })),
          Quiet: true,
        },
      })
    );
  }

  /** @inheritdoc */
  async exists(key: string): Promise<boolean> {
    try {
      await getClient().send(
        new HeadObjectCommand({ Bucket: getBucket(), Key: key })
      );
      return true;
    } catch {
      return false;
    }
  }
}
