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
import type { DatabaseAdapter } from "@/lib/db/interface";
import { redis } from "@/lib/redis";
import { env } from "@/lib/env";
import { memGet, memSet, memDel } from "@/lib/cache/memory";

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
    games: boolean;
    merchStore: boolean;
    platformCouncil: boolean;
    allianceSystem: boolean;
    pinAuth: boolean;
    twoFaEnabled: boolean;
    twoFaRequiredForMods: boolean;
    warEventActive: boolean;
    pidginAutocomplete: boolean;
    physicalGoodsEnabled: boolean;
    physicalGoodsManualFulfillment: boolean;
    physicalGoodsPartnerFulfillment: boolean;
    vipRoomPricing?: { minNgn: number; maxNgn: number };
  };
  warEventCooldownHours: number;
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
  floatingNotifications: {
    enabled: boolean;           // master toggle, default true
    xpThreshold: number;        // XP amount >= which confetti ALSO fires (default 100)
    creditsThreshold: number;   // Credits >= which confetti fires (default 50)
    starsThreshold: number;     // Stars >= which confetti fires (default 10)
  };
  // Games feature runtime config (admin-editable at /admin/config)
  games: {
    wagerRakePct: number;             // platform rake on a challenge wager pot (default 5)
    challengeExpiryHours: number;     // hours a challenge stays open (default 48)
    defaultRewardCredits: number;     // fallback win credits when a game sets 0
    defaultRewardXp: number;          // fallback win gaming-XP when a game sets 0
    maxWagerCredits: number;          // server-side ceiling on challenge wager amount (default 10000)
    maxPlaySessionAgeSeconds: number; // max age of a play session before submission is rejected (default 3600)
  };
  // Currency display names (admin-configurable)
  currency: {
    softNameSingular: string;   // e.g. "Credit"
    softNamePlural: string;     // e.g. "Credits"
    premiumNameSingular: string; // e.g. "Star"
    premiumNamePlural: string;   // e.g. "Stars"
  };
  // Platform config
  minimumAge: number;
  coinToCashRate: number;
  payoutThresholdKobo: number;
  payoutLargeApprovalKobo: number;
  seasonPassPriceCoins: number;
  vipRoomMinPriceKobo: number;
  vipRoomMaxPriceKobo: number;
  /**
   * Soft concurrent-participant caps per room type. Enforced against LIVE
   * presence (who is viewing now), not DB membership — so rooms free up
   * automatically. A room's own `max_members` (if set) overrides its type cap.
   * Capping fan-out is the single biggest lever on realtime cost.
   */
  roomCaps: {
    free_open: number;
    tipping: number;
    vip: number;
    drop: number;
    classroom: number;
    guild: number;
  };
  /** Paid capacity upgrade — a room owner spends coins to raise their cap. */
  roomCapacityUpgrade: {
    /** Slots added per purchased step. */
    stepSlots: number;
    /** Coin cost per step. */
    costCoinsPerStep: number;
    /** Absolute ceiling a room's cap can be raised to. */
    hardMax: number;
  };
  deepLinkBaseUrl: string;
  updatedAt?: number;
  // Payment
  payment: {
    primaryProvider: "paystack" | "dodopayments" | "none";
    paystackEnabled: boolean;
    dodopaymentsEnabled: boolean;
    currenciesAccepted?: string[];
  };
  // Payout configuration
  payouts: {
    /** Master toggle — when false, all payout routes return 503. */
    enabled: boolean;
    nigeria: {
      cashEnabled: boolean;
      coinsEnabled: boolean;
      cryptoEnabled: boolean;
      /** true = below-threshold payouts process automatically via CRON;
       *  false = all Nigeria bank transfer payouts require manual admin approval. */
      autoApprove: boolean;
    };
    global: {
      coinsEnabled: boolean;
      cryptoEnabled: boolean;
    };
    /** Max payouts processed per CRON run. */
    batchSize: number;
    /** Max retry attempts before moving to dead-letter queue. */
    maxRetries: number;
    /** XP awarded on first bank account addition (main rank). */
    bankAccountFirstAddXp: number;
    /** Creator track XP awarded on first bank account addition. */
    bankAccountFirstAddCreatorXp: number;
  };
  /** Per-role session token lifetimes (seconds). Admin-configurable via x_manifest. */
  sessionTtls: {
    default:   { accessTtl: number; refreshTtl: number };
    creator:   { accessTtl: number; refreshTtl: number };
    moderator: { accessTtl: number; refreshTtl: number };
    admin:     { accessTtl: number; refreshTtl: number };
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
    games: true,
    merchStore: true,
    platformCouncil: true,
    allianceSystem: true,
    pinAuth: true,
    twoFaEnabled: true,
    twoFaRequiredForMods: false,
    warEventActive: false,
    pidginAutocomplete: false,
    physicalGoodsEnabled: false,
    physicalGoodsManualFulfillment: true,
    physicalGoodsPartnerFulfillment: false,
  },
  currency: {
    softNameSingular: "Credit",
    softNamePlural: "Credits",
    premiumNameSingular: "Star",
    premiumNamePlural: "Stars",
  },
  warEventCooldownHours: 72,
  auth: {
    googleEnabled: true,
    telegramEnabled: true,
  },
  captchaProvider: "none",
  gifProvider: "giphy",
  pwa: {
    webEnabled: true,
    androidEnabled: false,
    iosEnabled: false,
  },
  floatingNotifications: {
    enabled: true,
    xpThreshold: 100,
    creditsThreshold: 50,
    starsThreshold: 10,
  },
  games: {
    wagerRakePct: 5,
    challengeExpiryHours: 48,
    defaultRewardCredits: 50,
    defaultRewardXp: 40,
    maxWagerCredits: 10_000,
    maxPlaySessionAgeSeconds: 3600,
  },
  minimumAge: 18,
  coinToCashRate: 100,
  payoutThresholdKobo: 100000,
  payoutLargeApprovalKobo: 5000000,
  seasonPassPriceCoins: 500,
  vipRoomMinPriceKobo: 20000,
  vipRoomMaxPriceKobo: 1000000,
  roomCaps: {
    free_open: 30,
    tipping: 30,
    vip: 200,
    drop: 100,
    classroom: 150,
    guild: 100,
  },
  roomCapacityUpgrade: {
    stepSlots: 25,
    costCoinsPerStep: 500,
    hardMax: 1000,
  },
  deepLinkBaseUrl: "https://zobia.app",
  payment: {
    primaryProvider: "paystack",
    paystackEnabled: true,
    dodopaymentsEnabled: false,
  },
  payouts: {
    enabled: true,
    nigeria: {
      cashEnabled: true,
      coinsEnabled: true,
      cryptoEnabled: true,
      autoApprove: true,
    },
    global: {
      coinsEnabled: true,
      cryptoEnabled: true,
    },
    batchSize: 200,
    maxRetries: 3,
    bankAccountFirstAddXp: 5,
    bankAccountFirstAddCreatorXp: 10,
  },
  sessionTtls: {
    default:   { accessTtl: 86400,   refreshTtl: 2592000 }, // 24h access / 30d refresh
    creator:   { accessTtl: 86400,   refreshTtl: 2592000 }, // 24h access / 30d refresh
    moderator: { accessTtl: 21600,   refreshTtl: 2592000 }, // 6h access / 30d refresh
    admin:     { accessTtl: 3600,    refreshTtl: 3600 },    // 1h access / 1h refresh
  },
};

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

