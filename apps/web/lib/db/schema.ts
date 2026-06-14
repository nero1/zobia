/**
 * lib/db/schema.ts
 *
 * Drizzle ORM schema — single source of truth for all table definitions.
 *
 * Column names here match the SQL migrations exactly. TypeScript code that
 * references query results should use the $inferSelect / $inferInsert types
 * exported below so that schema-code divergence is caught at compile time.
 *
 * Usage:
 *   import { schema } from '@/lib/db/schema';
 *   type User = typeof schema.users.$inferSelect;
 *
 * The Drizzle query builder (for providers using pg) is in lib/db/drizzle.ts.
 */

import {
  pgTable,
  uuid,
  text,
  boolean,
  integer,
  bigint,
  timestamp,
  date,
  jsonb,
  decimal,
  uniqueIndex,
  index,
  primaryKey,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const now = () => timestamp("created_at", { withTimezone: true }).defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true }).defaultNow();
const uuidPk = () =>
  uuid("id")
    .primaryKey()
    .default(sql`uuid_generate_v4()`);
const uuidPkGen = () =>
  uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`);

// ---------------------------------------------------------------------------
// SECTION 1: Users & Auth
// ---------------------------------------------------------------------------

export const users = pgTable("users", {
  id: uuidPk(),
  username: text("username").notNull().unique(),
  displayName: text("display_name").notNull(),
  email: text("email").unique(),
  passwordHash: text("password_hash"),
  pinHash: text("pin_hash"),
  avatarEmoji: text("avatar_emoji").notNull().default("😊"),
  bio: text("bio"),
  city: text("city"),
  country: text("country").default("NG"),
  locale: text("locale").default("en"),
  gender: text("gender"),

  // Auth
  googleId: text("google_id").unique(),
  telegramId: text("telegram_id").unique(),
  isEmailVerified: boolean("is_email_verified").default(false),
  totpSecret: text("totp_secret"),
  totpEnabled: boolean("totp_enabled").notNull().default(false),

  // Status
  plan: text("plan").notNull().default("free"),
  isAdmin: boolean("is_admin").notNull().default(false),
  isModerator: boolean("is_moderator").notNull().default(false),
  isCreator: boolean("is_creator").notNull().default(false),
  creatorTier: text("creator_tier").notNull().default("rookie"),
  creatorRole: boolean("creator_role").notNull().default(false),
  isVerified: boolean("is_verified").default(false),
  isSeed: boolean("is_seed").notNull().default(false),
  isCouncilMember: boolean("is_council_member").notNull().default(false),

  // Trust & Safety
  trustScore: integer("trust_score").default(50),
  isSuspended: boolean("is_suspended").default(false),
  suspendedUntil: timestamp("suspended_until", { withTimezone: true }),
  suspensionReason: text("suspension_reason"),
  isBanned: boolean("is_banned").default(false),
  banType: text("ban_type"),
  bannedUntil: timestamp("banned_until", { withTimezone: true }),
  banReason: text("ban_reason"),
  dmPrivacy: text("dm_privacy").notNull().default("everyone"),
  dmOptOut: boolean("dm_opt_out").notNull().default(false),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),

  // XP & Rank
  xpTotal: integer("xp_total").notNull().default(0),
  legacyScore: integer("legacy_score").notNull().default(0),
  rankName: text("rank_name").notNull().default("Beginner"),
  rankLevel: integer("rank_level").notNull().default(1),
  rankSublevel: integer("rank_sublevel").notNull().default(1),
  prestigeCount: integer("prestige_count").notNull().default(0),
  prestigeCycleBoostExpiresAt: timestamp("prestige_cycle_boost_expires_at", {
    withTimezone: true,
  }),
  customCrest: text("custom_crest"),

  // Track XP
  xpSocial: integer("xp_social").notNull().default(0),
  xpCreator: integer("xp_creator").notNull().default(0),
  xpCompetitor: integer("xp_competitor").notNull().default(0),
  xpGenerosity: integer("xp_generosity").notNull().default(0),
  xpKnowledge: integer("xp_knowledge").notNull().default(0),
  xpExplorer: integer("xp_explorer").notNull().default(0),

  // Track Levels
  levelSocial: integer("level_social").notNull().default(1),
  levelCreator: integer("level_creator").notNull().default(1),
  levelCompetitor: integer("level_competitor").notNull().default(1),
  levelGenerosity: integer("level_generosity").notNull().default(1),
  levelKnowledge: integer("level_knowledge").notNull().default(1),
  levelExplorer: integer("level_explorer").notNull().default(1),

  // Economy
  coinBalance: bigint("coin_balance", { mode: "number" }).notNull().default(0),
  starBalance: integer("star_balance").notNull().default(0),
  availableEarningsKobo: bigint("available_earnings_kobo", {
    mode: "number",
  })
    .notNull()
    .default(0),
  payoutRecipientCode: text("payout_recipient_code"),
  payoutAccountLast4: text("payout_account_last4"),

  // Streaks
  loginStreak: integer("login_streak").notNull().default(0),
  loginStreakDays: integer("login_streak_days").notNull().default(0),
  longestStreak: integer("longest_streak").notNull().default(0),
  lastStreakBeforeBreak: integer("last_streak_before_break")
    .notNull()
    .default(0),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  lastLoginDate: date("last_login_date"),
  lastActiveAt: timestamp("last_active_at", {
    withTimezone: true,
  }).defaultNow(),

  // Guild
  guildId: uuid("guild_id"),

  // Onboarding
  dateOfBirth: date("date_of_birth"),
  vibeQuizResponses: jsonb("vibe_quiz_responses"),
  onboardingPersonalization: jsonb("onboarding_personalization"),
  onboardingCompleted: boolean("onboarding_completed").default(false),
  newMemberQuestCompleted: boolean("new_member_quest_completed").default(false),
  chatTheme: text("chat_theme").notNull().default("default"),

  // Referral
  referredBy: uuid("referred_by"),
  referralCode: text("referral_code").unique(),

  // Cosmetics
  activeCosmeticFrameId: uuid("active_cosmetic_frame_id"),
  activeCosmeticTitle: text("active_cosmetic_title"),
  activeFrameId: text("active_frame_id"),
  hdSendEnabled: boolean("hd_send_enabled").notNull().default(false),

  // Push & notification preferences
  pushToken: text("push_token"),
  dmNotifications: boolean("dm_notifications").default(true),
  guildNotifications: boolean("guild_notifications").default(true),
  streakNotifications: boolean("streak_notifications").default(true),
  notifyNewMessage: boolean("notify_new_message").notNull().default(true),
  notifyFriendRequest: boolean("notify_friend_request").notNull().default(true),
  notifyGiftReceived: boolean("notify_gift_received").notNull().default(true),
  notifyRankUp: boolean("notify_rank_up").notNull().default(true),
  notifyWarStart: boolean("notify_war_start").notNull().default(true),
  notifySeasonEnd: boolean("notify_season_end").notNull().default(true),
  notifyAnnouncement: boolean("notify_announcement").notNull().default(true),
  emailAllEnabled: boolean("email_all_enabled").notNull().default(true),
  emailNonCritical: boolean("email_non_critical").notNull().default(true),

  // Misc
  pidginSuggestionsEnabled: boolean("pidgin_suggestions_enabled"),
  avatarUrl: text("avatar_url"),
  profilePrivate: boolean("profile_private").notNull().default(false),
  profileHiddenSections: jsonb("profile_hidden_sections")
    .notNull()
    .default(sql`'[]'`),
  disableFriendRequests: boolean("disable_friend_requests")
    .notNull()
    .default(false),

  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const sessions = pgTable("sessions", {
  id: uuidPk(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  refreshTokenHash: text("refresh_token_hash").notNull(),
  deviceInfo: jsonb("device_info"),
  ipAddress: text("ip_address"),
  isAdminSession: boolean("is_admin_session").default(false),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }).defaultNow(),
});

// ---------------------------------------------------------------------------
// SECTION 2: Social Graph
// ---------------------------------------------------------------------------

export const follows = pgTable(
  "follows",
  {
    id: uuidPk(),
    followerId: uuid("follower_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    followingId: uuid("following_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    unique: uniqueIndex("follows_follower_following_idx").on(
      t.followerId,
      t.followingId
    ),
  })
);

export const reports = pgTable("reports", {
  id: uuidPk(),
  reporterUserId: uuid("reporter_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  reportedUserId: uuid("reported_user_id").references(() => users.id, {
    onDelete: "cascade",
  }),
  reportedContentId: uuid("reported_content_id"),
  contentType: text("content_type"),
  reason: text("reason").notNull(),
  details: text("details"),
  status: text("status").notNull().default("pending"),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  resolvedBy: uuid("resolved_by").references(() => users.id, {
    onDelete: "set null",
  }),
  aiScore: decimal("ai_score", { precision: 5, scale: 4 }),
  aiCategory: text("ai_category"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const moderationActions = pgTable("moderation_actions", {
  id: uuidPk(),
  targetUserId: uuid("target_user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  moderatorId: uuid("moderator_id").references(() => users.id, {
    onDelete: "set null",
  }),
  reportId: uuid("report_id").references(() => reports.id, {
    onDelete: "set null",
  }),
  actionType: text("action_type").notNull(),
  reason: text("reason"),
  duration: integer("duration"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

// ---------------------------------------------------------------------------
// SECTION 3: Notifications
// ---------------------------------------------------------------------------

export const notifications = pgTable("notifications", {
  id: uuidPkGen(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  payload: jsonb("payload"),
  title: text("title"),
  body: text("body"),
  metadata: jsonb("metadata"),
  isRead: boolean("is_read").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// SECTION 4: Economy
// ---------------------------------------------------------------------------

export const coinLedger = pgTable("coin_ledger", {
  id: uuidPk(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  amount: bigint("amount", { mode: "number" }).notNull(),
  balanceBefore: bigint("balance_before", { mode: "number" }).notNull(),
  balanceAfter: bigint("balance_after", { mode: "number" }).notNull(),
  transactionType: text("transaction_type").notNull(),
  referenceId: text("reference_id"),
  description: text("description"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const xpLedger = pgTable(
  "xp_ledger",
  {
    id: uuidPk(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    amount: integer("amount").notNull(),
    track: text("track").notNull().default("main"),
    source: text("source").notNull(),
    action: text("action"),
    xpAmount: integer("xp_amount"),
    xpNet: integer("xp_net"),
    referenceId: text("reference_id"),
    multiplier: decimal("multiplier", { precision: 4, scale: 2 }).default("1.0"),
    baseAmount: integer("base_amount").notNull(),
    description: text("description"),
    ceremonyRoomId: uuid("ceremony_room_id"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    // Unique index for deduplication (BUG-DB06 fix - migration 007)
    sourceRefIdx: uniqueIndex("uidx_xp_ledger_source_ref")
      .on(t.userId, t.source, t.referenceId)
      .where(sql`reference_id IS NOT NULL`),
  })
);

export const failedXpAwards = pgTable("failed_xp_awards", {
  id: uuidPkGen(),
  userId: uuid("user_id").notNull(),
  amount: integer("amount").notNull(),
  track: text("track").notNull(),
  source: text("source").notNull(),
  referenceId: text("reference_id"),
  errorMessage: text("error_message"),
  failedAt: timestamp("failed_at", { withTimezone: true }).notNull().defaultNow(),
  retryCount: integer("retry_count").notNull().default(0),
  lastRetriedAt: timestamp("last_retried_at", { withTimezone: true }),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
});

export const payments = pgTable("payments", {
  id: uuidPk(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  paymentType: text("payment_type").notNull(),
  amountKobo: bigint("amount_kobo", { mode: "number" }).notNull(),
  currency: text("currency").notNull().default("NGN"),
  provider: text("provider").notNull(),
  providerReference: text("provider_reference").unique(),
  providerTransactionId: text("provider_transaction_id"),
  status: text("status").notNull().default("pending"),
  coinsCredited: bigint("coins_credited", { mode: "number" }),
  amountReceivedKobo: bigint("amount_received_kobo", { mode: "number" }),
  idempotencyKey: text("idempotency_key").unique(),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

export const auditDiscrepancies = pgTable("audit_discrepancies", {
  id: uuidPkGen(),
  userId: uuid("user_id").notNull(),
  assetType: text("asset_type").notNull(),
  ledgerSum: bigint("ledger_sum", { mode: "number" }).notNull(),
  walletBalance: bigint("wallet_balance", { mode: "number" }).notNull(),
  detectedAt: timestamp("detected_at", { withTimezone: true }).notNull().defaultNow(),
  resolved: boolean("resolved").notNull().default(false),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  notes: text("notes"),
});

// ---------------------------------------------------------------------------
// SECTION 5: Referrals
// ---------------------------------------------------------------------------

export const referrals = pgTable(
  "referrals",
  {
    id: uuidPk(),
    referrerId: uuid("referrer_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    referredId: uuid("referred_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tier: integer("tier").notNull().default(1),
    qualified: boolean("qualified").notNull().default(false),
    qualifiedAt: timestamp("qualified_at", { withTimezone: true }),
    coinReward: integer("coin_reward"),
    xpReward: integer("xp_reward"),
    rewardedAt: timestamp("rewarded_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    unique: uniqueIndex("referrals_referrer_referred_idx").on(
      t.referrerId,
      t.referredId
    ),
  })
);

export const referralCommissions = pgTable("referral_commissions", {
  id: uuidPkGen(),
  referrerId: uuid("referrer_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  referredUserId: uuid("referred_user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  triggerEventId: text("trigger_event_id").notNull(),
  purchaseAmountKobo: bigint("purchase_amount_kobo", { mode: "number" }).notNull(),
  commissionKobo: bigint("commission_kobo", { mode: "number" }).notNull(),
  commissionCoins: integer("commission_coins").notNull().default(0),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  creditedAt: timestamp("credited_at", { withTimezone: true }),
});

// ---------------------------------------------------------------------------
// SECTION 6: Creator Economy
// ---------------------------------------------------------------------------

export const creatorPayouts = pgTable("creator_payouts", {
  id: uuidPk(),
  creatorId: uuid("creator_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  amountKobo: bigint("amount_kobo", { mode: "number" }).notNull(),
  grossKobo: bigint("gross_kobo", { mode: "number" }),
  netKobo: bigint("net_kobo", { mode: "number" }),
  platformFeeKobo: bigint("platform_fee_kobo", { mode: "number" }),
  provider: text("provider").notNull(),
  bankAccountReference: text("bank_account_reference"),
  bankAccountLast4: text("bank_account_last4"),
  bankAccountSnapshot: jsonb("bank_account_snapshot"),
  walletAddressSnapshot: text("wallet_address_snapshot"),
  payoutMethod: text("payout_method").default("bank_transfer"),
  region: text("region").default("nigeria"),
  status: text("status").notNull().default("pending"),
  requiresManualApproval: boolean("requires_manual_approval").default(false),
  approvedByAdminId: uuid("approved_by_admin_id").references(() => users.id, {
    onDelete: "set null",
  }),
  idempotencyKey: text("idempotency_key").unique(),
  providerReference: text("provider_reference"),
  providerStatus: text("provider_status"),
  retryCount: integer("retry_count").notNull().default(0),
  lastRetryAt: timestamp("last_retry_at", { withTimezone: true }),
  nextRetryAt: timestamp("next_retry_at", { withTimezone: true }),
  appealReason: text("appeal_reason"),
  appealStatus: text("appeal_status"),
  appealSubmittedAt: timestamp("appeal_submitted_at", { withTimezone: true }),
  appealResolvedAt: timestamp("appeal_resolved_at", { withTimezone: true }),
  appealResolvedBy: uuid("appeal_resolved_by").references(() => users.id, {
    onDelete: "set null",
  }),
  earningsRestored: boolean("earnings_restored").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

// ---------------------------------------------------------------------------
// SECTION 7: Quests & Progression
// ---------------------------------------------------------------------------

export const questTemplates = pgTable("quest_templates", {
  id: uuidPk(),
  title: text("title").notNull().unique(),
  description: text("description").notNull(),
  actionType: text("action_type").notNull(),
  targetCount: integer("target_count").notNull(),
  xpReward: integer("xp_reward").notNull().default(0),
  coinReward: integer("coin_reward").notNull().default(0),
  track: text("track").default("main"),
  planRequired: text("plan_required").default("free"),
  category: text("category").notNull().default("general"),
  icon: text("icon"),
  validDate: date("valid_date"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const userQuestProgress = pgTable(
  "user_quest_progress",
  {
    id: uuidPk(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    questId: uuid("quest_id")
      .notNull()
      .references(() => questTemplates.id, { onDelete: "cascade" }),
    questDate: date("quest_date").notNull(),
    progressCount: integer("progress_count").notNull().default(0),
    completed: boolean("completed").notNull().default(false),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    expiredAt: timestamp("expired_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    unique: uniqueIndex("user_quest_progress_unique").on(
      t.userId,
      t.questId,
      t.questDate
    ),
  })
);

// user_quest_decks references quest_templates (migration 006 references 'quests'
// which is a naming bug — the correct table is quest_templates)
export const userQuestDecks = pgTable(
  "user_quest_decks",
  {
    id: uuidPkGen(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    questId: uuid("quest_id").notNull().references(() => questTemplates.id, { onDelete: "cascade" }),
    assignedDate: date("assigned_date").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    unique: uniqueIndex("user_quest_decks_unique").on(
      t.userId,
      t.questId,
      t.assignedDate
    ),
    userDateIdx: index("idx_user_quest_decks_user_date").on(
      t.userId,
      t.assignedDate
    ),
  })
);

export const leaderboardSnapshots = pgTable(
  "leaderboard_snapshots",
  {
    id: uuidPk(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    track: text("track").notNull().default("main"),
    scope: text("scope").notNull().default("global"),
    city: text("city"),
    seasonId: uuid("season_id"),
    xpValue: bigint("xp_value", { mode: "number" }).notNull().default(0),
    rankPosition: integer("rank_position"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    // BUG-05: Use expression index with COALESCE to handle NULL city/season_id
    // Standard UNIQUE constraints treat each NULL as distinct; COALESCE normalises NULLs
    unique: uniqueIndex("leaderboard_snapshots_upsert_idx").on(
      t.userId,
      t.track,
      t.scope,
      sql`COALESCE(${t.city}, '')`,
      sql`COALESCE(${t.seasonId}::text, '')`
    ),
  })
);

// ---------------------------------------------------------------------------
// SECTION 8: Guilds
// ---------------------------------------------------------------------------

export const guildQuests = pgTable("guild_quests", {
  id: uuidPk(),
  guildId: uuid("guild_id").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  questType: text("quest_type").notNull().default("collective"),
  targetCount: integer("target_count").notNull().default(100),
  currentCount: integer("current_count").notNull().default(0),
  rewardGuildXp: integer("reward_guild_xp").notNull().default(500),
  rewardCoins: integer("reward_coins").notNull().default(200),
  weekStart: timestamp("week_start", { withTimezone: true }).notNull(),
  weekEnd: timestamp("week_end", { withTimezone: true }).notNull(),
  isCompleted: boolean("is_completed").default(false),
  isActive: boolean("is_active").notNull().default(true),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const allianceWars = pgTable("alliance_wars", {
  id: uuidPkGen(),
  alliance1Id: uuid("alliance_1_id").notNull(),
  alliance2Id: uuid("alliance_2_id").notNull(),
  status: text("status").notNull().default("active"),
  winnerAllianceId: uuid("winner_alliance_id"),
  alliance1Xp: bigint("alliance_1_xp", { mode: "number" }).notNull().default(0),
  alliance2Xp: bigint("alliance_2_xp", { mode: "number" }).notNull().default(0),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
});

// ---------------------------------------------------------------------------
// SECTION 9: Rooms
// ---------------------------------------------------------------------------

export const roomMessages = pgTable("room_messages", {
  id: uuidPk(),
  senderId: uuid("sender_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  roomId: uuid("room_id"),
  groupChatId: uuid("group_chat_id"),
  conversationId: uuid("conversation_id"),
  messageType: text("message_type").notNull().default("text"),
  content: text("content"),
  mediaUrl: text("media_url"),
  metadata: jsonb("metadata"),
  coinCost: bigint("coin_cost", { mode: "number" }).default(0),
  replyCountFromRecipient: integer("reply_count_from_recipient").default(0),
  isDeleted: boolean("is_deleted").default(false),
  isFlagged: boolean("is_flagged").default(false),
  isPinned: boolean("is_pinned").default(false),
  pinnedAt: timestamp("pinned_at", { withTimezone: true }),
  pinnedBy: uuid("pinned_by"),
  pinExpiresAt: timestamp("pin_expires_at", { withTimezone: true }),
  replyToMessageId: uuid("reply_to_message_id"),
  isPendingApproval: boolean("is_pending_approval").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

// ---------------------------------------------------------------------------
// SECTION 10: Badges & Cosmetics
// ---------------------------------------------------------------------------

export const userBadges = pgTable("user_badges", {
  id: uuidPk(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  badgeType: text("badge_type"),
  badgeKey: text("badge_key"),
  referenceId: text("reference_id"),
  metadata: jsonb("metadata"),
  awardedAt: timestamp("awarded_at", { withTimezone: true }).defaultNow(),
  grantedAt: timestamp("granted_at", { withTimezone: true }).defaultNow(),
});

// ---------------------------------------------------------------------------
// SECTION 11: User Inactivity
// ---------------------------------------------------------------------------

export const userInactivityEvents = pgTable("user_inactivity_events", {
  id: uuidPk(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  inactiveDays: integer("inactive_days").notNull(),
  notified: boolean("notified").notNull().default(false),
  pushEmailNotified: boolean("push_email_notified"),
  telegramNotified: boolean("telegram_notified"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

// ---------------------------------------------------------------------------
// SECTION 12: Push Tokens (BUG-17)
// ---------------------------------------------------------------------------

export const userPushTokens = pgTable(
  "user_push_tokens",
  {
    id: uuidPkGen(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    token: text("token").notNull(),
    platform: text("platform").notNull().default("expo"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    unique: uniqueIndex("user_push_tokens_user_token_idx").on(t.userId, t.token),
  })
);

// ---------------------------------------------------------------------------
// SECTION 13: Gifts (BUG-12)
// ---------------------------------------------------------------------------

export const giftTypes = pgTable("gift_types", {
  id: uuidPk(),
  name: text("name").notNull().unique(),
  emoji: text("emoji").notNull(),
  coinCost: integer("coin_cost").notNull(),
  xpValue: integer("xp_value").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  isLimitedEdition: boolean("is_limited_edition").notNull().default(false),
  isRetired: boolean("is_retired").notNull().default(false),
  seasonId: uuid("season_id"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const gifts = pgTable("gifts", {
  id: uuidPk(),
  senderId: uuid("sender_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  recipientId: uuid("recipient_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  giftTypeId: uuid("gift_type_id")
    .notNull()
    .references(() => giftTypes.id),
  messageId: uuid("message_id"),
  roomId: uuid("room_id"),
  coinCost: integer("coin_cost").notNull(),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

// ---------------------------------------------------------------------------
// SECTION 14: Rooms (BUG-12)
// ---------------------------------------------------------------------------

export const rooms = pgTable("rooms", {
  id: uuidPk(),
  creatorId: uuid("creator_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  type: text("type").notNull().default("free_open"),
  isActive: boolean("is_active").notNull().default(true),
  totalMessages: integer("total_messages").notNull().default(0),
  memberCount: integer("member_count").notNull().default(0),
  closesAt: timestamp("closes_at", { withTimezone: true }),
  metadata: jsonb("metadata"),
  moderationRules: jsonb("moderation_rules"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const roomMembers = pgTable(
  "room_members",
  {
    id: uuidPkGen(),
    roomId: uuid("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("member"),
    isMuted: boolean("is_muted").notNull().default(false),
    mutedUntil: timestamp("muted_until", { withTimezone: true }),
    joinedAt: timestamp("joined_at", { withTimezone: true }).defaultNow(),
    leftAt: timestamp("left_at", { withTimezone: true }),
  },
  (t) => ({
    unique: uniqueIndex("room_members_room_user_idx").on(t.roomId, t.userId),
  })
);

// ---------------------------------------------------------------------------
// SECTION 15: Guild Wars (BUG-12)
// ---------------------------------------------------------------------------

export const guilds = pgTable("guilds", {
  id: uuidPk(),
  name: text("name").notNull().unique(),
  description: text("description"),
  creatorId: uuid("creator_id").references(() => users.id, { onDelete: "set null" }),
  tier: text("tier").notNull().default("bronze_1"),
  guildXp: integer("guild_xp").notNull().default(0),
  city: text("city"),
  isActive: boolean("is_active").notNull().default(true),
  warsWon: integer("wars_won").notNull().default(0),
  warsLost: integer("wars_lost").notNull().default(0),
  lastWarEndedAt: timestamp("last_war_ended_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const guildMembers = pgTable(
  "guild_members",
  {
    id: uuidPkGen(),
    guildId: uuid("guild_id")
      .notNull()
      .references(() => guilds.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("member"),
    joinedAt: timestamp("joined_at", { withTimezone: true }).defaultNow(),
    leftAt: timestamp("left_at", { withTimezone: true }),
  },
  (t) => ({
    unique: uniqueIndex("guild_members_guild_user_idx").on(t.guildId, t.userId),
  })
);

export const guildWars = pgTable("guild_wars", {
  id: uuidPkGen(),
  challengerGuildId: uuid("challenger_guild_id")
    .notNull()
    .references(() => guilds.id),
  defenderGuildId: uuid("defender_guild_id")
    .notNull()
    .references(() => guilds.id),
  status: text("status").notNull().default("active"),
  challengerPoints: integer("challenger_points").notNull().default(0),
  defenderPoints: integer("defender_points").notNull().default(0),
  winnerGuildId: uuid("winner_guild_id"),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull().defaultNow(),
  endsAt: timestamp("ends_at", { withTimezone: true }),
  finalHourStartsAt: timestamp("final_hour_starts_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const guildWarMembers = pgTable(
  "war_contributions",
  {
    id: uuidPkGen(),
    warId: uuid("war_id")
      .notNull()
      .references(() => guildWars.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    guildId: uuid("guild_id").notNull(),
    warPoints: integer("war_points").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    unique: uniqueIndex("war_contributions_war_user_idx").on(t.warId, t.userId),
  })
);

// ---------------------------------------------------------------------------
// SECTION 16: Audit Log (BUG-30)
// ---------------------------------------------------------------------------

export const auditLog = pgTable("audit_log", {
  id: uuidPkGen(),
  actorId: uuid("actor_id"),
  action: text("action").notNull(),
  targetType: text("target_type"),
  targetId: text("target_id"),
  metadata: jsonb("metadata"),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// SECTION 17: Hall of Fame (BUG-11 reference)
// ---------------------------------------------------------------------------

export const hallOfFame = pgTable("hall_of_fame", {
  id: uuidPkGen(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" })
    .unique(),
  inductedAt: timestamp("inducted_at", { withTimezone: true }).notNull().defaultNow(),
  inductedBy: uuid("inducted_by").references(() => users.id, { onDelete: "set null" }),
  reason: text("reason"),
});

// ---------------------------------------------------------------------------
// SECTION 18: Gift Items (for season engine)
// ---------------------------------------------------------------------------

export const giftItems = pgTable("gift_items", {
  id: uuidPk(),
  name: text("name").notNull(),
  emoji: text("emoji").notNull(),
  coinCost: integer("coin_cost").notNull(),
  isLimitedEdition: boolean("is_limited_edition").notNull().default(false),
  isRetired: boolean("is_retired").notNull().default(false),
  seasonId: uuid("season_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

// ---------------------------------------------------------------------------
// SECTION 19: Seasons (for season engine)
// ---------------------------------------------------------------------------

export const seasons = pgTable("seasons", {
  id: uuidPk(),
  name: text("name").notNull(),
  theme: text("theme").notNull().default("default"),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  isActive: boolean("is_active").notNull().default(false),
  passPriceCoins: integer("pass_price_coins").notNull().default(0),
  rewardPoolCoins: integer("reward_pool_coins").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const seasonPassMilestones = pgTable("season_pass_milestones", {
  id: uuidPk(),
  seasonId: uuid("season_id")
    .notNull()
    .references(() => seasons.id, { onDelete: "cascade" }),
  milestoneXp: integer("milestone_xp").notNull(),
  tier: text("tier").notNull().default("free"),
  rewardType: text("reward_type").notNull(),
  rewardValue: jsonb("reward_value"),
  displayName: text("display_name").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const userSeasonPasses = pgTable(
  "user_season_passes",
  {
    id: uuidPkGen(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    seasonId: uuid("season_id")
      .notNull()
      .references(() => seasons.id, { onDelete: "cascade" }),
    isPaid: boolean("is_paid").notNull().default(false),
    seasonXp: integer("season_xp").notNull().default(0),
    seasonRank: integer("season_rank"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    unique: uniqueIndex("user_season_passes_user_season_idx").on(t.userId, t.seasonId),
  })
);

export const userSeasonPassClaims = pgTable(
  "user_season_pass_claims",
  {
    id: uuidPkGen(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    seasonId: uuid("season_id")
      .notNull()
      .references(() => seasons.id, { onDelete: "cascade" }),
    milestoneId: uuid("milestone_id")
      .notNull()
      .references(() => seasonPassMilestones.id, { onDelete: "cascade" }),
    claimedAt: timestamp("claimed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    unique: uniqueIndex("user_season_pass_claims_user_milestone_idx").on(t.userId, t.milestoneId),
  })
);

// ---------------------------------------------------------------------------
// Inferred TypeScript types — use these in your query result annotations
// instead of manually written interfaces.
// ---------------------------------------------------------------------------

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;

export type Follow = typeof follows.$inferSelect;
export type NewFollow = typeof follows.$inferInsert;

export type Report = typeof reports.$inferSelect;
export type NewReport = typeof reports.$inferInsert;

export type ModerationAction = typeof moderationActions.$inferSelect;
export type NewModerationAction = typeof moderationActions.$inferInsert;

export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;

export type CoinLedgerEntry = typeof coinLedger.$inferSelect;
export type NewCoinLedgerEntry = typeof coinLedger.$inferInsert;

export type XpLedgerEntry = typeof xpLedger.$inferSelect;
export type NewXpLedgerEntry = typeof xpLedger.$inferInsert;

export type FailedXpAward = typeof failedXpAwards.$inferSelect;

export type Payment = typeof payments.$inferSelect;
export type NewPayment = typeof payments.$inferInsert;

export type Referral = typeof referrals.$inferSelect;
export type NewReferral = typeof referrals.$inferInsert;

export type ReferralCommission = typeof referralCommissions.$inferSelect;
export type NewReferralCommission = typeof referralCommissions.$inferInsert;

export type CreatorPayout = typeof creatorPayouts.$inferSelect;
export type NewCreatorPayout = typeof creatorPayouts.$inferInsert;

export type QuestTemplate = typeof questTemplates.$inferSelect;
export type NewQuestTemplate = typeof questTemplates.$inferInsert;

export type UserQuestProgress = typeof userQuestProgress.$inferSelect;
export type NewUserQuestProgress = typeof userQuestProgress.$inferInsert;

export type UserQuestDeck = typeof userQuestDecks.$inferSelect;
export type NewUserQuestDeck = typeof userQuestDecks.$inferInsert;

export type LeaderboardSnapshot = typeof leaderboardSnapshots.$inferSelect;
export type NewLeaderboardSnapshot = typeof leaderboardSnapshots.$inferInsert;

export type GuildQuest = typeof guildQuests.$inferSelect;
export type UserBadge = typeof userBadges.$inferSelect;
export type RoomMessage = typeof roomMessages.$inferSelect;

// Convenience namespace so callers can do: import { schema } from '@/lib/db/schema'
export const schema = {
  users,
  sessions,
  follows,
  reports,
  moderationActions,
  notifications,
  coinLedger,
  xpLedger,
  failedXpAwards,
  payments,
  auditDiscrepancies,
  referrals,
  referralCommissions,
  creatorPayouts,
  questTemplates,
  userQuestProgress,
  userQuestDecks,
  leaderboardSnapshots,
  guildQuests,
  allianceWars,
  roomMessages,
  userBadges,
  userInactivityEvents,
  userPushTokens,
  giftTypes,
  gifts,
  rooms,
  roomMembers,
  guilds,
  guildMembers,
  guildWars,
  guildWarMembers,
  auditLog,
  hallOfFame,
  giftItems,
  seasons,
  seasonPassMilestones,
  userSeasonPasses,
  userSeasonPassClaims,
};
