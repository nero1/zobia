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
  const appUrl = env.NEXT_PUBLIC_APP_URL;
  // Derive from NEXT_PUBLIC_APP_URL or hardcode pattern:
  // Prefer an explicit SUPABASE_URL env if provided; otherwise parse from DATABASE_URL
  const dbUrl = env.DATABASE_URL;
  const match = dbUrl.match(/@db\.([^.]+)\.supabase\.co/);
  if (match) {
    return `https://${match[1]}.supabase.co/storage/v1`;
  }
  // Fallback – works when NEXT_PUBLIC_APP_URL IS the supabase project URL
  return `${appUrl.replace(/\/$/, "")}/storage/v1`;
}

/** Resolve the public URL for an object in a public bucket. */
function buildPublicUrl(bucket: string, key: string): string {
  return `${getStorageBaseUrl()}/object/public/${bucket}/${key}`;
}

/** Extract service role key from env – stored in JWT_SECRET for Supabase projects. */
function getServiceKey(): string {
  // Supabase service role key must be supplied as a dedicated env; fall back to JWT_SECRET
  // In practice teams set SUPABASE_SERVICE_ROLE_KEY – we read process.env directly here
  // because it is not in the Zod schema (it's provider-specific).
  return (
    (process.env["SUPABASE_SERVICE_ROLE_KEY"] as string | undefined) ??
    env.JWT_SECRET
  );
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

    const url = `${getStorageBaseUrl()}/object/${this.bucket}/${key}`;

    await axios.post(url, buffer, {
      headers: {
        Authorization: `Bearer ${getServiceKey()}`,
        "Content-Type": contentType,
        "Cache-Control": cacheControl,
        "x-upsert": "true",
      },
      maxBodyLength: Infinity,
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
    const url = `${getStorageBaseUrl()}/object/sign/${this.bucket}/${key}`;

    const { data } = await axios.post<{ signedURL: string }>(
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
      await axios.delete(
        `${getStorageBaseUrl()}/object/${this.bucket}/${key}`,
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
    if (keys.length === 0) return;

    await axios.delete(`${getStorageBaseUrl()}/object/${this.bucket}`, {
      headers: {
        Authorization: `Bearer ${getServiceKey()}`,
        "Content-Type": "application/json",
      },
      data: { prefixes: keys },
    });
  }

  /** @inheritdoc */
  async exists(key: string): Promise<boolean> {
    try {
      await axios.head(
        `${getStorageBaseUrl()}/object/${this.bucket}/${key}`,
        { headers: { Authorization: `Bearer ${getServiceKey()}` } }
      );
      return true;
    } catch {
      return false;
    }
  }
}
