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
import { logger } from "@/lib/logger";
import { DEFAULT_CAPTCHA_ENABLED_SURFACES } from "@/lib/security/captchaSurfaces";

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
    /** User Profile Stats page (/profile/&lt;id&gt;/stats). Configure Basic vs Full view eligibility at /gate44/settings/profile-stats. */
    profileStats: boolean;
    twoFaEnabled: boolean;
    twoFaRequiredForMods: boolean;
    warEventActive: boolean;
    pidginAutocomplete: boolean;
    physicalGoodsEnabled: boolean;
    physicalGoodsManualFulfillment: boolean;
    physicalGoodsPartnerFulfillment: boolean;
    moments: boolean;
    forum: boolean;
    /** Old-school BB-style forum (boards/threads at /forum, /f/<slug>) — separate from the Answers Q&A feature above. */
    bbforum: boolean;
    blogs: boolean;
    /** Rewarded Gifts on blogs (tiers, purchases, VIP badges/unlocks) — requires `blogs` and `blogMonetization` too. */
    blogGifts: boolean;
    /** Master kill-switch for ALL blog monetization (paywall unlocks, post/blog treasuries, gifts). */
    blogMonetization: boolean;
    kyc: boolean;
    adsSystem: boolean;
    nativeAds: boolean;
    instreamAds: boolean;
    boostedPosts: boolean;
    adCoupons: boolean;
    vipRoomPricing?: { minNgn: number; maxNgn: number };
    /** Master on/off switch for the Support Ticket System (PRD Support Tickets). */
    supportTickets: boolean;
    /** Database-backed Help Center at /help. When false, the static FAQ page is shown. */
    helpCenter: boolean;
    /** "Ask AI" block on Help Center doc pages. Independent of supportTickets. */
    helpCenterAi: boolean;
  };
  /**
   * Feature keys (matching `features.*` property names above) for which
   * moderators may still see the nav link and access the page while the
   * master flag is off. Regular users never get this exception; admins
   * always can access every feature regardless of this list. Admin-editable
   * per-flag at /gate44/feature-flags ("Mods can access while disabled").
   * Also doubles as a "staff/mods-only" release mode: leave the master flag
   * off and add the key here to soft-launch a feature to mods only.
   */
  featureModVisibility: string[];
  warEventCooldownHours: number;
  // Maintenance mode (admin-editable at /gate44/config)
  maintenance: {
    enabled: boolean;
    message: string;
  };
  // Auth
  auth: {
    googleEnabled: boolean;
    telegramEnabled: boolean;
  };
  // CAPTCHA
  captchaProvider: "recaptcha" | "turnstile" | "none";
  /** Per-surface CAPTCHA toggle. Only effective when captchaProvider != "none". */
  captchaEnabledSurfaces: string[];
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
  // Games feature runtime config (admin-editable at /gate44/config)
  games: {
    wagerRakePct: number;             // platform rake on a challenge wager pot (default 5)
    challengeExpiryHours: number;     // hours a challenge stays open (default 720 = 30 days)
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
  // Zobia Moments — pricing & eligibility (admin-editable at /gate44/config)
  moments: {
    /** Credits charged per Moment. 0 = free via Credits (default 100). */
    costCredits: number;
    /** Stars charged per Moment. 0 = free via Stars (default 1). */
    costStars: number;
    /** Minimum account level (main rank number, 1 = Beginner) required to post a Moment. */
    minLevel: number;
  };
  // Answers — mini forum / Q&A (admin-editable at /gate44/config and /gate44/answers/settings)
  forum: {
    /** Minimum account level required to post a question. */
    minLevelToPost: number;
    /** Minimum account level required to answer/comment for free. */
    minLevelToComment: number;
    /** Credits charged to comment when below minLevelToComment (bypass). */
    commentBypassCostCredits: number;
    /** XP awarded for posting a question. */
    rewardXpPerQuestion: number;
    /** Credits awarded for posting a question. */
    rewardCreditsPerQuestion: number;
    /** XP awarded for posting an answer. */
    rewardXpPerAnswer: number;
    /** Credits awarded for posting an answer. */
    rewardCreditsPerAnswer: number;
    /** XP awarded to a content author per upvote received. */
    rewardXpPerUpvoteReceived: number;
    /** Credits awarded to a content author per upvote received. */
    rewardCreditsPerUpvoteReceived: number;
    /** XP awarded when an answer is marked best. */
    rewardXpBestAnswer: number;
    /** Credits awarded when an answer is marked best. */
    rewardCreditsBestAnswer: number;
    /** Ceiling on total forum-sourced credit rewards a user can earn per rolling 24h. */
    dailyRewardCapCredits: number;
    /** Run profanity/duplicate auto-moderation on new questions and answers. */
    autoModerationEnabled: boolean;
  };
  // Guilds (PRD §13) — admin-editable at /gate44/guilds
  guilds: {
    /** Minimum account level (main rank number, 1 = Beginner) required to found a Guild. */
    minLevelToCreate: number;
  };
  // Old-school BB-style forum (boards/threads/posts) — admin-editable at
  // /gate44/forum/settings. Distinct from the `forum` block above (Answers Q&A).
  bbforum: {
    /** Minimum account level required to start a thread OR post a reply. */
    minLevelToPost: number;
    /** XP awarded for starting a new thread. */
    rewardXpPerThread: number;
    /** Credits awarded for starting a new thread. */
    rewardCreditsPerThread: number;
    /** XP awarded for posting a reply. */
    rewardXpPerReply: number;
    /** Credits awarded for posting a reply. */
    rewardCreditsPerReply: number;
    /** Ceiling on total bbforum-sourced credit rewards a user can earn per rolling 24h. */
    dailyRewardCapCredits: number;
    /** Run profanity/duplicate auto-moderation on new threads and posts. */
    autoModerationEnabled: boolean;
    /** Credits charged to attach an image to a thread/post. 0 = free. */
    imageCostCredits: number;
    /** Stars charged to attach an image to a thread/post. 0 = free. */
    imageCostStars: number;
    /** Days of pot inactivity before an unclaimed balance auto-refunds to the OP. */
    potExpiryDays: number;
  };
  // Platform Advertising (PRD §17, Pillar 3) — admin-editable at /gate44/ads
  ads: {
    /** How self-service business-submitted ad campaigns are reviewed. */
    moderationMode: "manual" | "ai";
    /** Minimum AI approvalConfidence (0-1) to auto-approve when moderationMode === "ai". */
    aiAutoApproveThreshold: number;
    /** Minimum users.kyc_tier the business account owner must hold to submit ad campaigns. */
    minKycTierToAdvertise: number;
    /** Default Credits charged per 1000 impressions when a placement has no custom CPM. */
    defaultCpmCredits: number;
    /** Show one native in-stream ad after this many messages in free Rooms. */
    roomInstreamInterval: number;
    /** Rewarded-ad daily cap and payout range (Credits). */
    rewardedDailyCap: number;
    rewardedCreditsMin: number;
    rewardedCreditsMax: number;
    /** Ad exposure level per plan: "full" | "reduced" | "none". */
    planAdsLevel: {
      free: "full" | "reduced" | "none";
      plus: "full" | "reduced" | "none";
      pro: "full" | "reduced" | "none";
      max: "full" | "reduced" | "none";
    };
    admob: {
      appId: string;
      bannerUnitId: string;
      interstitialUnitId: string;
      rewardedUnitId: string;
      testMode: boolean;
    };
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
  // Identity KYC (Tier 1-3) — admin-editable at /gate44/kyc (settings tab)
  kyc: {
    /** Credits charged per verification attempt (Tier 1 submission). */
    costCredits: number;
    /** Tier 1 review mode: "ai" pre-screens and escalates low-confidence cases, "manual" always human-reviews. */
    tier1ReviewMode: "ai" | "manual";
    /** Combined AI confidence (0-1) at/above which an AI-mode Tier 1 submission is auto-approved. */
    aiAutoApproveThreshold: number;
    /** Combined AI confidence (0-1) below which an AI-mode Tier 1 submission is escalated to manual review. */
    aiEscalateBelowThreshold: number;
    /** Minimum approved tier required to show the blue verified checkmark badge. */
    badgeMinTier: number;
    /** Product-price / revenue thresholds (kobo + USD cents) that trigger a required KYC tier. */
    thresholds: {
      individual: { tier2Kobo: number; tier2UsdCents: number; tier3Kobo: number; tier3UsdCents: number };
      business:   { tier2Kobo: number; tier2UsdCents: number; tier3Kobo: number; tier3UsdCents: number };
    };
  };
  // Support Ticket System (admin-editable at /admin/support/settings)
  support: {
    /** When true, a new ticket first gets an AI-generated response before the human queue. */
    aiTriageEnabled: boolean;
    /** Plan slugs (and/or prestige_N entries) that can create tickets for free — see lib/plans/eligibility.ts. */
    eligiblePlans: string[];
    /** One-time credits charged to create a ticket outside eligiblePlans. 0 = not chargeable in credits. */
    ticketCostCredits: number;
    /** One-time stars charged to create a ticket outside eligiblePlans. 0 = not chargeable in stars. */
    ticketCostStars: number;
    /** How messages are charged after ticket creation. */
    chargingModel: "first_message_only" | "every_message" | "every_x_messages" | "first_x_messages";
    /** The X parameter for every_x_messages / first_x_messages. */
    chargingX: number;
    /** Roles ("support"|"moderator"|"admin") permitted to view/respond to the ticket queue. */
    staffRoles: string[];
  };
  // Help Center (admin-editable at /admin/help-center)
  helpCenterSettings: {
    /** When true, "Contact a real person" from an AI answer is always free and cost messaging is hidden. */
    aiFreeForAll: boolean;
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
    moments: true,
    forum: true,
    bbforum: true,
    blogs: true,
    blogGifts: true,
    blogMonetization: true,
    kyc: true,
    adsSystem: true,
    nativeAds: true,
    instreamAds: true,
    boostedPosts: true,
    adCoupons: true,
    profileStats: true,
    supportTickets: false,
    helpCenter: true,
    helpCenterAi: true,
  },
  featureModVisibility: [],
  currency: {
    softNameSingular: "Credit",
    softNamePlural: "Credits",
    premiumNameSingular: "Star",
    premiumNamePlural: "Stars",
  },
  moments: {
    costCredits: 100,
    costStars: 1,
    minLevel: 2,
  },
  forum: {
    minLevelToPost: 2,
    minLevelToComment: 1,
    commentBypassCostCredits: 1,
    rewardXpPerQuestion: 10,
    rewardCreditsPerQuestion: 0,
    rewardXpPerAnswer: 5,
    rewardCreditsPerAnswer: 0,
    rewardXpPerUpvoteReceived: 1,
    rewardCreditsPerUpvoteReceived: 0,
    rewardXpBestAnswer: 25,
    rewardCreditsBestAnswer: 10,
    dailyRewardCapCredits: 50,
    autoModerationEnabled: true,
  },
  guilds: {
    minLevelToCreate: 4,
  },
  bbforum: {
    minLevelToPost: 2,
    rewardXpPerThread: 1,
    rewardCreditsPerThread: 0,
    rewardXpPerReply: 1,
    rewardCreditsPerReply: 0,
    dailyRewardCapCredits: 50,
    autoModerationEnabled: true,
    imageCostCredits: 0,
    imageCostStars: 0,
    potExpiryDays: 14,
  },
  ads: {
    moderationMode: "manual",
    aiAutoApproveThreshold: 0.85,
    minKycTierToAdvertise: 1,
    defaultCpmCredits: 500,
    roomInstreamInterval: 10,
    rewardedDailyCap: 5,
    rewardedCreditsMin: 10,
    rewardedCreditsMax: 20,
    planAdsLevel: { free: "full", plus: "reduced", pro: "none", max: "none" },
    admob: { appId: "", bannerUnitId: "", interstitialUnitId: "", rewardedUnitId: "", testMode: true },
  },
  warEventCooldownHours: 72,
  maintenance: {
    enabled: false,
    message: "Zobia is briefly unavailable at the moment due to system maintenance. Kindly check back later.",
  },
  auth: {
    googleEnabled: true,
    telegramEnabled: true,
  },
  captchaProvider: "none",
  captchaEnabledSurfaces: DEFAULT_CAPTCHA_ENABLED_SURFACES,
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
    // 30 days (PRD §30.3) — a pending/active challenge that sees no response
    // this long is swept and refunded by the /api/cron/games expiry job.
    challengeExpiryHours: 24 * 30,
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
    default:   { accessTtl: 900,     refreshTtl: 2592000 }, // 15m access / 30d refresh — matches jwt.ts constant
    creator:   { accessTtl: 900,     refreshTtl: 2592000 }, // 15m access / 30d refresh
    moderator: { accessTtl: 900,     refreshTtl: 2592000 }, // 15m access / 30d refresh
    admin:     { accessTtl: 3600,    refreshTtl: 3600 },    // 1h access / 1h refresh
  },
  kyc: {
    costCredits: 100,
    tier1ReviewMode: "ai",
    aiAutoApproveThreshold: 0.85,
    aiEscalateBelowThreshold: 0.55,
    badgeMinTier: 1,
    thresholds: {
      // NGN 100,000 / $1,000 (Tier 2), NGN 1,000,000 / $5,000 (Tier 3)
      individual: { tier2Kobo: 10_000_000, tier2UsdCents: 100_000, tier3Kobo: 100_000_000, tier3UsdCents: 500_000 },
      // NGN 500,000 / $5,000 (Tier 2), NGN 10,000,000 / $5,000 (Tier 3)
      business: { tier2Kobo: 50_000_000, tier2UsdCents: 500_000, tier3Kobo: 1_000_000_000, tier3UsdCents: 500_000 },
    },
  },
  support: {
    aiTriageEnabled: true,
    eligiblePlans: ["plus", "pro", "max"],
    ticketCostCredits: 0,
    ticketCostStars: 0,
    chargingModel: "first_message_only",
    chargingX: 1,
    staffRoles: ["support", "moderator", "admin"],
  },
  helpCenterSettings: {
    aiFreeForAll: false,
  },
};

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

