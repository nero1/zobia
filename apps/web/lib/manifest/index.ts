/**
 * lib/manifest/index.ts
 *
 * x_manifest loader – reads admin-configurable settings from the database.
 *
 * The manifest controls:
 *   - Feature flags (which features are enabled)
 *   - Auth provider configuration
 *   - CAPTCHA provider
 *   - GIF provider
 *   - PWA per-platform toggles
 *   - Payment provider configuration
 *   - App-level limits (minimum age, payout thresholds, etc.)
 *
 * Values are cached in Redis to avoid hitting the DB on every request.
 * Admin changes are reflected within CACHE_TTL_SECONDS.
 *
 * Each loadManifest() call builds the manifest from individual x_manifest
 * key/value rows — not from a single serialised JSON blob.
 */

import { db } from "@/lib/db";
import { redis } from "@/lib/redis";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Full manifest shape — all PRD-required settings. */
export interface ZobiaManifest {
  // Feature flags
  features: {
    rooms: boolean;
    directMessages: boolean;
    gifts: boolean;
    rankings: boolean;
    communityNotes: boolean;
    starPurchase: boolean;
    nemesisSystem: boolean;
    guildWars: boolean;
    classrooms: boolean;
    businessAccounts: boolean;
    admobAds: boolean;
    rewardedAds: boolean;
    merchStore: boolean;
    platformCouncil: boolean;
    allianceSystem: boolean;
    pinAuth: boolean;
  };
  // Auth
  auth: {
    googleEnabled: boolean;
    telegramEnabled: boolean;
  };
  // CAPTCHA
  captchaProvider: "recaptcha" | "turnstile" | "none";
  // GIF
  gifProvider: "giphy" | "tenor";
  // PWA
  pwa: {
    webEnabled: boolean;
    androidEnabled: boolean;
    iosEnabled: boolean;
  };
  // Platform config
  minimumAge: number;
  coinToCashRate: number;
  payoutThresholdKobo: number;
  payoutLargeApprovalKobo: number;
  seasonPassPriceCoins: number;
  vipRoomMinPriceKobo: number;
  vipRoomMaxPriceKobo: number;
  deepLinkBaseUrl: string;
  // Payment
  payment: {
    primaryProvider: "paystack" | "dodopayments" | "none";
    paystackEnabled: boolean;
    dodopaymentsEnabled: boolean;
  };
}

// ---------------------------------------------------------------------------
// Defaults (used when a DB row is missing)
// ---------------------------------------------------------------------------

const DEFAULT_MANIFEST: ZobiaManifest = {
  features: {
    rooms: true,
    directMessages: true,
    gifts: true,
    rankings: true,
    communityNotes: true,
    starPurchase: false,
    nemesisSystem: true,
    guildWars: true,
    classrooms: true,
    businessAccounts: true,
    admobAds: true,
    rewardedAds: true,
    merchStore: true,
    platformCouncil: true,
    allianceSystem: true,
    pinAuth: true,
  },
  auth: {
    googleEnabled: true,
    telegramEnabled: true,
  },
  captchaProvider: "recaptcha",
  gifProvider: "giphy",
  pwa: {
    webEnabled: true,
    androidEnabled: false,
    iosEnabled: false,
  },
  minimumAge: 18,
  coinToCashRate: 100,
  payoutThresholdKobo: 100000,
  payoutLargeApprovalKobo: 5000000,
  seasonPassPriceCoins: 500,
  vipRoomMinPriceKobo: 20000,
  vipRoomMaxPriceKobo: 1000000,
  deepLinkBaseUrl: "https://zobia.app",
  payment: {
    primaryProvider: "paystack",
    paystackEnabled: true,
    dodopaymentsEnabled: false,
  },
};

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

const CACHE_KEY = "app:manifest:v2";
const CACHE_TTL_SECONDS = 60; // 1 minute

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Parse a string value as boolean ('true' → true, anything else → false). */
function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return value === "true";
}