const CACHE_KEY = "app:manifest:v2";
/** Raw key→value map cache — used by getManifestValue to avoid DB reads. */
const CACHE_KV_KEY = "app:manifest:kv:v2";
const CACHE_TTL_SECONDS = 60; // 1 minute

/** In-process manifest cache — avoids Redis on every API request within the same instance. */
const MEM_CACHE_KEY = "manifest:v2";
const MEM_CACHE_TTL_MS = 15_000; // 15 seconds

// ---------------------------------------------------------------------------
// Single-flight deduplication
// ---------------------------------------------------------------------------

/**
 * In-flight promise for loadManifest(). Deduplicated across concurrent calls
 * during a cold start so N simultaneous requests share one DB query.
 * Cleared after resolution to allow subsequent cache-miss requests to
 * re-populate (each new cold-start period gets its own flight).
 */
let _inflightManifest: Promise<ZobiaManifest> | null = null;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Parse a string value as boolean. Case-insensitive: 'true'/'TRUE'/'True'/'1' → true. */
function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return value.toLowerCase() === "true" || value === "1";
}

/** Parse a string value as integer. Returns fallback when not a valid integer. */
function parseInt10(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const n = parseInt(value, 10);
  return isNaN(n) ? fallback : n;
}

/** Strip surrounding JSON double-quotes from a string value if present (legacy data migration). */
function unquote(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    try { return JSON.parse(value) as string; } catch { /* ignore */ }
  }
  return value;
}

