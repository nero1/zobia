/**
 * lib/storage/index.ts
 *
 * Storage abstraction entry point.
 *
 * Reads STORAGE_PROVIDER from the validated environment and returns the
 * correct adapter singleton.  All application code should import `storage`
 * from this module – never from a provider file directly.
 *
 * @example
 * ```ts
 * import { storage } from '@/lib/storage';
 * const result = await storage.upload('avatars/user-123.webp', buffer, { contentType: 'image/webp' });
 * ```
 */

import { env } from "@/lib/env";
import type { StorageAdapter } from "./interface";
import { SupabaseStorageAdapter } from "./providers/supabase-storage";
import { R2StorageAdapter } from "./providers/r2";

// ---------------------------------------------------------------------------
// Singleton factory
// ---------------------------------------------------------------------------

let _adapter: StorageAdapter | null = null;

/**
 * Instantiates the storage adapter selected by STORAGE_PROVIDER.
 * Throws for unknown providers (caught by env validation at startup).
 */
function createAdapter(): StorageAdapter {
  switch (env.STORAGE_PROVIDER) {
    case "supabase-storage":
      return new SupabaseStorageAdapter();
    case "r2":
      return new R2StorageAdapter();
    case "s3":
      // S3 is S3-compatible – reuse the R2 adapter which uses aws-sdk v3.
      // Teams using vanilla S3 should set R2_* vars to their S3 equivalents
      // and point R2_ACCOUNT_ID / endpoint accordingly.
      return new R2StorageAdapter();
    default: {
      const _exhaustive: never = env.STORAGE_PROVIDER;
      throw new Error(
        `[storage] Unknown STORAGE_PROVIDER: ${String(_exhaustive)}`
      );
    }
  }
}

/**
 * The active storage adapter singleton.
 * Lazily instantiated on first property access.
 */
export const storage: StorageAdapter = new Proxy({} as StorageAdapter, {
  get(_target, prop) {
    if (!_adapter) {
      _adapter = createAdapter();
    }
    const value = (_adapter as Record<string | symbol, unknown>)[prop];
    if (typeof value === "function") {
      return value.bind(_adapter);
    }
    return value;
  },
});

// Re-export types
export type {
  StorageAdapter,
  UploadResult,
  UploadOptions,
  DeleteOptions,
} from "./interface";
