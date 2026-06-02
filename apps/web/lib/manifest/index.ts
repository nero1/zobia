/**
 * lib/manifest/index.ts
 *
 * x_manifest loader – reads admin-configurable settings from the database.
 *
 * The manifest controls:
 *   - Feature flags (which features are enabled)
 *   - Payment provider configuration
 *   - Moderation settings
 *   - App-level limits (max file size, rate limits, etc.)
 *
 * Values are cached in Redis to avoid hitting the DB on every request.
 * Admin changes are reflected within CACHE_TTL_SECONDS.
 */

import { db } from "@/lib/db";
import { redis } from "@/lib/redis";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Feature flags controlled from the admin panel. */
export interface FeatureFlags {
  rooms: boolean;
  directMessages: boolean;
  stories: boolean;
  liveStreaming: boolean;
  aiAssistant: boolean;
  marketplace: boolean;
  voiceCalls: boolean;
  videoCalls: boolean;
  rankings: boolean;
  gifts: boolean;
}

/** Payment provider settings. */
export interface PaymentConfig {
  primaryProvider: "paystack" | "dodopayments" | "none";
  currenciesAccepted: string[];
  paystackEnabled: boolean;
  dodopaymentsEnabled: boolean;
}

/** App-level moderation settings. */
export interface ModerationConfig {
  autoModEnabled: boolean;
  requirePhoneVerification: boolean;
  requireEmailVerification: boolean;
  maxReportsBeforeAutoHide: number;
}

/** Full manifest shape. */
export interface AppManifest {
  features: FeatureFlags;
  payment: PaymentConfig;
  moderation: ModerationConfig;
  /** Unix timestamp of when this manifest was last updated (from DB). */
  updatedAt: number;
}

// ---------------------------------------------------------------------------
// Defaults (used when DB row is missing)
// ---------------------------------------------------------------------------

const DEFAULT_MANIFEST: AppManifest = {
  features: {
    rooms: true,
    directMessages: true,
    stories: false,
    liveStreaming: false,
    aiAssistant: true,
    marketplace: false,
    voiceCalls: false,
    videoCalls: false,
    rankings: true,
    gifts: true,
  },
  payment: {
    primaryProvider: "paystack",
    currenciesAccepted: ["NGN", "USD", "GHS", "KES"],
    paystackEnabled: true,
    dodopaymentsEnabled: false,
  },
  moderation: {
    autoModEnabled: true,
    requirePhoneVerification: false,
    requireEmailVerification: true,
    maxReportsBeforeAutoHide: 5,
  },
  updatedAt: 0,
};

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

const CACHE_KEY = "app:manifest";
const CACHE_TTL_SECONDS = 60; // 1 minute

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

/**
 * Load the application manifest.
 *
 * Checks Redis cache first; on miss reads from the `app_settings` table.
 * Falls back to DEFAULT_MANIFEST if the table row does not exist yet.
 *
 * @returns The current application manifest
 */
export async function loadManifest(): Promise<AppManifest> {
  // 1. Try cache
  try {
    const cached = await redis.get(CACHE_KEY);
    if (cached) {
      return JSON.parse(cached) as AppManifest;
    }
  } catch {
    // Redis unavailable – continue to DB
  }

  // 2. Read from DB
  let manifest = DEFAULT_MANIFEST;
  try {
    const { rows } = await db.query<{
      key: string;
      value: string;
      updated_at: string;
    }>("SELECT key, value, updated_at FROM app_settings WHERE key = 'manifest' LIMIT 1");

    if (rows[0]) {
      const parsed = JSON.parse(rows[0].value) as Partial<AppManifest>;
      manifest = {
        features: { ...DEFAULT_MANIFEST.features, ...(parsed.features ?? {}) },
        payment: { ...DEFAULT_MANIFEST.payment, ...(parsed.payment ?? {}) },
        moderation: {
          ...DEFAULT_MANIFEST.moderation,
          ...(parsed.moderation ?? {}),
        },
        updatedAt: Math.floor(
          new Date(rows[0].updated_at).getTime() / 1000
        ),
      };
    }
  } catch (err) {
    console.error("[manifest] Failed to load from DB, using defaults", err);
  }

  // 3. Write to cache (best-effort)
  try {
    await redis.setex(CACHE_KEY, CACHE_TTL_SECONDS, JSON.stringify(manifest));
  } catch {
    // Ignore cache write errors
  }

  return manifest;
}

/**
 * Invalidate the manifest cache so the next request re-reads from the DB.
 * Call this from the admin panel after saving settings changes.
 */
export async function invalidateManifestCache(): Promise<void> {
  await redis.del(CACHE_KEY);
}

/**
 * Convenience helper – returns just the feature flags.
 *
 * @returns Feature flags from the current manifest
 */
export async function getFeatureFlags(): Promise<FeatureFlags> {
  const manifest = await loadManifest();
  return manifest.features;
}
