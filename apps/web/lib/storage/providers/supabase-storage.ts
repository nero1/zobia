/**
 * lib/storage/providers/supabase-storage.ts
 *
 * Supabase Storage adapter.
 *
 * Uses the Supabase Storage REST API directly (via fetch / axios) rather than
 * @supabase/supabase-js so this adapter stays decoupled from the Supabase
 * client SDK.  All auth is done with the service-role JWT derived from env.
 */

import axios from "axios";
const storageHttp=axios.create({timeout:10_000,maxRedirects:0,maxContentLength:5*1024*1024,maxBodyLength:5*1024*1024});
import { isPrivateStorageKey, storageKey, storagePath } from "../privacy";
import type {
  StorageAdapter,
  UploadOptions,
  UploadResult,
  DeleteOptions,
} from "../interface";
import { env } from "@/lib/env";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract the Supabase project URL and anon/service key from DATABASE_URL.
 * Expected format: postgresql://postgres:[password]@db.[ref].supabase.co:5432/postgres
 * The storage URL follows the pattern: https://[ref].supabase.co/storage/v1
 */
function getStorageBaseUrl(): string {
  const raw = env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!raw) throw new Error("SUPABASE_URL is required for Supabase Storage");
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("Supabase Storage requires an HTTPS project URL");
  return `${url.origin}/storage/v1`;
}
function bucketFor(key: string, publicBucket: string): string {
  if (!isPrivateStorageKey(key)) return publicBucket;
  const bucket = process.env.SUPABASE_PRIVATE_STORAGE_BUCKET ?? "zobia-private";
  if (bucket === publicBucket) throw new Error("Private storage must use a separate private bucket");
  return bucket;
}
const privateChecks = new Map<string, Promise<void>>();
async function assertPrivateBucket(bucket: string): Promise<void> {
  let check = privateChecks.get(bucket);
  if (!check) {
    check = storageHttp.get(`${getStorageBaseUrl()}/bucket/${encodeURIComponent(bucket)}`, { timeout: 5000, headers: { Authorization: `Bearer ${getServiceKey()}` } }).then(({data}) => { if (data.public !== false) throw new Error("KYC bucket must be private"); });
    privateChecks.set(bucket, check);
    check.catch(() => privateChecks.delete(bucket));
  }
  await check;
}

/** Resolve the public URL for an object in a public bucket. */
function buildPublicUrl(bucket: string, key: string): string {
  if (isPrivateStorageKey(key)) return "";
  return `${getStorageBaseUrl()}/object/public/${encodeURIComponent(bucket)}/${storagePath(key)}`;
}

/** Extract service role key from env – stored in JWT_SECRET for Supabase projects. */
function getServiceKey(): string {
  // Supabase service role key must be supplied as a dedicated env; fall back to JWT_SECRET
  // In practice teams set SUPABASE_SERVICE_ROLE_KEY – we read process.env directly here
  // because it is not in the Zod schema (it's provider-specific).
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for storage");
  return key;
}

// Default bucket name – can be overridden via env
const DEFAULT_BUCKET = process.env["SUPABASE_STORAGE_BUCKET"] ?? "zobia-media";

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

/**
 * Supabase Storage adapter.
 * Communicates with the Supabase Storage REST API using service-role credentials.
 */
export class SupabaseStorageAdapter implements StorageAdapter {
  private readonly bucket: string;

  constructor(bucket: string = DEFAULT_BUCKET) {
    this.bucket = bucket;
  }

  /** @inheritdoc */
  getPublicUrl(key: string): string {
    return buildPublicUrl(this.bucket, key);
  }

  /** @inheritdoc */
  async upload(
    key: string,
    buffer: Buffer,
    options: UploadOptions = {}
  ): Promise<UploadResult> {
    const {
      contentType = "application/octet-stream",
      cacheControl = "3600",
      maxSizeBytes = 50 * 1024 * 1024,
    } = options;

    // BUG-016: Enforce upload size limit before sending to Supabase Storage.
    if (buffer.byteLength > maxSizeBytes) {
      throw new Error(
        `Upload size exceeded: file is ${buffer.byteLength} bytes but limit is ${maxSizeBytes} bytes`
      );
    }

    key = storageKey(key, options.isPublic ?? true);
    const bucket = bucketFor(key, this.bucket);
    if (isPrivateStorageKey(key)) await assertPrivateBucket(bucket);
    const url = `${getStorageBaseUrl()}/object/${encodeURIComponent(bucket)}/${storagePath(key)}`;

    await storageHttp.post(url, buffer, {
      headers: {
        Authorization: `Bearer ${getServiceKey()}`,
        "Content-Type": contentType,
        "Cache-Control": isPrivateStorageKey(key)?"private, no-store":cacheControl,
        "x-upsert": "true",
      },
      timeout: 10_000,
      maxRedirects: 0,
      maxBodyLength: maxSizeBytes,
    });

    return {
      key,
      publicUrl: this.getPublicUrl(key),
      contentType,
      size: buffer.byteLength,
    };
  }

  /** @inheritdoc */
  async getSignedUrl(key: string, expiresIn = 3600): Promise<string> {
    const url = `${getStorageBaseUrl()}/object/sign/${encodeURIComponent(bucketFor(key, this.bucket))}/${storagePath(key)}`;

    const { data } = await storageHttp.post<{ signedURL: string }>(
      url,
      { expiresIn },
      {
        headers: {
          Authorization: `Bearer ${getServiceKey()}`,
          "Content-Type": "application/json",
        },
      }
    );

    return `${getStorageBaseUrl()}${data.signedURL}`;
  }

  /** @inheritdoc */
  async delete(key: string, options: DeleteOptions = {}): Promise<void> {
    const { ignoreNotFound = true } = options;
    try {
      await storageHttp.delete(
        `${getStorageBaseUrl()}/object/${encodeURIComponent(bucketFor(key, this.bucket))}/${storagePath(key)}`,
        { headers: { Authorization: `Bearer ${getServiceKey()}` } }
      );
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (ignoreNotFound && status === 404) return;
      throw err;
    }
  }

  /** @inheritdoc */
  async deleteMany(keys: string[]): Promise<void> {
    for (const key of keys) await this.delete(key);
  }

  /** @inheritdoc */
  async exists(key: string): Promise<boolean> {
    try {
      await storageHttp.head(
        `${getStorageBaseUrl()}/object/${encodeURIComponent(bucketFor(key, this.bucket))}/${storagePath(key)}`,
        { headers: { Authorization: `Bearer ${getServiceKey()}` } }
      );
      return true;
    } catch {
      return false;
    }
  }
}