const CACHE_KEY = "app:manifest:v3";
/** Raw key→value map cache — used by getManifestValue to avoid DB reads. */
const CACHE_KV_KEY = "app:manifest:kv:v3";
const CACHE_TTL_SECONDS = 60; // 1 minute

/** In-process manifest cache — avoids Redis on every API request within the same instance. */
const MEM_CACHE_KEY = "manifest:v3";
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

/** Parse a string value as a float. Returns fallback when not a valid number. */
function parseFloat10(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const n = parseFloat(value);
  return isNaN(n) ? fallback : n;
}

/** Parse a string value as a JSON array of strings. Returns fallback on any failure. */
function parseStringArray(value: string | undefined, fallback: string[]): string[] {
  if (value === undefined) return fallback;
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? (parsed as string[]) : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Maps every `feature_*` x_manifest key (canonical + legacy aliases) to the
 * matching camelCase property name on `ZobiaManifest['features']`. Used to
 * translate the admin-managed "mods can access while disabled" list (stored
 * as raw x_manifest keys, same as every other admin/feature-flags row) into
 * the camelCase keys client code checks (`useFeatureFlags()[key]`).
 * Exported so the admin API can reuse it instead of duplicating the table.
 */
export const FEATURE_FLAG_KEY_MAP: Record<string, keyof ZobiaManifest["features"]> = {
  feature_rooms: "rooms",
  feature_direct_messages: "directMessages",
  feature_gifts: "gifts",
  feature_rankings: "rankings",
  feature_community_notes: "communityNotes",
  feature_star_purchase: "starPurchase",
  feature_star_direct_purchase: "starPurchase",
  feature_nemesis_system: "nemesisSystem",
  feature_nemesis: "nemesisSystem",
  feature_guild_wars: "guildWars",
  feature_classrooms: "classrooms",
  feature_business_accounts: "businessAccounts",
  feature_admob_ads: "admobAds",
  feature_rewarded_ads: "rewardedAds",
  feature_games: "games",
  feature_merch_store: "merchStore",
  feature_creator_merch: "merchStore",
  feature_platform_council: "platformCouncil",
  feature_alliance_system: "allianceSystem",
  feature_pin_auth: "pinAuth",
  feature_profile_stats: "profileStats",
  feature_war_event_active: "warEventActive",
  feature_pidgin_autocomplete: "pidginAutocomplete",
  feature_moments: "moments",
  feature_forum: "forum",
  feature_bbforum: "bbforum",
  feature_blogs: "blogs",
  feature_blog_gifts: "blogGifts",
  feature_kyc: "kyc",
  feature_ads_system: "adsSystem",
  feature_native_ads: "nativeAds",
  feature_instream_ads: "instreamAds",
  feature_boosted_posts: "boostedPosts",
  feature_ad_coupons: "adCoupons",
};

/**
 * Parse the `feature_flags_mod_visible` x_manifest row: a JSON array of raw
 * x_manifest feature keys (e.g. `["feature_rooms","feature_kyc"]`) that
 * moderators may still see/access while disabled. Translates to the
 * camelCase `features.*` keys client code consumes.
 */
function parseModVisibleList(raw: string | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(unquote(raw));
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((v): v is string => typeof v === "string")
      .map((key) => FEATURE_FLAG_KEY_MAP[key] ?? key)
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Strip surrounding JSON double-quotes from a string value if present.
 *
 * The x_manifest seed (and some legacy admin writes) stored enum/string values
 * JSON-encoded — e.g. captcha_provider was seeded as the literal `"none"`
 * (quotes included) rather than the bare `none`. Application code compares
 * these against bare strings (`value === "turnstile"`), so a quoted value never
 * matches and silently falls through to a fallback. This normalises both legacy
 * quoted rows and plain rows to the bare string the rest of the code expects.
 *
 * Overloaded so callers passing a guaranteed string get a string back.
 */
function unquote(value: string): string;
function unquote(value: string | undefined): string | undefined;
function unquote(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    try { return JSON.parse(value) as string; } catch { /* ignore */ }
  }
  return value;
}

/** Build the full manifest from a key→value map of x_manifest rows. */
function buildManifest(kv: Record<string, string>): ZobiaManifest {
  // Resolve captchaProvider (unquote: seed/legacy rows store enum values JSON-quoted)
  const rawCaptcha = unquote(kv["captcha_provider"]);
  const captchaProvider: ZobiaManifest["captchaProvider"] =
    rawCaptcha === "recaptcha" || rawCaptcha === "turnstile" || rawCaptcha === "none"
      ? rawCaptcha
      : "none";

  // Resolve gifProvider
  const rawGif = unquote(kv["gif_provider"]);
  const gifProvider: ZobiaManifest["gifProvider"] =
    rawGif === "tenor" ? "tenor" : "giphy";

  // Resolve captchaEnabledSurfaces — JSON array of surface keys, same
  // serialization convention as grace_period_features_*. Falls back to all
  // surfaces enabled if the key is missing or malformed (pre-migration).
  let captchaEnabledSurfaces: string[] = DEFAULT_CAPTCHA_ENABLED_SURFACES;
  const rawCaptchaSurfaces = kv["captcha_active_surfaces"];
  if (rawCaptchaSurfaces) {
    try {
      const parsed = JSON.parse(rawCaptchaSurfaces);
      if (Array.isArray(parsed) && parsed.every((v) => typeof v === "string")) {
        captchaEnabledSurfaces = parsed;
      }
    } catch {
      // malformed — keep default
    }
  }

  // Resolve payment primaryProvider
  const rawProvider = unquote(kv["payment_primary_provider"]);
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
      moments:                    parseBool(kv["feature_moments"]                   ?? "true",  DEFAULT_MANIFEST.features.moments),
      forum:                      parseBool(kv["feature_forum"]                     ?? "true",  DEFAULT_MANIFEST.features.forum),
      bbforum:                    parseBool(kv["feature_bbforum"]                   ?? "true",  DEFAULT_MANIFEST.features.bbforum),
      blogs:                      parseBool(kv["feature_blogs"]                     ?? "true",  DEFAULT_MANIFEST.features.blogs),
      blogGifts:                  parseBool(kv["feature_blog_gifts"]                ?? "true",  DEFAULT_MANIFEST.features.blogGifts),
      blogMonetization:           parseBool(kv["blog_monetization_enabled"]         ?? "true",  DEFAULT_MANIFEST.features.blogMonetization),
      kyc:                        parseBool(kv["feature_kyc"]                       ?? "true",  DEFAULT_MANIFEST.features.kyc),
      adsSystem:                  parseBool(kv["feature_ads_system"]                ?? "true",  DEFAULT_MANIFEST.features.adsSystem),
      nativeAds:                  parseBool(kv["feature_native_ads"]                ?? "true",  DEFAULT_MANIFEST.features.nativeAds),
      instreamAds:                parseBool(kv["feature_instream_ads"]              ?? "true",  DEFAULT_MANIFEST.features.instreamAds),
      boostedPosts:               parseBool(kv["feature_boosted_posts"]             ?? "true",  DEFAULT_MANIFEST.features.boostedPosts),
      adCoupons:                  parseBool(kv["feature_ad_coupons"]                ?? "true",  DEFAULT_MANIFEST.features.adCoupons),
      profileStats:               parseBool(kv["feature_profile_stats"]             ?? "true",  DEFAULT_MANIFEST.features.profileStats),
      supportTickets:             parseBool(kv["feature_support_tickets"],                      DEFAULT_MANIFEST.features.supportTickets),
      helpCenter:                 parseBool(kv["feature_help_center"]               ?? "true",  DEFAULT_MANIFEST.features.helpCenter),
      helpCenterAi:               parseBool(kv["feature_help_center_ai"]            ?? "true",  DEFAULT_MANIFEST.features.helpCenterAi),
      // BUG-MANIFEST-01: populate vipRoomPricing from x_manifest keys
      vipRoomPricing: kv["vip_room_pricing_min_ngn"] && kv["vip_room_pricing_max_ngn"]
        ? {
            minNgn: parseInt10(kv["vip_room_pricing_min_ngn"], 200),
            maxNgn: parseInt10(kv["vip_room_pricing_max_ngn"], 10000),
          }
        : undefined,
    },
    featureModVisibility: parseModVisibleList(kv["feature_flags_mod_visible"]),
    currency: {
      softNameSingular:    unquote(kv["currency_soft_name_singular"])    ?? DEFAULT_MANIFEST.currency.softNameSingular,
      softNamePlural:      unquote(kv["currency_soft_name_plural"])      ?? DEFAULT_MANIFEST.currency.softNamePlural,
      premiumNameSingular: unquote(kv["currency_premium_name_singular"]) ?? DEFAULT_MANIFEST.currency.premiumNameSingular,
      premiumNamePlural:   unquote(kv["currency_premium_name_plural"])   ?? DEFAULT_MANIFEST.currency.premiumNamePlural,
    },
    moments: {
      costCredits: parseInt10(kv["moments_cost_credits"], DEFAULT_MANIFEST.moments.costCredits),
      costStars:   parseInt10(kv["moments_cost_stars"],   DEFAULT_MANIFEST.moments.costStars),
      minLevel:    parseInt10(kv["moments_min_level"],    DEFAULT_MANIFEST.moments.minLevel),
    },
    forum: {
      minLevelToPost:                 parseInt10(kv["forum_min_level_to_post"],              DEFAULT_MANIFEST.forum.minLevelToPost),
      minLevelToComment:              parseInt10(kv["forum_min_level_to_comment"],            DEFAULT_MANIFEST.forum.minLevelToComment),
      commentBypassCostCredits:       parseInt10(kv["forum_comment_bypass_cost_credits"],     DEFAULT_MANIFEST.forum.commentBypassCostCredits),
      rewardXpPerQuestion:            parseInt10(kv["forum_reward_xp_per_question"],          DEFAULT_MANIFEST.forum.rewardXpPerQuestion),
      rewardCreditsPerQuestion:       parseInt10(kv["forum_reward_credits_per_question"],     DEFAULT_MANIFEST.forum.rewardCreditsPerQuestion),
      rewardXpPerAnswer:              parseInt10(kv["forum_reward_xp_per_answer"],            DEFAULT_MANIFEST.forum.rewardXpPerAnswer),
      rewardCreditsPerAnswer:         parseInt10(kv["forum_reward_credits_per_answer"],       DEFAULT_MANIFEST.forum.rewardCreditsPerAnswer),
      rewardXpPerUpvoteReceived:      parseInt10(kv["forum_reward_xp_per_upvote"],            DEFAULT_MANIFEST.forum.rewardXpPerUpvoteReceived),
      rewardCreditsPerUpvoteReceived: parseInt10(kv["forum_reward_credits_per_upvote"],       DEFAULT_MANIFEST.forum.rewardCreditsPerUpvoteReceived),
      rewardXpBestAnswer:             parseInt10(kv["forum_reward_xp_best_answer"],           DEFAULT_MANIFEST.forum.rewardXpBestAnswer),
      rewardCreditsBestAnswer:        parseInt10(kv["forum_reward_credits_best_answer"],      DEFAULT_MANIFEST.forum.rewardCreditsBestAnswer),
      dailyRewardCapCredits:          parseInt10(kv["forum_daily_reward_cap_credits"],        DEFAULT_MANIFEST.forum.dailyRewardCapCredits),
      autoModerationEnabled:          parseBool(kv["forum_auto_moderation_enabled"] ?? "true", DEFAULT_MANIFEST.forum.autoModerationEnabled),
    },
    guilds: {
      minLevelToCreate: parseInt10(kv["guilds_min_level_to_create"], DEFAULT_MANIFEST.guilds.minLevelToCreate),
    },
    bbforum: {
      minLevelToPost:          parseInt10(kv["bbforum_min_level_to_post"],          DEFAULT_MANIFEST.bbforum.minLevelToPost),
      rewardXpPerThread:       parseInt10(kv["bbforum_reward_xp_per_thread"],       DEFAULT_MANIFEST.bbforum.rewardXpPerThread),
      rewardCreditsPerThread:  parseInt10(kv["bbforum_reward_credits_per_thread"],  DEFAULT_MANIFEST.bbforum.rewardCreditsPerThread),
      rewardXpPerReply:        parseInt10(kv["bbforum_reward_xp_per_reply"],        DEFAULT_MANIFEST.bbforum.rewardXpPerReply),
      rewardCreditsPerReply:   parseInt10(kv["bbforum_reward_credits_per_reply"],   DEFAULT_MANIFEST.bbforum.rewardCreditsPerReply),
      dailyRewardCapCredits:   parseInt10(kv["bbforum_daily_reward_cap_credits"],   DEFAULT_MANIFEST.bbforum.dailyRewardCapCredits),
      autoModerationEnabled:   parseBool(kv["bbforum_auto_moderation_enabled"] ?? "true", DEFAULT_MANIFEST.bbforum.autoModerationEnabled),
      imageCostCredits:        parseInt10(kv["bbforum_image_cost_credits"],         DEFAULT_MANIFEST.bbforum.imageCostCredits),
      imageCostStars:          parseInt10(kv["bbforum_image_cost_stars"],           DEFAULT_MANIFEST.bbforum.imageCostStars),
      potExpiryDays:           parseInt10(kv["bbforum_pot_expiry_days"],            DEFAULT_MANIFEST.bbforum.potExpiryDays),
    },
    ads: {
      moderationMode: kv["ad_moderation_mode"] === "ai" ? "ai" : "manual",
      aiAutoApproveThreshold: parseFloat10(kv["ad_ai_auto_approve_threshold"], DEFAULT_MANIFEST.ads.aiAutoApproveThreshold),
      minKycTierToAdvertise:  parseInt10(kv["ad_min_kyc_tier_to_advertise"],   DEFAULT_MANIFEST.ads.minKycTierToAdvertise),
      defaultCpmCredits:      parseInt10(kv["ad_default_cpm_credits"],        DEFAULT_MANIFEST.ads.defaultCpmCredits),
      roomInstreamInterval:   parseInt10(kv["ad_room_instream_interval"],     DEFAULT_MANIFEST.ads.roomInstreamInterval),
      rewardedDailyCap:       parseInt10(kv["ad_rewarded_daily_cap"],         DEFAULT_MANIFEST.ads.rewardedDailyCap),
      rewardedCreditsMin:     parseInt10(kv["ad_rewarded_credits_min"],       DEFAULT_MANIFEST.ads.rewardedCreditsMin),
      rewardedCreditsMax:     parseInt10(kv["ad_rewarded_credits_max"],       DEFAULT_MANIFEST.ads.rewardedCreditsMax),
      planAdsLevel: {
        free: (kv["ad_plan_free_ads_level"] as "full" | "reduced" | "none") ?? DEFAULT_MANIFEST.ads.planAdsLevel.free,
        plus: (kv["ad_plan_plus_ads_level"] as "full" | "reduced" | "none") ?? DEFAULT_MANIFEST.ads.planAdsLevel.plus,
        pro:  (kv["ad_plan_pro_ads_level"]  as "full" | "reduced" | "none") ?? DEFAULT_MANIFEST.ads.planAdsLevel.pro,
        max:  (kv["ad_plan_max_ads_level"]  as "full" | "reduced" | "none") ?? DEFAULT_MANIFEST.ads.planAdsLevel.max,
      },
      admob: {
        appId:               unquote(kv["ad_admob_app_id"])               ?? DEFAULT_MANIFEST.ads.admob.appId,
        bannerUnitId:        unquote(kv["ad_admob_banner_unit_id"])       ?? DEFAULT_MANIFEST.ads.admob.bannerUnitId,
        interstitialUnitId:  unquote(kv["ad_admob_interstitial_unit_id"]) ?? DEFAULT_MANIFEST.ads.admob.interstitialUnitId,
        rewardedUnitId:      unquote(kv["ad_admob_rewarded_unit_id"])     ?? DEFAULT_MANIFEST.ads.admob.rewardedUnitId,
        testMode:            parseBool(kv["ad_admob_test_mode"] ?? "true", DEFAULT_MANIFEST.ads.admob.testMode),
      },
    },
    warEventCooldownHours: parseInt10(kv["war_event_cooldown_hours"], DEFAULT_MANIFEST.warEventCooldownHours),
    maintenance: {
      enabled: parseBool(kv["maintenance_mode_enabled"] ?? "false", DEFAULT_MANIFEST.maintenance.enabled),
      message: unquote(kv["maintenance_message"]) ?? DEFAULT_MANIFEST.maintenance.message,
    },
    auth: {
      googleEnabled:   parseBool(kv["auth_google_enabled"],   DEFAULT_MANIFEST.auth.googleEnabled),
      telegramEnabled: parseBool(kv["auth_telegram_enabled"], DEFAULT_MANIFEST.auth.telegramEnabled),
    },
    captchaProvider,
    captchaEnabledSurfaces,
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
    deepLinkBaseUrl: unquote(kv["deep_link_base_url"]) ?? DEFAULT_MANIFEST.deepLinkBaseUrl,
    payment: {
      primaryProvider,
      paystackEnabled:     parseBool(kv["payment_paystack_enabled"],     DEFAULT_MANIFEST.payment.paystackEnabled),
      dodopaymentsEnabled: parseBool(kv["payment_dodopayments_enabled"], DEFAULT_MANIFEST.payment.dodopaymentsEnabled),
      // BUG-MANIFEST-01: populate currenciesAccepted from x_manifest key
      currenciesAccepted: kv["payment_currencies_accepted"]
        ? kv["payment_currencies_accepted"].split(",").map((c) => c.trim()).filter(Boolean)
        : undefined,
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
    kyc: {
      costCredits: parseInt10(kv["kyc_cost_credits"], DEFAULT_MANIFEST.kyc.costCredits),
      tier1ReviewMode: (unquote(kv["kyc_tier1_review_mode"]) === "manual" ? "manual" : "ai"),
      aiAutoApproveThreshold: parseFloat10(kv["kyc_ai_auto_approve_threshold"], DEFAULT_MANIFEST.kyc.aiAutoApproveThreshold),
      aiEscalateBelowThreshold: parseFloat10(kv["kyc_ai_escalate_below_threshold"], DEFAULT_MANIFEST.kyc.aiEscalateBelowThreshold),
      badgeMinTier: parseInt10(kv["kyc_badge_min_tier"], DEFAULT_MANIFEST.kyc.badgeMinTier),
      thresholds: {
        individual: {
          tier2Kobo:    parseInt10(kv["kyc_individual_tier2_threshold_kobo"],      DEFAULT_MANIFEST.kyc.thresholds.individual.tier2Kobo),
          tier2UsdCents: parseInt10(kv["kyc_individual_tier2_threshold_usd_cents"], DEFAULT_MANIFEST.kyc.thresholds.individual.tier2UsdCents),
          tier3Kobo:    parseInt10(kv["kyc_individual_tier3_threshold_kobo"],      DEFAULT_MANIFEST.kyc.thresholds.individual.tier3Kobo),
          tier3UsdCents: parseInt10(kv["kyc_individual_tier3_threshold_usd_cents"], DEFAULT_MANIFEST.kyc.thresholds.individual.tier3UsdCents),
        },
        business: {
          tier2Kobo:    parseInt10(kv["kyc_business_tier2_threshold_kobo"],      DEFAULT_MANIFEST.kyc.thresholds.business.tier2Kobo),
          tier2UsdCents: parseInt10(kv["kyc_business_tier2_threshold_usd_cents"], DEFAULT_MANIFEST.kyc.thresholds.business.tier2UsdCents),
          tier3Kobo:    parseInt10(kv["kyc_business_tier3_threshold_kobo"],      DEFAULT_MANIFEST.kyc.thresholds.business.tier3Kobo),
          tier3UsdCents: parseInt10(kv["kyc_business_tier3_threshold_usd_cents"], DEFAULT_MANIFEST.kyc.thresholds.business.tier3UsdCents),
        },
      },
    },
    support: {
      aiTriageEnabled: parseBool(kv["support_ai_triage_enabled"] ?? "true", DEFAULT_MANIFEST.support.aiTriageEnabled),
      eligiblePlans:    parseStringArray(kv["support_eligible_plans"],        DEFAULT_MANIFEST.support.eligiblePlans),
      ticketCostCredits: parseInt10(kv["support_ticket_cost_credits"],       DEFAULT_MANIFEST.support.ticketCostCredits),
      ticketCostStars:   parseInt10(kv["support_ticket_cost_stars"],         DEFAULT_MANIFEST.support.ticketCostStars),
      chargingModel: (() => {
        const raw = unquote(kv["support_charging_model"]);
        const valid = ["first_message_only", "every_message", "every_x_messages", "first_x_messages"];
        return (valid.includes(raw ?? "") ? raw : DEFAULT_MANIFEST.support.chargingModel) as ZobiaManifest["support"]["chargingModel"];
      })(),
      chargingX:   parseInt10(kv["support_charging_x"], DEFAULT_MANIFEST.support.chargingX),
      staffRoles:  parseStringArray(kv["support_staff_roles"], DEFAULT_MANIFEST.support.staffRoles),
    },
    helpCenterSettings: {
      aiFreeForAll: parseBool(kv["help_center_ai_free_for_all"], DEFAULT_MANIFEST.helpCenterSettings.aiFreeForAll),
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
        logger.error({ err }, "[manifest] Failed to load from DB, using defaults");
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
      const cachedVal = kv[key];
      return cachedVal === undefined ? null : unquote(cachedVal);
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
    const raw = rows[0]?.value;
    // Normalise JSON-quoted enum/string values (e.g. seed stores `"none"`) to
    // the bare string callers compare against. Boolean/integer rows are stored
    // unquoted, so unquote() is a no-op for them.
    return raw === undefined ? null : unquote(raw);
  } catch (err) {
    logger.error({ err, key }, "[manifest] Failed to read key from DB");
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
  } catch (err) {
    logger.error({ err, featureKey, userPlan }, '[manifest] Feature gate DB error — denying access');
    return false;
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