/** Build the full manifest from a key→value map of x_manifest rows. */
function buildManifest(kv: Record<string, string>): ZobiaManifest {
  // Resolve captchaProvider
  const rawCaptcha = kv["captcha_provider"];
  const captchaProvider: ZobiaManifest["captchaProvider"] =
    rawCaptcha === "recaptcha" || rawCaptcha === "turnstile" || rawCaptcha === "none"
      ? rawCaptcha
      : "none";

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
      rooms:            parseBool(kv["feature_rooms"]            ?? "true",  DEFAULT_MANIFEST.features.rooms),
      directMessages:   parseBool(kv["feature_direct_messages"]  ?? "true",  DEFAULT_MANIFEST.features.directMessages),
      gifts:            parseBool(kv["feature_gifts"]            ?? "true",  DEFAULT_MANIFEST.features.gifts),
      rankings:         parseBool(kv["feature_rankings"]         ?? "true",  DEFAULT_MANIFEST.features.rankings),
      communityNotes:   parseBool(kv["feature_community_notes"],             DEFAULT_MANIFEST.features.communityNotes),
      // canonical: feature_star_purchase; legacy: feature_star_direct_purchase
      starPurchase:     parseBool(kv["feature_star_purchase"]    ?? kv["feature_star_direct_purchase"] ?? "false", DEFAULT_MANIFEST.features.starPurchase),
      // canonical: feature_nemesis_system; legacy: feature_nemesis
      nemesisSystem:    parseBool(kv["feature_nemesis_system"]   ?? kv["feature_nemesis"] ?? "true",   DEFAULT_MANIFEST.features.nemesisSystem),
      guildWars:        parseBool(kv["feature_guild_wars"],                  DEFAULT_MANIFEST.features.guildWars),
      classrooms:       parseBool(kv["feature_classrooms"],                  DEFAULT_MANIFEST.features.classrooms),
      businessAccounts: parseBool(kv["feature_business_accounts"],           DEFAULT_MANIFEST.features.businessAccounts),
      admobAds:         parseBool(kv["feature_admob_ads"],                   DEFAULT_MANIFEST.features.admobAds),
      rewardedAds:      parseBool(kv["feature_rewarded_ads"],                DEFAULT_MANIFEST.features.rewardedAds),
      games:            parseBool(kv["feature_games"]            ?? "true",  DEFAULT_MANIFEST.features.games),
      // canonical: feature_merch_store; legacy: feature_creator_merch
      merchStore:       parseBool(kv["feature_merch_store"]      ?? kv["feature_creator_merch"] ?? "false", DEFAULT_MANIFEST.features.merchStore),
      platformCouncil:  parseBool(kv["feature_platform_council"],            DEFAULT_MANIFEST.features.platformCouncil),
      allianceSystem:   parseBool(kv["feature_alliance_system"],             DEFAULT_MANIFEST.features.allianceSystem),
      pinAuth:                    parseBool(kv["feature_pin_auth"]                   ?? "true",  DEFAULT_MANIFEST.features.pinAuth),
      twoFaEnabled:               parseBool(kv["auth_2fa_enabled"]                  ?? "true",  DEFAULT_MANIFEST.features.twoFaEnabled),
      twoFaRequiredForMods:       parseBool(kv["auth_2fa_required_for_mods"]        ?? "false", DEFAULT_MANIFEST.features.twoFaRequiredForMods),
      warEventActive:             parseBool(kv["feature_war_event_active"],                     DEFAULT_MANIFEST.features.warEventActive),
      pidginAutocomplete:         parseBool(kv["feature_pidgin_autocomplete"],                  DEFAULT_MANIFEST.features.pidginAutocomplete),
      physicalGoodsEnabled:       parseBool(kv["physical_goods_enabled"],                       DEFAULT_MANIFEST.features.physicalGoodsEnabled),
      physicalGoodsManualFulfillment:  parseBool(kv["physical_goods_fulfillment_manual"]  ?? "true",  DEFAULT_MANIFEST.features.physicalGoodsManualFulfillment),
      physicalGoodsPartnerFulfillment: parseBool(kv["physical_goods_fulfillment_partner"],            DEFAULT_MANIFEST.features.physicalGoodsPartnerFulfillment),
    },
    currency: {
      softNameSingular:    unquote(kv["currency_soft_name_singular"])    ?? DEFAULT_MANIFEST.currency.softNameSingular,
      softNamePlural:      unquote(kv["currency_soft_name_plural"])      ?? DEFAULT_MANIFEST.currency.softNamePlural,
      premiumNameSingular: unquote(kv["currency_premium_name_singular"]) ?? DEFAULT_MANIFEST.currency.premiumNameSingular,
      premiumNamePlural:   unquote(kv["currency_premium_name_plural"])   ?? DEFAULT_MANIFEST.currency.premiumNamePlural,
    },
    warEventCooldownHours: parseInt10(kv["war_event_cooldown_hours"], DEFAULT_MANIFEST.warEventCooldownHours),
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
    floatingNotifications: {
      enabled:          parseBool(kv["floating_notifications_enabled"] ?? "true", DEFAULT_MANIFEST.floatingNotifications.enabled),
      xpThreshold:      parseInt10(kv["floating_notifications_xp_threshold"], DEFAULT_MANIFEST.floatingNotifications.xpThreshold),
      creditsThreshold: parseInt10(kv["floating_notifications_credits_threshold"], DEFAULT_MANIFEST.floatingNotifications.creditsThreshold),
      starsThreshold:   parseInt10(kv["floating_notifications_stars_threshold"], DEFAULT_MANIFEST.floatingNotifications.starsThreshold),
    },
    games: {
      wagerRakePct:         parseInt10(kv["game_wager_rake_pct"],         DEFAULT_MANIFEST.games.wagerRakePct),
      challengeExpiryHours: parseInt10(kv["game_challenge_expiry_hours"], DEFAULT_MANIFEST.games.challengeExpiryHours),
      defaultRewardCredits: parseInt10(kv["game_default_reward_credits"], DEFAULT_MANIFEST.games.defaultRewardCredits),
      defaultRewardXp:      parseInt10(kv["game_default_reward_xp"],      DEFAULT_MANIFEST.games.defaultRewardXp),
      maxWagerCredits:          parseInt10(kv["game_max_wager_credits"],           DEFAULT_MANIFEST.games.maxWagerCredits),
      maxPlaySessionAgeSeconds: parseInt10(kv["game_max_play_session_age_seconds"], DEFAULT_MANIFEST.games.maxPlaySessionAgeSeconds),
    },
    minimumAge:              parseInt10(kv["minimum_age"],               DEFAULT_MANIFEST.minimumAge),
    coinToCashRate:          parseInt10(kv["coin_to_cash_rate"],         DEFAULT_MANIFEST.coinToCashRate),
    payoutThresholdKobo:     parseInt10(kv["payout_threshold_kobo"],     DEFAULT_MANIFEST.payoutThresholdKobo),
    // canonical: payout_large_approval_kobo; legacy: payout_manual_approval_threshold_kobo
    payoutLargeApprovalKobo: parseInt10(
      kv["payout_large_approval_kobo"] ?? kv["payout_manual_approval_threshold_kobo"],
      DEFAULT_MANIFEST.payoutLargeApprovalKobo
    ),
    seasonPassPriceCoins:    parseInt10(kv["season_pass_price_coins"],   DEFAULT_MANIFEST.seasonPassPriceCoins),
    vipRoomMinPriceKobo:     parseInt10(kv["vip_room_min_price_kobo"],   DEFAULT_MANIFEST.vipRoomMinPriceKobo),
    vipRoomMaxPriceKobo:     parseInt10(kv["vip_room_max_price_kobo"],   DEFAULT_MANIFEST.vipRoomMaxPriceKobo),
    roomCaps: {
      free_open: parseInt10(kv["room_free_open_cap"], DEFAULT_MANIFEST.roomCaps.free_open),
      tipping:   parseInt10(kv["room_tipping_cap"],   DEFAULT_MANIFEST.roomCaps.tipping),
      vip:       parseInt10(kv["room_vip_cap"],       DEFAULT_MANIFEST.roomCaps.vip),
      drop:      parseInt10(kv["room_drop_cap"],      DEFAULT_MANIFEST.roomCaps.drop),
      classroom: parseInt10(kv["room_classroom_cap"], DEFAULT_MANIFEST.roomCaps.classroom),
      guild:     parseInt10(kv["room_guild_cap"],     DEFAULT_MANIFEST.roomCaps.guild),
    },
    roomCapacityUpgrade: {
      stepSlots:        parseInt10(kv["room_capacity_upgrade_step"],     DEFAULT_MANIFEST.roomCapacityUpgrade.stepSlots),
      costCoinsPerStep: parseInt10(kv["room_capacity_upgrade_cost"],     DEFAULT_MANIFEST.roomCapacityUpgrade.costCoinsPerStep),
      hardMax:          parseInt10(kv["room_capacity_hard_max"],         DEFAULT_MANIFEST.roomCapacityUpgrade.hardMax),
    },
    deepLinkBaseUrl: kv["deep_link_base_url"] ?? DEFAULT_MANIFEST.deepLinkBaseUrl,
    payment: {
      primaryProvider,
      paystackEnabled:     parseBool(kv["payment_paystack_enabled"],     DEFAULT_MANIFEST.payment.paystackEnabled),
      dodopaymentsEnabled: parseBool(kv["payment_dodopayments_enabled"], DEFAULT_MANIFEST.payment.dodopaymentsEnabled),
    },
    payouts: {
      enabled:      parseBool(kv["payouts_enabled"],              DEFAULT_MANIFEST.payouts.enabled),
      nigeria: {
        cashEnabled:   parseBool(kv["nigeria_cash_payout_enabled"],   DEFAULT_MANIFEST.payouts.nigeria.cashEnabled),
        coinsEnabled:  parseBool(kv["nigeria_coins_payout_enabled"],  DEFAULT_MANIFEST.payouts.nigeria.coinsEnabled),
        cryptoEnabled: parseBool(kv["nigeria_crypto_payout_enabled"], DEFAULT_MANIFEST.payouts.nigeria.cryptoEnabled),
        autoApprove:   parseBool(kv["nigeria_payout_auto_approve"],   DEFAULT_MANIFEST.payouts.nigeria.autoApprove),
      },
      global: {
        coinsEnabled:  parseBool(kv["global_coins_payout_enabled"],  DEFAULT_MANIFEST.payouts.global.coinsEnabled),
        cryptoEnabled: parseBool(kv["global_crypto_payout_enabled"], DEFAULT_MANIFEST.payouts.global.cryptoEnabled),
      },
      batchSize:                   parseInt10(kv["payout_batch_size"],                   DEFAULT_MANIFEST.payouts.batchSize),
      maxRetries:                  parseInt10(kv["payout_max_retries"],                  DEFAULT_MANIFEST.payouts.maxRetries),
      bankAccountFirstAddXp:       parseInt10(kv["bank_account_first_add_xp"],          DEFAULT_MANIFEST.payouts.bankAccountFirstAddXp),
      bankAccountFirstAddCreatorXp: parseInt10(kv["bank_account_first_add_creator_xp"], DEFAULT_MANIFEST.payouts.bankAccountFirstAddCreatorXp),
    },
    sessionTtls: {
      default:   {
        accessTtl:  parseInt10(kv["session_ttl_access_default"],   DEFAULT_MANIFEST.sessionTtls.default.accessTtl),
        refreshTtl: parseInt10(kv["session_ttl_refresh_default"],  DEFAULT_MANIFEST.sessionTtls.default.refreshTtl),
      },
      creator:   {
        accessTtl:  parseInt10(kv["session_ttl_access_creator"],   DEFAULT_MANIFEST.sessionTtls.creator.accessTtl),
        refreshTtl: parseInt10(kv["session_ttl_refresh_creator"],  DEFAULT_MANIFEST.sessionTtls.creator.refreshTtl),
      },
      moderator: {
        accessTtl:  parseInt10(kv["session_ttl_access_moderator"], DEFAULT_MANIFEST.sessionTtls.moderator.accessTtl),
        refreshTtl: parseInt10(kv["session_ttl_refresh_moderator"],DEFAULT_MANIFEST.sessionTtls.moderator.refreshTtl),
      },
      admin:     {
        accessTtl:  parseInt10(kv["session_ttl_access_admin"],     DEFAULT_MANIFEST.sessionTtls.admin.accessTtl),
        refreshTtl: parseInt10(kv["session_ttl_refresh_admin"],    DEFAULT_MANIFEST.sessionTtls.admin.refreshTtl),
      },
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
 * Single-flight: concurrent cache-miss calls during a cold start all share the
 * same DB query promise rather than hammering the database simultaneously.
 *
 * @returns The current application manifest
 */
export async function loadManifest(): Promise<ZobiaManifest> {
  if (!env.DATABASE_PROVIDER) {
    return { ...DEFAULT_MANIFEST };
  }

  // 0. In-process cache — zero Redis calls when the instance is warm
  const memCached = memGet<ZobiaManifest>(MEM_CACHE_KEY);
  if (memCached) return memCached;

  // 1. Try Redis cache (fast path — no single-flight needed, Redis read is cheap)
  try {
    const cached = await redis.get(CACHE_KEY);
    if (cached) {
      const manifest = JSON.parse(cached) as ZobiaManifest;
      memSet(MEM_CACHE_KEY, manifest, MEM_CACHE_TTL_MS);
      return manifest;
    }
  } catch {
    // Redis unavailable – continue to DB
  }

  // 2. Single-flight: deduplicate concurrent cold-start DB reads
  if (_inflightManifest) return _inflightManifest;

  _inflightManifest = (async () => {
    try {
      // Read all rows from x_manifest
      let manifest: ZobiaManifest = DEFAULT_MANIFEST;
      let kv: Record<string, string> = {};

      try {
        const { rows } = await db.query<{ key: string; value: string }>(
          "SELECT key, value FROM x_manifest"
        );

        if (rows.length > 0) {
          for (const row of rows) {
            kv[row.key] = row.value;
          }
          manifest = buildManifest(kv);
        }
      } catch (err) {
        console.error("[manifest] Failed to load from DB, using defaults", err);
        kv = {};
      }

      // Write to in-process cache first (synchronous, zero-cost)
      memSet(MEM_CACHE_KEY, manifest, MEM_CACHE_TTL_MS);

      // Write both the full manifest and the raw KV map to Redis (best-effort)
      try {
        await Promise.all([
          redis.setex(CACHE_KEY, CACHE_TTL_SECONDS, JSON.stringify(manifest)),
          redis.setex(CACHE_KV_KEY, CACHE_TTL_SECONDS, JSON.stringify(kv)),
        ]);
      } catch {
        // Ignore cache write errors
      }

      return manifest;
    } finally {
      // Clear after a tick so that the resolved value is still returned to any
      // callers that joined the in-flight promise, then the next cache-miss
      // can start a fresh flight.
      setTimeout(() => {
        _inflightManifest = null;
      }, 0);
    }
  })();

  return _inflightManifest;
}

/**
 * Invalidate the manifest cache so the next request re-reads from the DB.
 * Call this from the admin panel after saving settings changes.
 */
export async function invalidateManifestCache(): Promise<void> {
  memDel(MEM_CACHE_KEY);
  try {
    await redis.del(CACHE_KEY, CACHE_KV_KEY);
  } catch {
    // Ignore Redis errors during invalidation
  }
}

/**
 * Read a single raw string value from x_manifest by key.
 *
 * Reads from the Redis KV cache populated by loadManifest() to avoid direct
 * DB hits on every call. Falls back to a direct DB query if the cache is
 * cold or unavailable.
 *
 * @param key - The x_manifest key to look up
 * @returns Raw string value or null if the key does not exist
 */
export async function getManifestValue(key: string): Promise<string | null> {
  // 1. Try the KV cache first
  try {
    const cachedKv = await redis.get(CACHE_KV_KEY);
    if (cachedKv) {
      const kv = JSON.parse(cachedKv) as Record<string, string>;
      return kv[key] ?? null;
    }
  } catch {
    // Redis unavailable – fall through to DB
  }

  // 2. Cache miss — query the DB directly
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
// Feature guard — throws if the feature is disabled
// ---------------------------------------------------------------------------

/**
 * Assert that a named feature is enabled in the current manifest.
 *
 * Intended to be called at the top of route handlers that are gated by a
 * feature flag, e.g.:
 *
 * ```ts
 * await requireFeatureEnabled('guildWars'); // throws 503 if disabled
 * ```
 *
 * @param featureName - Key from ZobiaManifest['features']
 * @throws Plain Error with code FEATURE_DISABLED if the feature is off.
 *         Route handlers should catch this and return 503/403.
 */
export async function requireFeatureEnabled(
  featureName: keyof ZobiaManifest["features"]
): Promise<void> {
  const manifest = await loadManifest();
  if (!manifest.features[featureName]) {
    const err = new Error(`Feature '${featureName}' is currently disabled`) as Error & { code: string; statusCode: number };
    err.code = "FEATURE_DISABLED";
    err.statusCode = 503;
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Legacy type alias (kept for backwards compatibility with existing imports)
// ---------------------------------------------------------------------------

/** @deprecated Use ZobiaManifest instead */
export type AppManifest = ZobiaManifest;

// ---------------------------------------------------------------------------
// Early Feature Access
// ---------------------------------------------------------------------------

/** The early access window duration in milliseconds (14 days). */
const EARLY_ACCESS_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Checks whether a feature flag is available to a specific user, taking into
 * account scheduled release dates and early access plans.
 *
 * Logic:
 *   - If `available_from` is NULL or in the past: feature is available to all.
 *   - If `available_from` is in the future:
 *       - If the user's plan is listed in `early_access_plans` OR the user is a
 *         Platform Council member, AND the current time is within the 14-day
 *         early access window (i.e. available_from - 14 days <= now): available.
 *       - Otherwise: not yet available.
 *
 * @param featureKey      - The feature flag key (e.g. 'guild_wars')
 * @param userPlan        - The user's subscription plan slug (e.g. 'max', 'pro')
 * @param isCouncilMember - Whether the user is a Platform Council member
 * @param dbClient        - Database adapter (defaults to the shared `db` singleton)
 * @returns true if the feature is available to this user right now
 */
export async function isFeatureAvailableForUser(
  featureKey: string,
  userPlan: string,
  isCouncilMember: boolean,
  dbClient: DatabaseAdapter = db,
): Promise<boolean> {
  let availableFrom: Date | null = null;
  let earlyAccessPlans: string[] | null = null;

  try {
    const { rows } = await dbClient.query<{
      available_from: string | null;
      early_access_plans: string[] | null;
    }>(
      `SELECT available_from, early_access_plans
       FROM feature_flags
       WHERE key = $1
       LIMIT 1`,
      [featureKey],
    );

    if (rows.length === 0) {
      // Feature flag not found — treat as available (fail open)
      return true;
    }

    availableFrom = rows[0].available_from ? new Date(rows[0].available_from) : null;
    earlyAccessPlans = rows[0].early_access_plans ?? null;
  } catch {
    // DB error — fail open so a schema issue doesn't block all users
    return true;
  }

  const now = new Date();

  // If no scheduled release date, the feature is available to everyone
  if (availableFrom === null || availableFrom <= now) {
    return true;
  }

  // available_from is in the future — check early access eligibility
  const hasEarlyAccessPlan =
    Array.isArray(earlyAccessPlans) && earlyAccessPlans.includes(userPlan);

  if (!hasEarlyAccessPlan && !isCouncilMember) {
    return false;
  }

  // The user qualifies for early access — check the 14-day window
  const windowStart = new Date(availableFrom.getTime() - EARLY_ACCESS_WINDOW_MS);
  return now >= windowStart;
}