/** Parse a string value as integer. Returns fallback when not a valid integer. */
function parseInt10(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const n = parseInt(value, 10);
  return isNaN(n) ? fallback : n;
}

/** Build the full manifest from a key→value map of x_manifest rows. */
function buildManifest(kv: Record<string, string>): ZobiaManifest {
  // Resolve captchaProvider
  const rawCaptcha = kv["captcha_provider"];
  const captchaProvider: ZobiaManifest["captchaProvider"] =
    rawCaptcha === "turnstile" || rawCaptcha === "none"
      ? rawCaptcha
      : "recaptcha";

  // Resolve gifProvider
  const rawGif = kv["gif_provider"];
  const gifProvider: ZobiaManifest["gifProvider"] =
    rawGif === "tenor" ? "tenor" : "giphy";

  // Resolve payment primaryProvider
  const rawProvider = kv["payment_primary_provider"];
  const primaryProvider: ZobiaManifest["payment"]["primaryProvider"] =
    rawProvider === "dodopayments" || rawProvider === "none"
      ? rawProvider
      : "paystack";

  return {
    features: {
      rooms:            parseBool(kv["feature_rooms"],             DEFAULT_MANIFEST.features.rooms),
      directMessages:   parseBool(kv["feature_direct_messages"],   DEFAULT_MANIFEST.features.directMessages),
      gifts:            parseBool(kv["feature_gifts"],             DEFAULT_MANIFEST.features.gifts),
      rankings:         parseBool(kv["feature_rankings"],          DEFAULT_MANIFEST.features.rankings),
      communityNotes:   parseBool(kv["feature_community_notes"],   DEFAULT_MANIFEST.features.communityNotes),
      starPurchase:     parseBool(kv["feature_star_purchase"],     DEFAULT_MANIFEST.features.starPurchase),
      nemesisSystem:    parseBool(kv["feature_nemesis_system"],    DEFAULT_MANIFEST.features.nemesisSystem),
      guildWars:        parseBool(kv["feature_guild_wars"],        DEFAULT_MANIFEST.features.guildWars),
      classrooms:       parseBool(kv["feature_classrooms"],        DEFAULT_MANIFEST.features.classrooms),
      businessAccounts: parseBool(kv["feature_business_accounts"], DEFAULT_MANIFEST.features.businessAccounts),
      admobAds:         parseBool(kv["feature_admob_ads"],         DEFAULT_MANIFEST.features.admobAds),
      rewardedAds:      parseBool(kv["feature_rewarded_ads"],      DEFAULT_MANIFEST.features.rewardedAds),
      merchStore:       parseBool(kv["feature_merch_store"],       DEFAULT_MANIFEST.features.merchStore),
      platformCouncil:  parseBool(kv["feature_platform_council"],  DEFAULT_MANIFEST.features.platformCouncil),
      allianceSystem:   parseBool(kv["feature_alliance_system"],   DEFAULT_MANIFEST.features.allianceSystem),
      pinAuth:          parseBool(kv["feature_pin_auth"],          DEFAULT_MANIFEST.features.pinAuth),
    },
    auth: {
      googleEnabled:   parseBool(kv["auth_google_enabled"],   DEFAULT_MANIFEST.auth.googleEnabled),
      telegramEnabled: parseBool(kv["auth_telegram_enabled"], DEFAULT_MANIFEST.auth.telegramEnabled),
    },
    captchaProvider,
    gifProvider,
    pwa: {
      webEnabled:     parseBool(kv["pwa_web_enabled"],     DEFAULT_MANIFEST.pwa.webEnabled),
      androidEnabled: parseBool(kv["pwa_android_enabled"], DEFAULT_MANIFEST.pwa.androidEnabled),
      iosEnabled:     parseBool(kv["pwa_ios_enabled"],     DEFAULT_MANIFEST.pwa.iosEnabled),
    },
    minimumAge:              parseInt10(kv["minimum_age"],               DEFAULT_MANIFEST.minimumAge),
    coinToCashRate:          parseInt10(kv["coin_to_cash_rate"],         DEFAULT_MANIFEST.coinToCashRate),
    payoutThresholdKobo:     parseInt10(kv["payout_threshold_kobo"],     DEFAULT_MANIFEST.payoutThresholdKobo),
    payoutLargeApprovalKobo: parseInt10(kv["payout_large_approval_kobo"],DEFAULT_MANIFEST.payoutLargeApprovalKobo),
    seasonPassPriceCoins:    parseInt10(kv["season_pass_price_coins"],   DEFAULT_MANIFEST.seasonPassPriceCoins),
    vipRoomMinPriceKobo:     parseInt10(kv["vip_room_min_price_kobo"],   DEFAULT_MANIFEST.vipRoomMinPriceKobo),
    vipRoomMaxPriceKobo:     parseInt10(kv["vip_room_max_price_kobo"],   DEFAULT_MANIFEST.vipRoomMaxPriceKobo),
    deepLinkBaseUrl: kv["deep_link_base_url"] ?? DEFAULT_MANIFEST.deepLinkBaseUrl,
    payment: {
      primaryProvider,
      paystackEnabled:     parseBool(kv["payment_paystack_enabled"],     DEFAULT_MANIFEST.payment.paystackEnabled),
      dodopaymentsEnabled: parseBool(kv["payment_dodopayments_enabled"], DEFAULT_MANIFEST.payment.dodopaymentsEnabled),
    },
  };
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

/**
 * Load the application manifest.
 *
 * Checks Redis cache first; on miss reads all rows from the `x_manifest` table
 * and builds the manifest from individual key/value pairs.
 * Falls back to DEFAULT_MANIFEST if the table is empty or unavailable.
 *
 * @returns The current application manifest
 */
export async function loadManifest(): Promise<ZobiaManifest> {
  // 1. Try cache
  try {
    const cached = await redis.get(CACHE_KEY);
    if (cached) {
      return JSON.parse(cached) as ZobiaManifest;
    }
  } catch {
    // Redis unavailable – continue to DB
  }

  // 2. Read all rows from x_manifest
  let manifest = DEFAULT_MANIFEST;
  try {
    const { rows } = await db.query<{ key: string; value: string }>(
      "SELECT key, value FROM x_manifest"
    );

    if (rows.length > 0) {
      const kv: Record<string, string> = {};
      for (const row of rows) {
        kv[row.key] = row.value;
      }
      manifest = buildManifest(kv);
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
  try {
    await redis.del(CACHE_KEY);
  } catch {
    // Ignore Redis errors during invalidation
  }
}

/**
 * Read a single raw string value from x_manifest by key.
 * Returns null if the key does not exist in the database.
 *
 * @param key - The x_manifest key to look up
 * @returns Raw string value or null
 */
export async function getManifestValue(key: string): Promise<string | null> {
  try {
    const { rows } = await db.query<{ value: string }>(
      "SELECT value FROM x_manifest WHERE key = $1 LIMIT 1",
      [key]
    );
    return rows[0]?.value ?? null;
  } catch (err) {
    console.error(`[manifest] Failed to read key '${key}' from DB`, err);
    return null;
  }
}

/**
 * Check whether a feature flag (boolean key) is enabled.
 * Treats any value other than 'true' as disabled.
 * Returns false if the key is not found.
 *
 * @param key - The x_manifest key (e.g. 'feature_guild_wars')
 * @returns true if the flag exists and its value is 'true'
 */
export async function isFeatureEnabled(key: string): Promise<boolean> {
  const value = await getManifestValue(key);
  return value === "true";
}

/**
 * Convenience helper – returns just the feature flags object.
 *
 * @returns Feature flags from the current manifest
 */
export async function getFeatureFlags(): Promise<ZobiaManifest["features"]> {
  const manifest = await loadManifest();
  return manifest.features;
}

// ---------------------------------------------------------------------------
// Legacy type alias (kept for backwards compatibility with existing imports)
// ---------------------------------------------------------------------------

/** @deprecated Use ZobiaManifest instead */
export type AppManifest = ZobiaManifest;
