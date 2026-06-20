/**
 * lib/db/schema.ts
 *
 * Drizzle ORM schema — complete single source of truth for all table
 * definitions, derived from db/migrations/001_complete_schema.sql and all
 * subsequent incremental migrations (002–015) plus lib/db/migrations.
 *
 * Column names exactly match the SQL migrations. Use $inferSelect / $inferInsert
 * types exported at the bottom to avoid manual interface duplication.
 *
 * Usage:
 *   import { schema } from '@/lib/db/schema';
 *   import { users, type User } from '@/lib/db/schema';
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
  numeric,
  uniqueIndex,
  index,
  primaryKey,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const uuidPk = () =>
  uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`);

const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).defaultNow();

const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true }).defaultNow();

// ---------------------------------------------------------------------------
// SECTION 1: Config tables
// ---------------------------------------------------------------------------

export const xManifest = pgTable("x_manifest", {
  key: text("key").primaryKey(),
  // SCHEMA-XP-01: value is a text string, not structured JSON (jsonb was wrong type)
  value: text("value").notNull(),
  description: text("description"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const cronState = pgTable("cron_state", {
  key: text("key").primaryKey(),
  valueText: text("value_text"),
  valueTs: timestamp("value_ts", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ---------------------------------------------------------------------------
// SECTION 2: Users & Auth
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

  // Auth — two_fa_secret / two_fa_enabled dropped in migration 011
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

  // XP & Rank — bigint (8-byte) so heavy users never overflow int32 (~2.1 B cap)
  xpTotal: bigint("xp_total", { mode: "number" }).notNull().default(0),
  legacyScore: bigint("legacy_score", { mode: "number" }).notNull().default(0),
  rankName: text("rank_name").notNull().default("Beginner"),
  rankLevel: integer("rank_level").notNull().default(1),
  rankSublevel: integer("rank_sublevel").notNull().default(1),
  prestigeCount: integer("prestige_count").notNull().default(0),
  prestigeCycleBoostExpiresAt: timestamp("prestige_cycle_boost_expires_at", {
    withTimezone: true,
  }),
  customCrest: text("custom_crest"),

  // Track XP — bigint to match xp_total
  xpSocial: bigint("xp_social", { mode: "number" }).notNull().default(0),
  xpCreator: bigint("xp_creator", { mode: "number" }).notNull().default(0),
  xpCompetitor: bigint("xp_competitor", { mode: "number" }).notNull().default(0),
  xpGenerosity: bigint("xp_generosity", { mode: "number" }).notNull().default(0),
  xpKnowledge: bigint("xp_knowledge", { mode: "number" }).notNull().default(0),
  xpExplorer: bigint("xp_explorer", { mode: "number" }).notNull().default(0),
  xpGaming: bigint("xp_gaming", { mode: "number" }).notNull().default(0),

  // Track Levels
  levelSocial: integer("level_social").notNull().default(1),
  levelCreator: integer("level_creator").notNull().default(1),
  levelCompetitor: integer("level_competitor").notNull().default(1),
  levelGenerosity: integer("level_generosity").notNull().default(1),
  levelKnowledge: integer("level_knowledge").notNull().default(1),
  levelExplorer: integer("level_explorer").notNull().default(1),
  levelGaming: integer("level_gaming").notNull().default(1),

  // Economy
  coinBalance: bigint("coin_balance", { mode: "number" }).notNull().default(0),
  starBalance: bigint("star_balance", { mode: "number" }).notNull().default(0),
  availableEarningsKobo: bigint("available_earnings_kobo", {
    mode: "bigint",
  })
    .notNull()
    .default(BigInt(0)),
  payoutRecipientCode: text("payout_recipient_code"),
  payoutAccountLast4: text("payout_account_last4"),

  // Streaks
  loginStreak: integer("login_streak").notNull().default(0),
  longestStreak: integer("longest_streak").notNull().default(0),
  lastStreakBeforeBreak: integer("last_streak_before_break")
    .notNull()
    .default(0),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  lastLoginDate: date("last_login_date"),
  lastActiveAt: timestamp("last_active_at", {
    withTimezone: true,
  }).defaultNow(),

  // Guild (FK to guilds established at DB level to avoid circular dep)
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

  // Cosmetics (FK to store_items established at DB level)
  activeCosmeticFrameId: uuid("active_cosmetic_frame_id"),
  activeCosmeticTitle: text("active_cosmetic_title"),
  hdSendEnabled: boolean("hd_send_enabled").notNull().default(false),

  // Push & notification preferences
  pushToken: text("push_token"),
  dmNotifications: boolean("dm_notifications").default(true),
  groupNotifications: boolean("group_notifications").notNull().default(true),
  roomMentionNotifications: boolean("room_mention_notifications").notNull().default(true),
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

  // Admin nudges (migration 001)
  nudgeEmailShownAt: timestamp("nudge_email_shown_at", { withTimezone: true }),
  nudgeEmailDismissedAt: timestamp("nudge_email_dismissed_at", {
    withTimezone: true,
  }),

  // Auth session state (migration 010)
  preAuthSession: text("pre_auth_session"),

  // Misc
  firstGiftReceivedXpAwarded: boolean("first_gift_received_xp_awarded").default(false),
  pidginSuggestionsEnabled: boolean("pidgin_suggestions_enabled"),
  avatarUrl: text("avatar_url"),
  profilePrivate: boolean("profile_private").notNull().default(false),
  profileHiddenSections: jsonb("profile_hidden_sections")
    .notNull()
    .default(sql`'[]'::jsonb`),
  disableFriendRequests: boolean("disable_friend_requests")
    .notNull()
    .default(false),

  // Moderation / plan / 2FA-setup state (admin + moderation tools)
  warningCount: integer("warning_count").notNull().default(0),
  bannedAt: timestamp("banned_at", { withTimezone: true }),
  bannedBy: uuid("banned_by"),
  seasonXp: bigint("season_xp", { mode: "number" }).notNull().default(0),
  planActivatedAt: timestamp("plan_activated_at", { withTimezone: true }),
  require2faSetup: boolean("require_2fa_setup").notNull().default(false),

  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
}, (t) => [
  // BUG-SCHEMA-02: Cap wallet balances below JS Number.MAX_SAFE_INTEGER (2^53).
  check("users_coin_balance_max", sql`${t.coinBalance} <= 1000000000000`),
  check("users_star_balance_max", sql`${t.starBalance} <= 1000000000000`),
]);

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

export const userPins = pgTable("user_pins", {
  id: uuidPk(),
  userId: uuid("user_id")
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: "cascade" }),
  pinHash: text("pin_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const passwordResetTokens = pgTable("password_reset_tokens", {
  id: uuidPk(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Migration 011 (db): changed unique from (user_id, platform) -> (user_id, token),
// added last_seen_at.
export const userPushTokens = pgTable(
  "user_push_tokens",
  {
    id: uuidPk(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    token: text("token").notNull(),
    platform: text("platform").notNull().default("android"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    userTokenIdx: uniqueIndex("user_push_tokens_user_token_idx").on(
      t.userId,
      t.token
    ),
  })
);

// PUSH-RECEIPT-01: Two-stage push notification delivery tracking.
// Stage 1: sendExpoBatch saves ticket IDs here after a successful push send.
// Stage 2: pollPushReceipts (CRON) polls /v2/push/getReceipts for these tickets.
export const pushTickets = pgTable(
  "push_tickets",
  {
    id: uuidPk(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    ticketId: text("ticket_id").notNull().unique(),
    token: text("token"),
    status: text("status").notNull().default("pending"),
    receiptId: text("receipt_id"),
    errorCode: text("error_code"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    checkedAt: timestamp("checked_at", { withTimezone: true }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => ({
    pendingIdx: index("idx_push_tickets_pending")
      .on(t.createdAt)
      .where(sql`${t.status} = 'pending'`),
  })
);

export const userBlocks = pgTable(
  "user_blocks",
  {
    id: uuidPk(),
    blockerId: uuid("blocker_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    blockedId: uuid("blocked_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    unique: uniqueIndex("user_blocks_blocker_blocked_idx").on(
      t.blockerId,
      t.blockedId
    ),
  })
);

export const userEmailPreferences = pgTable(
  "user_email_preferences",
  {
    id: uuidPk(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    notificationType: text("notification_type").notNull(),
    isEnabled: boolean("is_enabled").notNull().default(true),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    unique: uniqueIndex("user_email_prefs_user_type_idx").on(
      t.userId,
      t.notificationType
    ),
  })
);

export const dataExportRequests = pgTable("data_export_requests", {
  id: uuidPk(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("pending"),
  downloadUrl: text("download_url"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

export const telegramLoginStates = pgTable("telegram_login_states", {
  state: text("state").primaryKey(),
  status: text("status").notNull().default("pending"),
  token: text("token"),
  userPayload: text("user_payload"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ---------------------------------------------------------------------------
// SECTION 3: Social Graph & Messaging
// ---------------------------------------------------------------------------

export const friendships = pgTable(
  "friendships",
  {
    id: uuidPk(),
    requesterId: uuid("requester_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    addresseeId: uuid("addressee_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    unique: uniqueIndex("friendships_requester_addressee_idx").on(
      t.requesterId,
      t.addresseeId
    ),
  })
);

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

export const dmConversations = pgTable(
  "dm_conversations",
  {
    id: uuidPk(),
    userId1: uuid("user_id_1")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    userId2: uuid("user_id_2")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    conversationScore: integer("conversation_score").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    unique: uniqueIndex("dm_conversations_users_idx").on(t.userId1, t.userId2),
  })
);

export const messages = pgTable("messages", {
  id: uuidPk(),
  senderId: uuid("sender_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  recipientId: uuid("recipient_id").references(() => users.id, {
    onDelete: "set null",
  }),
  conversationId: uuid("conversation_id").references(
    () => dmConversations.id,
    { onDelete: "set null" }
  ),
  groupChatId: uuid("group_chat_id").references(() => groupChats.id, {
    onDelete: "cascade",
  }),
  messageType: text("message_type").notNull().default("text"),
  content: text("content"),
  mediaUrl: text("media_url"),
  metadata: jsonb("metadata"),
  coinCost: bigint("coin_cost", { mode: "number" }).default(0),
  replyCountFromRecipient: integer("reply_count_from_recipient").default(0),
  idempotencyKey: text("idempotency_key"),
  isRead: boolean("is_read").notNull().default(false),
  isDeleted: boolean("is_deleted").default(false),
  isFlagged: boolean("is_flagged").default(false),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  deletedBy: uuid("deleted_by"),
  senderPlanAtCreation: text("sender_plan_at_creation").default("free"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const dmConversationUnlocks = pgTable(
  "dm_conversation_unlocks",
  {
    id: uuidPk(),
    conversationKey: text("conversation_key").notNull().unique(),
    initiatorId: uuid("initiator_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    recipientId: uuid("recipient_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    replyCount: integer("reply_count").notNull().default(0),
    unlocked: boolean("unlocked").default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  }
);

export const conversationScores = pgTable(
  "conversation_scores",
  {
    userId1: uuid("user_id_1")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    userId2: uuid("user_id_2")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    score: integer("score").notNull().default(0),
    streakDays: integer("streak_days").notNull().default(0),
    lastMessageDate: date("last_message_date"),
    hasConnectionBadge: boolean("has_connection_badge").notNull().default(false),
    badgeUnlockedAt: timestamp("badge_unlocked_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId1, t.userId2] }),
  })
);

export const dmConversationScoreMilestones = pgTable(
  "dm_conversation_score_milestones",
  {
    id: uuidPk(),
    userIdA: uuid("user_id_a")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    userIdB: uuid("user_id_b")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    milestoneScore: integer("milestone_score").notNull(),
    awardedAt: timestamp("awarded_at", { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    unique: uniqueIndex("dm_score_milestones_users_score_idx").on(
      t.userIdA,
      t.userIdB,
      t.milestoneScore
    ),
  })
);

export const dmScoreStickerUnlocks = pgTable(
  "dm_score_sticker_unlocks",
  {
    id: uuidPk(),
    userId1: uuid("user_id_1")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    userId2: uuid("user_id_2")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    packName: text("pack_name").notNull(),
    unlockedAt: timestamp("unlocked_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    unique: uniqueIndex("dm_sticker_unlocks_users_pack_idx").on(
      t.userId1,
      t.userId2,
      t.packName
    ),
  })
);

export const groupChats = pgTable("group_chats", {
  id: uuidPk(),
  name: text("name").notNull(),
  creatorId: uuid("creator_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  avatarEmoji: text("avatar_emoji").default("👥"),
  tag: text("tag"),
  memberCount: integer("member_count").notNull().default(1),
  maxMembers: integer("max_members").notNull().default(300),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const groupChatMembers = pgTable(
  "group_chat_members",
  {
    id: uuidPk(),
    groupChatId: uuid("group_chat_id")
      .notNull()
      .references(() => groupChats.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("member"),
    joinedAt: timestamp("joined_at", { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    unique: uniqueIndex("group_chat_members_group_user_idx").on(
      t.groupChatId,
      t.userId
    ),
  })
);

export const notifications = pgTable(
  "notifications",
  {
    id: uuidPk(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    payload: jsonb("payload"),
    title: text("title"),
    body: text("body"),
    metadata: jsonb("metadata"),
    isRead: boolean("is_read").notNull().default(false),
    // FIX-C03: reference_id enables ON CONFLICT dedup for event notifications
    referenceId: text("reference_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    userTypeRefIdx: uniqueIndex("uidx_notifications_user_type_ref")
      .on(t.userId, t.type, t.referenceId)
      .where(sql`reference_id IS NOT NULL`),
  })
);

export const userMessages = pgTable("user_messages", {
  id: uuidPk(),
  senderId: uuid("sender_id").references(() => users.id, {
    onDelete: "set null",
  }),
  recipientId: uuid("recipient_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  messageType: text("message_type").notNull().default("direct"),
  referenceId: uuid("reference_id"),
  isRead: boolean("is_read").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const userInactivityEvents = pgTable("user_inactivity_events", {
  id: uuidPk(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  inactiveDays: integer("inactive_days").notNull(),
  notified: boolean("notified").notNull().default(false),
  // Migration 009 (db): per-channel notification flags
  pushEmailNotified: boolean("push_email_notified").notNull().default(false),
  telegramNotified: boolean("telegram_notified").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const moments = pgTable("moments", {
  id: uuidPk(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  contentType: text("content_type").notNull().default("text"),
  mediaUrl: text("media_url"),
  thumbnailUrl: text("thumbnail_url"),
  caption: text("caption"),
  viewCount: integer("view_count").notNull().default(0),
  reactionsCount: integer("reactions_count").notNull().default(0),
  expiresAt: timestamp("expires_at", { withTimezone: true })
    .notNull()
    .default(sql`NOW() + INTERVAL '24 hours'`),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const momentViews = pgTable(
  "moment_views",
  {
    id: uuidPk(),
    momentId: uuid("moment_id")
      .notNull()
      .references(() => moments.id, { onDelete: "cascade" }),
    viewerId: uuid("viewer_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    viewedAt: timestamp("viewed_at", { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    unique: uniqueIndex("moment_views_moment_viewer_idx").on(
      t.momentId,
      t.viewerId
    ),
  })
);

export const momentReactions = pgTable(
  "moment_reactions",
  {
    id: uuidPk(),
    momentId: uuid("moment_id")
      .notNull()
      .references(() => moments.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    emoji: text("emoji").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    unique: uniqueIndex("moment_reactions_moment_user_idx").on(
      t.momentId,
      t.userId
    ),
  })
);

// ---------------------------------------------------------------------------
// SECTION 4: Guilds
// ---------------------------------------------------------------------------

export const guilds = pgTable("guilds", {
  id: uuidPk(),
  name: text("name").notNull().unique(),
  crestEmoji: text("crest_emoji").notNull().default("🛡️"),
  description: text("description"),
  city: text("city"),
  country: text("country").default("NG"),
  // captain_id is the guild leader (NOT creator_id)
  captainId: uuid("captain_id")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  tier: text("tier").notNull().default("bronze_1"),
  guildXp: bigint("guild_xp", { mode: "number" }).notNull().default(0),
  memberCount: integer("member_count").notNull().default(1),
  treasuryBalance: bigint("treasury_balance", { mode: "number" })
    .notNull()
    .default(0),
  treasuryCap: bigint("treasury_cap", { mode: "number" })
    .notNull()
    .default(50000),
  recruitmentType: text("recruitment_type").notNull().default("open"),
  warsWon: integer("wars_won").notNull().default(0),
  warsLost: integer("wars_lost").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  lastWarEndedAt: timestamp("last_war_ended_at", { withTimezone: true }),
  belowMinSince: timestamp("below_min_since", { withTimezone: true }),
  belowMinimumDays: integer("below_minimum_days").notNull().default(0),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
}, (t) => [
  // BUG-SCHEMA-02: Cap guild treasury below JS Number.MAX_SAFE_INTEGER (2^53).
  check("guilds_treasury_balance_max", sql`${t.treasuryBalance} <= 1000000000000`),
  check("guilds_treasury_cap_max", sql`${t.treasuryCap} <= 1000000000000`),
]);

export const guildMembers = pgTable(
  "guild_members",
  {
    id: uuidPk(),
    guildId: uuid("guild_id")
      .notNull()
      .references(() => guilds.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("member"),
    contributionScore: integer("contribution_score").notNull().default(0),
    warPointsTotal: integer("war_points_total").notNull().default(0),
    contributionBelowAverageWeeks: integer(
      "contribution_below_average_weeks"
    )
      .notNull()
      .default(0),
    joinedAt: timestamp("joined_at", { withTimezone: true }).defaultNow(),
    // FIX-C01: soft-delete column so WHERE left_at IS NULL filters active members
    leftAt: timestamp("left_at", { withTimezone: true }),
  },
  (t) => ({
    unique: uniqueIndex("guild_members_guild_user_idx").on(t.guildId, t.userId),
  })
);

export const guildWars = pgTable("guild_wars", {
  id: uuidPk(),
  challengerGuildId: uuid("challenger_guild_id")
    .notNull()
    .references(() => guilds.id, { onDelete: "cascade" }),
  defenderGuildId: uuid("defender_guild_id")
    .notNull()
    .references(() => guilds.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("active"),
  challengerPoints: bigint("challenger_points", { mode: "number" })
    .notNull()
    .default(0),
  defenderPoints: bigint("defender_points", { mode: "number" })
    .notNull()
    .default(0),
  winnerGuildId: uuid("winner_guild_id").references(() => guilds.id),
  startsAt: timestamp("starts_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  finalHourStartsAt: timestamp("final_hour_starts_at", {
    withTimezone: true,
  }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const warContributions = pgTable(
  "war_contributions",
  {
    id: uuidPk(),
    warId: uuid("war_id")
      .notNull()
      .references(() => guildWars.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    guildId: uuid("guild_id")
      .notNull()
      .references(() => guilds.id, { onDelete: "cascade" }),
    warPoints: integer("war_points").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    unique: uniqueIndex("war_contributions_war_user_idx").on(t.warId, t.userId),
  })
);
// Backward-compat alias
export const guildWarMembers = warContributions;

export const guildQuests = pgTable(
  "guild_quests",
  {
    id: uuidPk(),
    guildId: uuid("guild_id")
      .notNull()
      .references(() => guilds.id, { onDelete: "cascade" }),
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
    // Migration 010 (db): added is_active for soft-expiry
    isActive: boolean("is_active").notNull().default(true),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    // BUG-DB-01: Prevents duplicate weekly quests of the same type for a guild.
    guildQuestWeekUnique: uniqueIndex("guild_quests_guild_type_week_idx").on(
      t.guildId,
      t.questType,
      t.weekStart
    ),
  })
);

export const guildQuestContributions = pgTable("guild_quest_contributions", {
  id: uuidPk(),
  questId: uuid("quest_id")
    .notNull()
    .references(() => guildQuests.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  amount: integer("amount").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const guildWarRematchTokens = pgTable("guild_war_rematch_tokens", {
  id: uuidPk(),
  guildId: uuid("guild_id")
    .notNull()
    .references(() => guilds.id, { onDelete: "cascade" }),
  warId: uuid("war_id")
    .notNull()
    .references(() => guildWars.id, { onDelete: "cascade" }),
  discountPercent: integer("discount_percent").notNull().default(50),
  isUsed: boolean("is_used").default(false),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const guildApplications = pgTable(
  "guild_applications",
  {
    id: uuidPk(),
    guildId: uuid("guild_id")
      .notNull()
      .references(() => guilds.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewedBy: uuid("reviewed_by").references(() => users.id, {
      onDelete: "set null",
    }),
  },
  (t) => ({
    unique: uniqueIndex("guild_applications_guild_user_idx").on(
      t.guildId,
      t.userId
    ),
  })
);

export const guildInvites = pgTable("guild_invites", {
  id: uuidPk(),
  guildId: uuid("guild_id")
    .notNull()
    .references(() => guilds.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  invitedUserId: uuid("invited_user_id").references(() => users.id, {
    onDelete: "cascade",
  }),
  createdBy: uuid("created_by")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  usedByUserId: uuid("used_by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const guildTreasuryLedger = pgTable("guild_treasury_ledger", {
  id: uuidPk(),
  guildId: uuid("guild_id")
    .notNull()
    .references(() => guilds.id, { onDelete: "cascade" }),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  amount: bigint("amount", { mode: "number" }).notNull(),
  balanceBefore: bigint("balance_before", { mode: "number" }).notNull(),
  balanceAfter: bigint("balance_after", { mode: "number" }).notNull(),
  transactionType: text("transaction_type").notNull(),
  description: text("description"),
  referenceId: text("reference_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const guildTierHistory = pgTable(
  "guild_tier_history",
  {
    id: uuidPk(),
    guildId: uuid("guild_id")
      .notNull()
      .references(() => guilds.id, { onDelete: "cascade" }),
    fromTier: text("from_tier").notNull(),
    toTier: text("to_tier").notNull(),
    guildXpAt: bigint("guild_xp_at", { mode: "number" }).notNull(),
    changedAt: timestamp("changed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // FIX-H07: tie history rows to wars so ON CONFLICT (guild_id, war_id) prevents duplicates
    warId: uuid("war_id").references(() => guildWars.id, { onDelete: "set null" }),
  },
  (t) => ({
    // BUG-DB-02a: one tier-history row per guild per war (war-triggered changes)
    guildWarIdx: uniqueIndex("uidx_guild_tier_history_guild_war")
      .on(t.guildId, t.warId)
      .where(sql`war_id IS NOT NULL`),
    // BUG-DB-02b: one tier-history row per guild per timestamp (non-war XP changes)
    guildChangedAtIdx: uniqueIndex("uidx_guild_tier_history_guild_changed_at")
      .on(t.guildId, t.changedAt)
      .where(sql`war_id IS NULL`),
  })
);

export const guildAlliances = pgTable("guild_alliances", {
  id: uuidPk(),
  name: text("name").notNull().unique(),
  description: text("description"),
  foundedBy: uuid("founded_by")
    .notNull()
    .references(() => guilds.id, { onDelete: "restrict" }),
  isActive: boolean("is_active").default(true),
  warsWon: integer("wars_won").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const guildAllianceMembers = pgTable(
  "guild_alliance_members",
  {
    id: uuidPk(),
    allianceId: uuid("alliance_id")
      .notNull()
      .references(() => guildAlliances.id, { onDelete: "cascade" }),
    guildId: uuid("guild_id")
      .notNull()
      .references(() => guilds.id, { onDelete: "cascade" }),
    joinedAt: timestamp("joined_at", { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    unique: uniqueIndex("guild_alliance_members_alliance_guild_idx").on(
      t.allianceId,
      t.guildId
    ),
  })
);

export const allianceWars = pgTable(
  "alliance_wars",
  {
    id: uuidPk(),
    alliance1Id: uuid("alliance_1_id")
      .notNull()
      .references(() => guildAlliances.id, { onDelete: "cascade" }),
    alliance2Id: uuid("alliance_2_id")
      .notNull()
      .references(() => guildAlliances.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("active"),
    winnerAllianceId: uuid("winner_alliance_id").references(
      () => guildAlliances.id,
      { onDelete: "set null" }
    ),
    alliance1Xp: bigint("alliance_1_xp", { mode: "number" }).notNull().default(0),
    alliance2Xp: bigint("alliance_2_xp", { mode: "number" }).notNull().default(0),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
  },
  (t) => ({
    // CRON-ALLIANCE-01: only one active war between any two alliances at a time.
    // The CRON's ON CONFLICT DO NOTHING relies on this unique constraint.
    activeWarIdx: uniqueIndex("uidx_alliance_wars_active_pair")
      .on(t.alliance1Id, t.alliance2Id)
      .where(sql`status = 'active'`),
  })
);

export const guildContributionAlerts = pgTable(
  "guild_contribution_alerts",
  {
    id: uuidPk(),
    guildId: uuid("guild_id")
      .notNull()
      .references(() => guilds.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    weeksBelow: integer("weeks_below").notNull().default(1),
    alertedAt: timestamp("alerted_at", { withTimezone: true }).defaultNow(),
    resolved: boolean("resolved").default(false),
  },
  (t) => ({
    unique: uniqueIndex("guild_contribution_alerts_guild_user_idx").on(
      t.guildId,
      t.userId
    ),
  })
);

export const guildMessages = pgTable("guild_messages", {
  id: uuidPk(),
  guildId: uuid("guild_id")
    .notNull()
    .references(() => guilds.id, { onDelete: "cascade" }),
  senderId: uuid("sender_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  type: text("type").notNull().default("text"),
  stickerId: text("sticker_id"),
  gifUrl: text("gif_url"),
  isDeleted: boolean("is_deleted").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ---------------------------------------------------------------------------
// SECTION 5: Rooms
// ---------------------------------------------------------------------------

export const rooms = pgTable("rooms", {
  id: uuidPk(),
  creatorId: uuid("creator_id")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  name: text("name").notNull(),
  // Public-facing, SEO-friendly, mutable unique alias (e.g. "dorcas-cuisine").
  // Unique among live rooms via a partial index (rooms_slug_unique_idx); the
  // UUID `id` stays the immutable internal reference. Generated server-side
  // from `name` via lib/slug.ts (slugify + numeric dedupe suffix).
  slug: text("slug"),
  description: text("description"),
  type: text("type").notNull().default("free_open"),
  category: text("category"),
  city: text("city"),
  coverImageUrl: text("cover_image_url"),
  coverEmoji: text("cover_emoji").notNull().default("💬"),

  // Access
  isPublic: boolean("is_public").default(true),
  maxMembers: integer("max_members"),
  memberCount: integer("member_count").notNull().default(0),

  // Pricing
  subscriptionPriceKobo: bigint("subscription_price_kobo", { mode: "number" }),
  entryFeeKobo: bigint("entry_fee_kobo", { mode: "number" }),
  subscriptionPriceNgn: bigint("subscription_price_ngn", { mode: "number" }),
  entryFeeNgn: bigint("entry_fee_ngn", { mode: "number" }),
  enrolmentFeeNgn: bigint("enrolment_fee_ngn", { mode: "number" }),

  // ClassRoom
  curriculum: jsonb("curriculum"),
  startsAt: timestamp("starts_at", { withTimezone: true }),
  endsAt: timestamp("ends_at", { withTimezone: true }),
  classStartDate: date("class_start_date"),
  classEndDate: date("class_end_date"),

  // Drop Room
  dropStartsAt: timestamp("drop_starts_at", { withTimezone: true }),
  dropEndsAt: timestamp("drop_ends_at", { withTimezone: true }),

  // Limited Room (migration 002)
  durationMinutes: integer("duration_minutes"),

  // Guild
  guildId: uuid("guild_id").references(() => guilds.id, {
    onDelete: "set null",
  }),

  // Stats
  totalMessages: integer("total_messages").notNull().default(0),
  healthScore: integer("health_score").default(100),

  // Spotlight & moderation
  spotlightUntil: timestamp("spotlight_until", { withTimezone: true }),
  spotlightBy: uuid("spotlight_by").references(() => users.id, {
    onDelete: "set null",
  }),
  moderationRules: jsonb("moderation_rules"),
  spectacleThresholdCoins: integer("spectacle_threshold_coins"),

  // Ad revenue
  isAdEnrolled: boolean("is_ad_enrolled").notNull().default(false),

  // Flags
  isActive: boolean("is_active").default(true),
  isFeatured: boolean("is_featured").default(false),
  isSponsored: boolean("is_sponsored").default(false),
  sponsoredBy: text("sponsored_by"),
  status: text("status").notNull().default("active"),
  metadata: jsonb("metadata"),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),

  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
}, (t) => [
  check("rooms_public_requires_slug", sql`NOT (${t.isPublic} = TRUE AND ${t.slug} IS NULL)`),
  // BUG-SCHEMA-02: Cap room pricing columns below JS Number.MAX_SAFE_INTEGER (2^53).
  check("rooms_subscription_price_kobo_max", sql`${t.subscriptionPriceKobo} IS NULL OR ${t.subscriptionPriceKobo} <= 1000000000000`),
  check("rooms_entry_fee_kobo_max", sql`${t.entryFeeKobo} IS NULL OR ${t.entryFeeKobo} <= 1000000000000`),
  check("rooms_subscription_price_ngn_max", sql`${t.subscriptionPriceNgn} IS NULL OR ${t.subscriptionPriceNgn} <= 1000000000000`),
  check("rooms_entry_fee_ngn_max", sql`${t.entryFeeNgn} IS NULL OR ${t.entryFeeNgn} <= 1000000000000`),
  check("rooms_enrolment_fee_ngn_max", sql`${t.enrolmentFeeNgn} IS NULL OR ${t.enrolmentFeeNgn} <= 1000000000000`),
]);

export const roomMembers = pgTable(
  "room_members",
  {
    id: uuidPk(),
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
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    unique: uniqueIndex("room_members_room_user_idx").on(t.roomId, t.userId),
  })
);

export const roomMessages = pgTable("room_messages", {
  id: uuidPk(),
  senderId: uuid("sender_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  roomId: uuid("room_id").references(() => rooms.id, { onDelete: "cascade" }),
  groupChatId: uuid("group_chat_id").references(() => groupChats.id, {
    onDelete: "cascade",
  }),
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
  pinnedBy: uuid("pinned_by").references(() => users.id, {
    onDelete: "set null",
  }),
  pinExpiresAt: timestamp("pin_expires_at", { withTimezone: true }),
  // Migration 003 (db): reply threading
  replyToMessageId: uuid("reply_to_message_id"),
  isPendingApproval: boolean("is_pending_approval").notNull().default(false),
  // OFFLINE-IDEMP-GAP: lets offline-queued sends (Expo sync queue / PWA) be
  // safely retried without creating duplicate messages on reconnect.
  idempotencyKey: text("idempotency_key"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const messageReactions = pgTable(
  "message_reactions",
  {
    id: uuidPk(),
    messageId: uuid("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    emoji: text("emoji").notNull(),
    isCustom: boolean("is_custom").default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    unique: uniqueIndex("message_reactions_msg_user_emoji_idx").on(
      t.messageId,
      t.userId,
      t.emoji
    ),
  })
);

export const roomMessageReactions = pgTable(
  "room_message_reactions",
  {
    id: uuidPk(),
    messageId: uuid("message_id")
      .notNull()
      .references(() => roomMessages.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    roomId: uuid("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    emoji: text("emoji").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    unique: uniqueIndex("room_msg_reactions_msg_user_emoji_idx").on(
      t.messageId,
      t.userId,
      t.emoji
    ),
  })
);

export const roomMemberHighlights = pgTable(
  "room_member_highlights",
  {
    id: uuidPk(),
    roomId: uuid("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    highlightedBy: uuid("highlighted_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    unique: uniqueIndex("room_member_highlights_room_user_idx").on(
      t.roomId,
      t.userId
    ),
  })
);

export const roomModerationLog = pgTable("room_moderation_log", {
  id: uuidPk(),
  roomId: uuid("room_id")
    .notNull()
    .references(() => rooms.id, { onDelete: "cascade" }),
  moderatorId: uuid("moderator_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  targetUserId: uuid("target_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  action: text("action").notNull(),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const roomSubscriptions = pgTable(
  "room_subscriptions",
  {
    id: uuidPk(),
    roomId: uuid("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("active"),
    amountKobo: bigint("amount_kobo", { mode: "number" }),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    unique: uniqueIndex("room_subscriptions_room_user_idx").on(
      t.roomId,
      t.userId
    ),
  })
);

export const roomPromotions = pgTable("room_promotions", {
  id: uuidPk(),
  roomId: uuid("room_id")
    .notNull()
    .unique()
    .references(() => rooms.id, { onDelete: "cascade" }),
  creatorId: uuid("creator_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  promotedBy: uuid("promoted_by").references(() => users.id, {
    onDelete: "set null",
  }),
  coinCost: integer("coin_cost").notNull().default(0),
  startsAt: timestamp("starts_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  isActive: boolean("is_active").notNull().default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const roomMonthlyActiveUsers = pgTable(
  "room_monthly_active_users",
  {
    id: uuidPk(),
    roomId: uuid("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    month: date("month").notNull(),
    mauCount: integer("mau_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    unique: uniqueIndex("room_mau_room_month_idx").on(t.roomId, t.month),
  })
);

export const roomPins = pgTable(
  "room_pins",
  {
    id: uuidPk(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    roomId: uuid("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    unique: uniqueIndex("room_pins_user_room_idx").on(t.userId, t.roomId),
  })
);

export const guildRooms = pgTable(
  "guild_rooms",
  {
    id: uuidPk(),
    guildId: uuid("guild_id")
      .notNull()
      .references(() => guilds.id, { onDelete: "cascade" }),
    roomId: uuid("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    unique: uniqueIndex("guild_rooms_guild_room_idx").on(t.guildId, t.roomId),
  })
);

export const dropRoomReplays = pgTable("drop_room_replays", {
  id: uuidPk(),
  roomId: uuid("room_id")
    .notNull()
    .unique()
    .references(() => rooms.id, { onDelete: "cascade" }),
  creatorId: uuid("creator_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  highlights: jsonb("highlights").notNull(),
  replayFeeKobo: bigint("replay_fee_kobo", { mode: "number" })
    .notNull()
    .default(0),
  isPublished: boolean("is_published").default(false),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const brandedRooms = pgTable("branded_rooms", {
  id: uuidPk(),
  roomId: uuid("room_id").references(() => rooms.id, { onDelete: "set null" }),
  brandName: text("brand_name").notNull(),
  brandLogoUrl: text("brand_logo_url"),
  sponsorBudgetCoins: integer("sponsor_budget_coins").notNull().default(0),
  joinBonusCoins: integer("join_bonus_coins").notNull().default(5),
  isActive: boolean("is_active").default(true),
  startsAt: timestamp("starts_at", { withTimezone: true }),
  endsAt: timestamp("ends_at", { withTimezone: true }),
  createdBy: uuid("created_by").references(() => users.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

// ---------------------------------------------------------------------------
// SECTION 6: Quests, Seasons & Progression
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

export const userQuests = pgTable(
  "user_quests",
  {
    id: uuidPk(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    questTemplateId: uuid("quest_template_id")
      .notNull()
      .references(() => questTemplates.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    progress: integer("progress").notNull().default(0),
    target: integer("target").notNull(),
    isCompleted: boolean("is_completed").default(false),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    xpReward: integer("xp_reward").notNull(),
    coinReward: integer("coin_reward").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    unique: uniqueIndex("user_quests_user_template_date_idx").on(
      t.userId,
      t.questTemplateId,
      t.date
    ),
  })
);

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

// Migration 006 (db): FK corrected to quest_templates in migration 011 (db)
export const userQuestDecks = pgTable(
  "user_quest_decks",
  {
    id: uuidPk(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    questId: uuid("quest_id")
      .notNull()
      .references(() => questTemplates.id, { onDelete: "cascade" }),
    assignedDate: date("assigned_date").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
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

export const seasons = pgTable("seasons", {
  id: uuidPk(),
  name: text("name").notNull(),
  theme: text("theme"),
  description: text("description"),
  seasonNumber: integer("season_number").notNull(),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  passPriceCoins: integer("pass_price_coins").notNull().default(500),
  rewardPoolCoins: integer("reward_pool_coins").notNull().default(0),
  isActive: boolean("is_active").default(false),
  createdBy: uuid("created_by").references(() => users.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  // Migration 012 (db): added updated_at
  updatedAt: timestamp("updated_at", { withTimezone: true }),
});

export const userSeasonPasses = pgTable(
  "user_season_passes",
  {
    id: uuidPk(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    seasonId: uuid("season_id")
      .notNull()
      .references(() => seasons.id, { onDelete: "cascade" }),
    isPaid: boolean("is_paid").notNull().default(false),
    seasonXp: bigint("season_xp", { mode: "number" }).notNull().default(0),
    seasonRank: integer("season_rank"),
    purchasedAt: timestamp("purchased_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    unique: uniqueIndex("user_season_passes_user_season_idx").on(
      t.userId,
      t.seasonId
    ),
  })
);

export const seasonPassMilestones = pgTable(
  "season_pass_milestones",
  {
    id: uuidPk(),
    seasonId: uuid("season_id")
      .notNull()
      .references(() => seasons.id, { onDelete: "cascade" }),
    milestoneXp: integer("milestone_xp").notNull(),
    tier: text("tier").notNull().default("free"),
    rewardType: text("reward_type").notNull(),
    rewardValue: jsonb("reward_value").notNull().default(sql`'{}'::jsonb`),
    displayName: text("display_name").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    requiredPlan: text("required_plan"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    // FIX-H04: include tier so free and paid milestones can share sort_order values
    seasonTierSortIdx: uniqueIndex("season_pass_milestones_season_tier_sort_idx").on(
      t.seasonId,
      t.tier,
      t.sortOrder
    ),
  })
);

export const userSeasonMilestoneClaims = pgTable(
  "user_season_milestone_claims",
  {
    id: uuidPk(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    seasonId: uuid("season_id")
      .notNull()
      .references(() => seasons.id, { onDelete: "cascade" }),
    milestoneId: uuid("milestone_id")
      .notNull()
      .references(() => seasonPassMilestones.id, { onDelete: "cascade" }),
    claimedAt: timestamp("claimed_at", { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    unique: uniqueIndex("user_season_milestone_claims_unique").on(
      t.userId,
      t.seasonId,
      t.milestoneId
    ),
  })
);

export const seasonRankArchives = pgTable(
  "season_rank_archives",
  {
    id: uuidPk(),
    seasonId: uuid("season_id")
      .notNull()
      .references(() => seasons.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    finalRank: integer("final_rank"),
    finalSeasonXp: bigint("final_season_xp", { mode: "number" }).notNull().default(0),
    archivedAt: timestamp("archived_at", { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    unique: uniqueIndex("season_rank_archives_season_user_idx").on(
      t.seasonId,
      t.userId
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
    seasonId: uuid("season_id").references(() => seasons.id, {
      onDelete: "cascade",
    }),
    xpValue: bigint("xp_value", { mode: "number" }).notNull().default(0),
    rankPosition: integer("rank_position"),
    // Migration 004 (db): for rank-change notifications
    lastNotifiedRank: integer("last_notified_rank"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    // Migration 011 (db): COALESCE expression index for NULL-safe upserts
    upsertIdx: uniqueIndex("leaderboard_snapshots_upsert_idx").on(
      t.userId,
      t.track,
      t.scope,
      sql`COALESCE(${t.city}, '')`,
      sql`COALESCE(${t.seasonId}::text, '')`
    ),
  })
);

export const leaderboardRankSnapshots = pgTable(
  "leaderboard_rank_snapshots",
  {
    id: uuidPk(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    scope: text("scope").notNull().default("global"),
    rank: integer("rank").notNull(),
    xp: bigint("xp", { mode: "number" }).notNull().default(0),
    snappedAt: timestamp("snapped_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    unique: uniqueIndex("leaderboard_rank_snapshots_user_scope_idx").on(
      t.userId,
      t.scope
    ),
  })
);

export const nemesisAssignments = pgTable(
  "nemesis_assignments",
  {
    id: uuidPk(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    nemesisUserId: uuid("nemesis_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    nemesisId: uuid("nemesis_id").references(() => users.id, {
      onDelete: "set null",
    }),
    track: text("track").notNull().default("main"),
    assignedAt: timestamp("assigned_at", { withTimezone: true }).defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
    isActive: boolean("is_active").default(true),
    // CRON-NEMESIS-01: track when a user was last notified about their nemesis
    // overtaking them to prevent re-notification more than once per 6 days.
    lastNotifiedAt: timestamp("last_notified_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    unique: uniqueIndex("nemesis_assignments_user_track_active_idx").on(
      t.userId,
      t.track,
      t.isActive
    ),
  })
);

export const nemesisChallenges = pgTable("nemesis_challenges", {
  id: uuidPk(),
  challengerId: uuid("challenger_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  challengedId: uuid("challenged_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("pending"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const userBadges = pgTable(
  "user_badges",
  {
    id: uuidPk(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    badgeType: text("badge_type"),
    badgeKey: text("badge_key"),
    referenceId: text("reference_id"),
    metadata: jsonb("metadata"),
    awardedAt: timestamp("awarded_at", { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    // Partial unique: only when badge_key is present
    userBadgeKeyIdx: uniqueIndex("user_badges_user_badge_key_idx")
      .on(t.userId, t.badgeKey)
      .where(sql`badge_key IS NOT NULL`),
  })
);

export const userTitles = pgTable(
  "user_titles",
  {
    id: uuidPk(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    source: text("source"),
    isActive: boolean("is_active").notNull().default(false),
    awardedAt: timestamp("awarded_at", { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    unique: uniqueIndex("user_titles_user_title_idx").on(t.userId, t.title),
  })
);

export const trackMilestoneUnlocks = pgTable(
  "track_milestone_unlocks",
  {
    id: uuidPk(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    track: text("track").notNull(),
    milestoneLevel: integer("milestone_level").notNull(),
    unlockKey: text("unlock_key"),
    unlockedAt: timestamp("unlocked_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    unique: uniqueIndex("track_milestone_unlocks_user_track_level_idx").on(
      t.userId,
      t.track,
      t.milestoneLevel
    ),
  })
);

export const rankUpEvents = pgTable("rank_up_events", {
  id: uuidPk(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  rankFrom: text("rank_from").notNull(),
  rankTo: text("rank_to").notNull(),
  xpAtEvent: bigint("xp_at_event", { mode: "number" }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const xpEvents = pgTable("xp_events", {
  id: uuidPk(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  action: text("action").notNull(),
  xpAwarded: integer("xp_awarded").notNull(),
  track: text("track").notNull().default("main"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const hallOfFame = pgTable("hall_of_fame", {
  id: uuidPk(),
  userId: uuid("user_id")
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: "cascade" }),
  prestigeCount: integer("prestige_count").notNull(),
  legacyScore: bigint("legacy_score", { mode: "number" }).notNull().default(0),
  inductedAt: timestamp("inducted_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const newMemberQuests = pgTable(
  "new_member_quests",
  {
    id: uuidPk(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    questType: text("quest_type").notNull().default("new_member"),
    progress: jsonb("progress").notNull().default(sql`'{}'::jsonb`),
    completed: boolean("completed").notNull().default(false),
    rewardClaimed: boolean("reward_claimed").notNull().default(false),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    unique: uniqueIndex("new_member_quests_user_type_idx").on(
      t.userId,
      t.questType
    ),
  })
);

// ---------------------------------------------------------------------------
// SECTION 7: Economy
// ---------------------------------------------------------------------------

export const coinLedger = pgTable(
  "coin_ledger",
  {
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
  },
  (t) => ({
    // SYS-CL-ROOT: partial unique index supports ON CONFLICT dedup for
    // idempotent coin credits/debits. Must include user_id — without it,
    // two different users sharing the same (transaction_type, reference_id)
    // (e.g. a guild quest reward keyed only on questId) collide and the
    // second user's write is silently dropped.
    txTypeRefIdx: uniqueIndex("uidx_coin_ledger_tx_type_ref")
      .on(t.userId, t.transactionType, t.referenceId)
      .where(sql`reference_id IS NOT NULL`),
  })
);

export const starLedger = pgTable(
  "star_ledger",
  {
    id: uuidPk(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // SCHEMA-STAR-01: bigint to match the signed amount semantic (stars can be large)
    amount: bigint("amount", { mode: "number" }).notNull(),
    balanceBefore: bigint("balance_before", { mode: "number" })
      .notNull()
      .default(0),
    balanceAfter: bigint("balance_after", { mode: "number" })
      .notNull()
      .default(0),
    transactionType: text("transaction_type").notNull(),
    description: text("description"),
    referenceId: text("reference_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    // STAR-NOIDEM: partial unique index mirrors coin_ledger/xp_ledger so
    // star credits/debits support ON CONFLICT dedup for idempotent retries.
    txTypeRefIdx: uniqueIndex("uidx_star_ledger_tx_type_ref")
      .on(t.userId, t.transactionType, t.referenceId)
      .where(sql`reference_id IS NOT NULL`),
  })
);

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
    // Migration 007 (db): partial unique index to prevent duplicate XP awards
    sourceRefIdx: uniqueIndex("uidx_xp_ledger_source_ref")
      .on(t.userId, t.source, t.referenceId)
      .where(sql`reference_id IS NOT NULL`),
  })
);

export const payments = pgTable("payments", {
  id: uuidPk(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  // Migration 014 (db): added business_upgrade to payment_type CHECK
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
  referenceId: text("reference_id"),
  paymentUrl: text("payment_url"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

export const giftItems = pgTable("gift_items", {
  id: uuidPk(),
  name: text("name").notNull().unique(),
  emoji: text("emoji").notNull(),
  coinCost: integer("coin_cost").notNull().default(0),
  tier: integer("tier").notNull(),
  spectacleThresholdCoins: integer("spectacle_threshold_coins"),
  animationUrl: text("animation_url"),
  isLimitedEdition: boolean("is_limited_edition").default(false),
  seasonId: uuid("season_id").references(() => seasons.id, {
    onDelete: "set null",
  }),
  isRetired: boolean("is_retired").default(false),
  // Migration 009 (lib): added is_active
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

// Migration 011 (db): new gift_types catalogue (separate from legacy gift_items).
// Migration 0010 (sql): added gift_type_id FK to gifts and backfilled from gift_items.
// Phase 2 follow-up: once gift_type_id is fully populated, make it NOT NULL and drop gift_item_id.
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
  roomId: uuid("room_id").references(() => rooms.id, { onDelete: "set null" }),
  giftItemId: uuid("gift_item_id")
    .notNull()
    .references(() => giftItems.id, { onDelete: "restrict" }),
  giftTypeId: uuid("gift_type_id").references(() => giftTypes.id, {
    onDelete: "restrict",
  }),
  coinValue: integer("coin_value").notNull(),
  coinCost: integer("coin_cost").notNull(),
  animationUrl: text("animation_url"),
  messageId: uuid("message_id").references(() => messages.id, {
    onDelete: "set null",
  }),
  status: text("status").notNull().default("delivered"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const storeItems = pgTable("store_items", {
  id: uuidPk(),
  name: text("name").notNull().unique(),
  description: text("description"),
  itemType: text("item_type").notNull(),
  priceKobo: bigint("price_kobo", { mode: "number" }),
  currency: text("currency").notNull().default("NGN"),
  coinsCost: integer("coins_cost"),
  starsCost: integer("stars_cost"),
  coinsGranted: integer("coins_granted"),
  starsGranted: integer("stars_granted"),
  cosmeticType: text("cosmetic_type"),
  bonusLabel: text("bonus_label"),
  isFeatured: boolean("is_featured").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  isExclusive: boolean("is_exclusive").notNull().default(false),
  seasonId: uuid("season_id").references(() => seasons.id, {
    onDelete: "set null",
  }),
  prestigeRequired: integer("prestige_required"),
  validUntil: timestamp("valid_until", { withTimezone: true }),
  sortOrder: integer("sort_order").notNull().default(0),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const userCosmetics = pgTable(
  "user_cosmetics",
  {
    id: uuidPk(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    storeItemId: uuid("store_item_id")
      .notNull()
      .references(() => storeItems.id, { onDelete: "cascade" }),
    cosmeticType: text("cosmetic_type").notNull(),
    isActive: boolean("is_active").notNull().default(false),
    acquiredAt: timestamp("acquired_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    metadata: jsonb("metadata"),
  },
  (t) => ({
    unique: uniqueIndex("user_cosmetics_user_item_idx").on(
      t.userId,
      t.storeItemId
    ),
  })
);

export const userXpBoosters = pgTable("user_xp_boosters", {
  id: uuidPk(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  boosterType: text("booster_type"),
  multiplier: decimal("multiplier", { precision: 4, scale: 2 })
    .notNull()
    .default("2.0"),
  isActive: boolean("is_active").notNull().default(true),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const stickerPacks = pgTable("sticker_packs", {
  id: uuidPk(),
  name: text("name").notNull().unique(),
  description: text("description"),
  coverEmoji: text("cover_emoji").notNull().default("🎨"),
  coverStickerUrl: text("cover_sticker_url"),
  packType: text("pack_type").notNull().default("free"),
  coinPrice: integer("coin_price").notNull().default(0),
  unlockCondition: text("unlock_condition"),
  locale: text("locale"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const stickers = pgTable(
  "stickers",
  {
    id: uuidPk(),
    packId: uuid("pack_id")
      .notNull()
      .references(() => stickerPacks.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    emoji: text("emoji").notNull(),
    imageUrl: text("image_url"),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    unique: uniqueIndex("stickers_pack_name_idx").on(t.packId, t.name),
  })
);

export const userStickerPacks = pgTable(
  "user_sticker_packs",
  {
    id: uuidPk(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    packId: uuid("pack_id")
      .notNull()
      .references(() => stickerPacks.id, { onDelete: "cascade" }),
    acquiredAt: timestamp("acquired_at", { withTimezone: true }).defaultNow(),
    unlockedAt: timestamp("unlocked_at", { withTimezone: true }),
  },
  (t) => ({
    unique: uniqueIndex("user_sticker_packs_user_pack_idx").on(
      t.userId,
      t.packId
    ),
  })
);

export const reactionSets = pgTable("reaction_sets", {
  id: uuidPk(),
  name: text("name").notNull(),
  description: text("description"),
  coinPrice: integer("coin_price").notNull().default(100),
  previewEmoji: text("preview_emoji").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const reactionSetItems = pgTable("reaction_set_items", {
  id: uuidPk(),
  setId: uuid("set_id")
    .notNull()
    .references(() => reactionSets.id, { onDelete: "cascade" }),
  emoji: text("emoji").notNull(),
  name: text("name").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const userReactionSets = pgTable(
  "user_reaction_sets",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    setId: uuid("set_id")
      .notNull()
      .references(() => reactionSets.id, { onDelete: "cascade" }),
    purchasedAt: timestamp("purchased_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.setId] }),
  })
);

export const auditDiscrepancies = pgTable("audit_discrepancies", {
  id: uuidPk(),
  userId: uuid("user_id").notNull(),
  // Migration 012 (db): CHECK broadened to include 'xp'
  assetType: text("asset_type").notNull(),
  ledgerSum: bigint("ledger_sum", { mode: "number" }).notNull(),
  walletBalance: bigint("wallet_balance", { mode: "number" }).notNull(),
  detectedAt: timestamp("detected_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  resolved: boolean("resolved").notNull().default(false),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  notes: text("notes"),
});

export const failedXpAwards = pgTable("failed_xp_awards", {
  id: uuidPk(),
  userId: uuid("user_id").notNull(),
  amount: integer("amount").notNull(),
  track: text("track").notNull(),
  source: text("source").notNull(),
  referenceId: text("reference_id"),
  errorMessage: text("error_message"),
  failedAt: timestamp("failed_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  retryCount: integer("retry_count").notNull().default(0),
  lastRetriedAt: timestamp("last_retried_at", { withTimezone: true }),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
});

// ---------------------------------------------------------------------------
// SECTION 8: Creator Economy
// ---------------------------------------------------------------------------

export const creatorEarnings = pgTable("creator_earnings", {
  id: uuidPk(),
  creatorId: uuid("creator_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  sourceType: text("source_type").notNull(),
  grossAmountKobo: bigint("gross_amount_kobo", { mode: "bigint" })
    .notNull()
    .default(BigInt(0)),
  platformFeeKobo: bigint("platform_fee_kobo", { mode: "bigint" })
    .notNull()
    .default(BigInt(0)),
  netAmountKobo: bigint("net_amount_kobo", { mode: "bigint" })
    .notNull()
    .default(BigInt(0)),
  referenceId: text("reference_id"),
  paidOut: boolean("paid_out").default(false),
  payoutId: uuid("payout_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const creatorPayouts = pgTable(
  "creator_payouts",
  {
  id: uuidPk(),
  creatorId: uuid("creator_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  amountKobo: bigint("amount_kobo", { mode: "bigint" }).notNull(),
  grossKobo: bigint("gross_kobo", { mode: "bigint" }),
  netKobo: bigint("net_kobo", { mode: "bigint" }),
  platformFeeKobo: bigint("platform_fee_kobo", { mode: "bigint" }),
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
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  rejectedAt: timestamp("rejected_at", { withTimezone: true }),
  rejectionReason: text("rejection_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => ({
    // DB-INDEX-01: partial index for efficient retry queue scans
    retryIdx: index("idx_creator_payouts_retry")
      .on(t.nextRetryAt)
      .where(sql`status IN ('pending', 'processing')`),
  })
);

export const creatorBankAccounts = pgTable(
  "creator_bank_accounts",
  {
    id: uuidPk(),
    // SCHEMA-BANK-01: removed .unique() — a creator can have multiple bank accounts;
    // uniqueness is enforced on (creator_id) WHERE is_primary = TRUE AND deleted_at IS NULL.
    creatorId: uuid("creator_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    bankName: text("bank_name").notNull(),
    bankCode: text("bank_code").notNull(),
    accountNumber: text("account_number").notNull(),
    accountName: text("account_name").notNull(),
    accountNumberLast4: text("account_number_last4").notNull(),
    recipientCode: text("recipient_code"),
    isPrimary: boolean("is_primary").notNull().default(false),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    xpAwarded: boolean("xp_awarded").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    // Only one primary account per creator at a time (soft-delete safe)
    primaryAccountIdx: uniqueIndex("uidx_creator_bank_accounts_primary")
      .on(t.creatorId)
      .where(sql`is_primary = TRUE AND deleted_at IS NULL`),
  })
);

export const creatorWalletAddresses = pgTable("creator_wallet_addresses", {
  id: uuidPk(),
  creatorId: uuid("creator_id")
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: "cascade" }),
  network: text("network").notNull().default("tron"),
  currency: text("currency").notNull().default("USDT"),
  address: text("address").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const payoutDeadLetterQueue = pgTable("payout_dead_letter_queue", {
  id: uuidPk(),
  // FIX-C02: unique constraint so ON CONFLICT (payout_id) DO UPDATE works
  payoutId: uuid("payout_id")
    .notNull()
    .unique()
    .references(() => creatorPayouts.id, { onDelete: "cascade" }),
  creatorId: uuid("creator_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  failureReason: text("failure_reason"),
  retryCount: integer("retry_count").notNull().default(0),
  lastAttemptedAt: timestamp("last_attempted_at", { withTimezone: true }),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  resolutionNote: text("resolution_note"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const creatorKyc = pgTable("creator_kyc", {
  id: uuidPk(),
  creatorId: uuid("creator_id")
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: "cascade" }),
  fullName: text("full_name"),
  bvnLast4: text("bvn_last4"),
  bankAccountNumber: text("bank_account_number"),
  bankCode: text("bank_code"),
  bankName: text("bank_name"),
  kycStatus: text("kyc_status").notNull().default("unverified"),
  isEncrypted: boolean("is_encrypted").notNull().default(false),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  rejectionReason: text("rejection_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

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
    code: text("code"),
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
    // Prevent self-referrals: a user cannot refer themselves.
    noSelfReferral: check(
      "referrals_no_self_referral",
      sql`${t.referrerId} <> ${t.referredId}`
    ),
  })
);

export const referralCommissions = pgTable("referral_commissions", {
  id: uuidPk(),
  referrerId: uuid("referrer_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  referredUserId: uuid("referred_user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  triggerEventId: text("trigger_event_id").notNull().unique(),
  // Migration 009 (lib) / 012 (db): added tier column
  tier: text("tier").notNull().default("standard"),
  purchaseAmountKobo: bigint("purchase_amount_kobo", { mode: "number" }).notNull(),
  commissionKobo: bigint("commission_kobo", { mode: "number" }).notNull(),
  commissionCoins: integer("commission_coins").notNull().default(0),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  creditedAt: timestamp("credited_at", { withTimezone: true }),
});

export const sponsoredQuests = pgTable("sponsored_quests", {
  id: uuidPk(),
  brandName: text("brand_name").notNull(),
  brandLogoUrl: text("brand_logo_url"),
  title: text("title").notNull(),
  description: text("description").notNull(),
  requirements: text("requirements"),
  targetAction: text("target_action"),
  targetValue: integer("target_value"),
  rewardCoins: integer("reward_coins"),
  creatorPayoutKobo: bigint("creator_payout_kobo", { mode: "bigint" }),
  platformFeeKobo: bigint("platform_fee_kobo", { mode: "bigint" }),
  platformSharePercent: integer("platform_share_percent").notNull().default(30),
  creatorSharePercent: integer("creator_share_percent").notNull().default(70),
  minCreatorTier: text("min_creator_tier").notNull().default("verified"),
  startsAt: timestamp("starts_at", { withTimezone: true }),
  endsAt: timestamp("ends_at", { withTimezone: true }),
  deadline: timestamp("deadline", { withTimezone: true }),
  isActive: boolean("is_active").default(true),
  maxCreators: integer("max_creators").default(10),
  maxApplications: integer("max_applications"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

// sponsored_quest_applications uses the 001 canonical schema:
// creator applies to a brand's sponsored quest campaign.
export const sponsoredQuestApplications = pgTable(
  "sponsored_quest_applications",
  {
    id: uuidPk(),
    questId: uuid("quest_id")
      .notNull()
      .references(() => sponsoredQuests.id, { onDelete: "cascade" }),
    creatorId: uuid("creator_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    roomId: uuid("room_id").references(() => rooms.id, { onDelete: "set null" }),
    status: text("status").notNull().default("pending"),
    progress: integer("progress").notNull().default(0),
    completionProof: text("completion_proof"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    // applied_at is used by the API (INSERT ... applied_at = NOW())
    appliedAt: timestamp("applied_at", { withTimezone: true }),
    payoutId: uuid("payout_id").references(() => creatorPayouts.id, {
      onDelete: "set null",
    }),
    payoutCoins: integer("payout_coins"),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    unique: uniqueIndex("sponsored_quest_applications_quest_creator_idx").on(
      t.questId,
      t.creatorId
    ),
  })
);

export const creatorBroadcasts = pgTable("creator_broadcasts", {
  id: uuidPk(),
  creatorId: uuid("creator_id").references(() => users.id, {
    onDelete: "cascade",
  }),
  senderId: uuid("sender_id").references(() => users.id, {
    onDelete: "cascade",
  }),
  recipientId: uuid("recipient_id").references(() => users.id, {
    onDelete: "cascade",
  }),
  subject: text("subject"),
  content: text("content").notNull(),
  messageType: text("message_type"),
  referenceId: text("reference_id"),
  recipientCount: integer("recipient_count").notNull().default(0),
  costCoins: integer("cost_coins").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const creatorSpotlights = pgTable("creator_spotlights", {
  id: uuidPk(),
  creatorId: uuid("creator_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  monthYear: text("month_year").notNull().unique(),
  blurb: text("blurb"),
  isActive: boolean("is_active").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  createdBy: uuid("created_by").references(() => users.id, {
    onDelete: "set null",
  }),
});

export const merchStores = pgTable("merch_stores", {
  id: uuidPk(),
  creatorId: uuid("creator_id")
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  isActive: boolean("is_active").default(true),
  physicalGoodsEnabled: boolean("physical_goods_enabled").default(false),
  defaultFulfillmentMethod: text("default_fulfillment_method").default("manual"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const merchProducts = pgTable("merch_products", {
  id: uuidPk(),
  storeId: uuid("store_id")
    .notNull()
    .references(() => merchStores.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  productType: text("product_type").notNull().default("digital"),
  priceKobo: bigint("price_kobo", { mode: "number" }).notNull(),
  imageUrl: text("image_url"),
  isActive: boolean("is_active").default(true),
  stock: integer("stock"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const merchOrders = pgTable("merch_orders", {
  id: uuidPk(),
  productId: uuid("product_id")
    .notNull()
    .references(() => merchProducts.id, { onDelete: "restrict" }),
  buyerId: uuid("buyer_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  creatorId: uuid("creator_id").references(() => users.id, {
    onDelete: "cascade",
  }),
  storeId: uuid("store_id").references(() => merchStores.id, {
    onDelete: "set null",
  }),
  amountKobo: bigint("amount_kobo", { mode: "bigint" }),
  priceKobo: bigint("price_kobo", { mode: "bigint" }),
  creatorShareKobo: bigint("creator_share_kobo", { mode: "bigint" }),
  creatorNetKobo: bigint("creator_net_kobo", { mode: "bigint" }),
  platformFeeKobo: bigint("platform_fee_kobo", { mode: "bigint" }).notNull(),
  paymentMethod: text("payment_method"),
  status: text("status").notNull().default("pending"),
  shippingName: text("shipping_name"),
  shippingAddress: text("shipping_address"),
  shippingCity: text("shipping_city"),
  shippingCountry: text("shipping_country"),
  fulfillmentMethod: text("fulfillment_method").default("manual"),
  sellerNotes: text("seller_notes"),
  shippedAt: timestamp("shipped_at", { withTimezone: true }),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  trackingUpdates: jsonb("tracking_updates").default(sql`'[]'::jsonb`),
  providerReference: text("provider_reference"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const classroomEnrolments = pgTable(
  "classroom_enrolments",
  {
    id: uuidPk(),
    roomId: uuid("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    paid: boolean("paid").notNull().default(false),
    feeKobo: bigint("fee_kobo", { mode: "number" }).notNull().default(0),
    enrolledAt: timestamp("enrolled_at", { withTimezone: true }).defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    certificateIssued: boolean("certificate_issued").default(false),
    certificateIssuedAt: timestamp("certificate_issued_at", {
      withTimezone: true,
    }),
  },
  (t) => ({
    unique: uniqueIndex("classroom_enrolments_room_user_idx").on(
      t.roomId,
      t.userId
    ),
  })
);

export const classroomQuizzes = pgTable("classroom_quizzes", {
  id: uuidPk(),
  roomId: uuid("room_id")
    .notNull()
    .references(() => rooms.id, { onDelete: "cascade" }),
  creatorId: uuid("creator_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  xpReward: integer("xp_reward").notNull().default(50),
  passScore: integer("pass_score").notNull().default(70),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const classroomQuizQuestions = pgTable("classroom_quiz_questions", {
  id: uuidPk(),
  quizId: uuid("quiz_id")
    .notNull()
    .references(() => classroomQuizzes.id, { onDelete: "cascade" }),
  question: text("question").notNull(),
  optionA: text("option_a").notNull(),
  optionB: text("option_b").notNull(),
  optionC: text("option_c").notNull(),
  optionD: text("option_d").notNull(),
  correctOption: text("correct_option").notNull(),
  position: integer("position").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const classroomQuizAttempts = pgTable(
  "classroom_quiz_attempts",
  {
    id: uuidPk(),
    quizId: uuid("quiz_id")
      .notNull()
      .references(() => classroomQuizzes.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    score: integer("score").notNull(),
    passed: boolean("passed").notNull(),
    answers: jsonb("answers").notNull(),
    xpAwarded: integer("xp_awarded").default(0),
    completedAt: timestamp("completed_at", { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    unique: uniqueIndex("classroom_quiz_attempts_quiz_user_idx").on(
      t.quizId,
      t.userId
    ),
  })
);

// ---------------------------------------------------------------------------
// Games (upcoming feature) — public, slug-addressed at /g/<slug>.
// Created alongside the slug/URL work so public routes, the sitemap and
// referral links have a real backing table. Mirrors the room slug model:
// immutable UUID `id` + mutable unique `slug`.
// ---------------------------------------------------------------------------
export const games = pgTable(
  "games",
  {
    id: uuidPk(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    tagline: text("tagline"),
    description: text("description"),
    coverImageUrl: text("cover_image_url"),
    coverEmoji: text("cover_emoji").notNull().default("🎮"),
    creatorId: uuid("creator_id").references(() => users.id, {
      onDelete: "set null",
    }),
    // Cover-page + gameplay config (added in 0013_games_feature)
    category: text("category"),
    longDescription: text("long_description"),
    engineKey: text("engine_key"),
    sortOrder: integer("sort_order").notNull().default(0),
    rewardCreditsPerWin: integer("reward_credits_per_win").notNull().default(0),
    rewardXpPerWin: integer("reward_xp_per_win").notNull().default(0),
    rewardStarsPerWin: integer("reward_stars_per_win").notNull().default(0),
    playCostCredits: integer("play_cost_credits").notNull().default(0),
    playCostStars: integer("play_cost_stars").notNull().default(0),
    maxScore: bigint("max_score", { mode: "number" }),
    minPlaySeconds: integer("min_play_seconds").notNull().default(0),
    isPublic: boolean("is_public").notNull().default(true),
    isActive: boolean("is_active").notNull().default(true),
    playCount: bigint("play_count", { mode: "number" }).notNull().default(0),
    avgRating: numeric("avg_rating", { precision: 3, scale: 2 }).notNull().default("0"),
    ratingCount: integer("rating_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => ({
    slugUnique: uniqueIndex("games_slug_unique_idx").on(t.slug),
  })
);

// ---------------------------------------------------------------------------
// Per-(game,user) star rating. 1-5 stars. Stored with upsert on conflict.
// Aggregate (avgRating, ratingCount) is maintained on the games table.
// ---------------------------------------------------------------------------
export const gameRatings = pgTable(
  "game_ratings",
  {
    gameId: uuid("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    rating: integer("rating").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.gameId, t.userId] }),
    ratingCheck: check("game_ratings_rating_check", sql`rating BETWEEN 1 AND 5`),
  })
);

// ---------------------------------------------------------------------------
// Game play sessions. One row per started session; server issues a single-use
// nonce on /start and consumes it on /score (anti-replay). `counted` marks a
// session whose score was accepted and rewarded.
// ---------------------------------------------------------------------------
export const gamePlays = pgTable(
  "game_plays",
  {
    id: uuidPk(),
    gameId: uuid("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    score: bigint("score", { mode: "number" }).notNull().default(0),
    sessionNonce: text("session_nonce").notNull(),
    counted: boolean("counted").notNull().default(false),
    challengeRoundId: uuid("challenge_round_id"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
  },
  (t) => ({
    nonceUnique: uniqueIndex("game_plays_nonce_idx").on(t.sessionNonce),
  })
);

// ---------------------------------------------------------------------------
// Per-(game,user) best score + counters. Backs the per-game leaderboard.
// ---------------------------------------------------------------------------
export const gameBestScores = pgTable(
  "game_best_scores",
  {
    gameId: uuid("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    bestScore: bigint("best_score", { mode: "number" }).notNull().default(0),
    plays: integer("plays").notNull().default(0),
    wins: integer("wins").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.gameId, t.userId] }),
  })
);

// ---------------------------------------------------------------------------
// Challenges (async score-based). Optional credit wager escrowed on accept.
// ---------------------------------------------------------------------------
export const gameChallenges = pgTable("game_challenges", {
  id: uuidPk(),
  gameId: uuid("game_id")
    .notNull()
    .references(() => games.id, { onDelete: "cascade" }),
  challengerId: uuid("challenger_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  opponentId: uuid("opponent_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("pending"),
  rounds: integer("rounds").notNull().default(1),
  wagerCredits: integer("wager_credits").notNull().default(0),
  escrowCredits: integer("escrow_credits").notNull().default(0),
  winnerId: uuid("winner_id").references(() => users.id, { onDelete: "set null" }),
  prizeCredits: integer("prize_credits").notNull().default(0),
  prizeXp: integer("prize_xp").notNull().default(0),
  prizeStars: integer("prize_stars").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

export const gameChallengeRounds = pgTable(
  "game_challenge_rounds",
  {
    id: uuidPk(),
    challengeId: uuid("challenge_id")
      .notNull()
      .references(() => gameChallenges.id, { onDelete: "cascade" }),
    roundNo: integer("round_no").notNull(),
    challengerPlayId: uuid("challenger_play_id"),
    opponentPlayId: uuid("opponent_play_id"),
    challengerScore: bigint("challenger_score", { mode: "number" }),
    opponentScore: bigint("opponent_score", { mode: "number" }),
    roundWinnerId: uuid("round_winner_id").references(() => users.id, {
      onDelete: "set null",
    }),
    status: text("status").notNull().default("pending"),
  },
  (t) => ({
    roundUnique: uniqueIndex("game_challenge_rounds_unique_idx").on(
      t.challengeId,
      t.roundNo
    ),
  })
);

// ---------------------------------------------------------------------------
// Global games-played milestones (gaming track) + per-user claim ledger.
// ---------------------------------------------------------------------------
export const gamePlayMilestones = pgTable("game_play_milestones", {
  id: uuidPk(),
  gamesPlayedThreshold: integer("games_played_threshold").notNull().unique(),
  rewardCredits: integer("reward_credits").notNull().default(0),
  rewardXp: integer("reward_xp").notNull().default(0),
  rewardStars: integer("reward_stars").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const gameMilestoneClaims = pgTable(
  "game_milestone_claims",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    threshold: integer("threshold").notNull(),
    claimedAt: timestamp("claimed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.threshold] }),
  })
);

// ---------------------------------------------------------------------------
// Slug redirect history. When a room/game slug changes the previous value is
// recorded here so old links 301 to the current slug instead of 404ing.
// ---------------------------------------------------------------------------
export const slugRedirects = pgTable(
  "slug_redirects",
  {
    id: uuidPk(),
    entityType: text("entity_type").notNull(),
    oldSlug: text("old_slug").notNull(),
    entityId: uuid("entity_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqueOldSlug: uniqueIndex("slug_redirects_entity_old_slug_idx").on(
      t.entityType,
      t.oldSlug
    ),
  })
);

export const learningCertificates = pgTable(
  "learning_certificates",
  {
    id: uuidPk(),
    roomId: uuid("room_id").references(() => rooms.id, { onDelete: "cascade" }),
    recipientUserId: uuid("recipient_user_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    issuerUserId: uuid("issuer_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    title: text("title"),
    note: text("note"),
    issuedAt: timestamp("issued_at", { withTimezone: true }).defaultNow(),
    certificateUrl: text("certificate_url"),
    metadata: jsonb("metadata"),
  },
  (t) => ({
    unique: uniqueIndex("learning_certificates_room_recipient_idx").on(
      t.roomId,
      t.recipientUserId
    ),
  })
);

export const elderRequests = pgTable(
  "elder_requests",
  {
    id: uuidPk(),
    menteeId: uuid("mentee_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    elderId: uuid("elder_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    message: text("message"),
    status: text("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    unique: uniqueIndex("elder_requests_mentee_elder_idx").on(
      t.menteeId,
      t.elderId
    ),
  })
);

export const elderMentorships = pgTable(
  "elder_mentorships",
  {
    id: uuidPk(),
    elderId: uuid("elder_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    menteeId: uuid("mentee_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("active"),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
  },
  (t) => ({
    unique: uniqueIndex("elder_mentorships_elder_mentee_idx").on(
      t.elderId,
      t.menteeId
    ),
  })
);

// ---------------------------------------------------------------------------
// SECTION 9: Announcements, Admin & Communication
// ---------------------------------------------------------------------------

export const announcementModals = pgTable("announcement_modals", {
  id: uuidPk(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  contentType: text("content_type").notNull().default("html"),
  isActive: boolean("is_active").default(false),
  startsAt: timestamp("starts_at", { withTimezone: true }),
  endsAt: timestamp("ends_at", { withTimezone: true }),
  targetPlans: text("target_plans").array(),
  targetRoles: text("target_roles").array(),
  displayOrder: integer("display_order").notNull().default(0),
  // Migration 015 (db): added deleted_at, created_by
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const announcementBanners = pgTable("announcement_banners", {
  id: uuidPk(),
  content: text("content").notNull(),
  contentType: text("content_type").notNull().default("html"),
  isActive: boolean("is_active").default(false),
  startsAt: timestamp("starts_at", { withTimezone: true }),
  endsAt: timestamp("ends_at", { withTimezone: true }),
  targetPlans: text("target_plans").array(),
  targetRoles: text("target_roles").array(),
  displayOrder: integer("display_order").notNull().default(0),
  // Migration 015 (db): added title, link_url, deleted_at, created_by
  title: text("title"),
  linkUrl: text("link_url"),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const userModalViews = pgTable(
  "user_modal_views",
  {
    id: uuidPk(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    modalId: uuid("modal_id")
      .notNull()
      .references(() => announcementModals.id, { onDelete: "cascade" }),
    viewedAt: timestamp("viewed_at", { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    unique: uniqueIndex("user_modal_views_user_modal_idx").on(
      t.userId,
      t.modalId
    ),
  })
);

export const userBannerViews = pgTable(
  "user_banner_views",
  {
    id: uuidPk(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    bannerId: uuid("banner_id")
      .notNull()
      .references(() => announcementBanners.id, { onDelete: "cascade" }),
    viewedAt: timestamp("viewed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    unique: uniqueIndex("user_banner_views_user_banner_idx").on(
      t.userId,
      t.bannerId
    ),
  })
);

export const userAnnouncementRotation = pgTable(
  "user_announcement_rotation",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    contentType: text("content_type").notNull(),
    lastShownId: uuid("last_shown_id").notNull(),
    lastShownAt: timestamp("last_shown_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.contentType] }),
  })
);

export const adminMessages = pgTable("admin_messages", {
  id: uuidPk(),
  senderAdminId: uuid("sender_admin_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  subject: text("subject"),
  body: text("body").notNull(),
  broadcastType: text("broadcast_type").notNull().default("direct"),
  targetPlans: text("target_plans").array(),
  targetRoles: text("target_roles").array(),
  targetUserIds: uuid("target_user_ids").array(),
  recipientCount: integer("recipient_count").default(0),
  deliveredCount: integer("delivered_count").default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const adminMessageReceipts = pgTable(
  "admin_message_receipts",
  {
    id: uuidPk(),
    adminMessageId: uuid("admin_message_id")
      .notNull()
      .references(() => adminMessages.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    isDelivered: boolean("is_delivered").default(false),
    isRead: boolean("is_read").default(false),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    readAt: timestamp("read_at", { withTimezone: true }),
  },
  (t) => ({
    unique: uniqueIndex("admin_message_receipts_msg_user_idx").on(
      t.adminMessageId,
      t.userId
    ),
  })
);

export const telegramDeliveryQueue = pgTable("telegram_delivery_queue", {
  id: uuidPk(),
  broadcastId: uuid("broadcast_id").references(() => adminMessages.id, {
    onDelete: "cascade",
  }),
  telegramIds: jsonb("telegram_ids").notNull(),
  status: text("status").notNull().default("pending"),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  failedAttempts: integer("failed_attempts").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const footerScripts = pgTable("footer_scripts", {
  id: uuidPk(),
  name: text("name").notNull(),
  content: text("content").notNull(),
  isActive: boolean("is_active").default(true),
  position: integer("position").default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const adminActions = pgTable("admin_actions", {
  id: uuidPk(),
  adminId: uuid("admin_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  targetUserId: uuid("target_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  action: text("action").notNull(),
  reason: text("reason"),
  durationHours: integer("duration_hours"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const adminAuditLog = pgTable("admin_audit_log", {
  id: uuidPk(),
  adminId: uuid("admin_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  action: text("action").notNull(),
  resource: text("resource"),
  resourceId: text("resource_id"),
  targetType: text("target_type"),
  targetId: text("target_id"),
  beforeVal: jsonb("before_val"),
  afterVal: jsonb("after_val"),
  metadata: jsonb("metadata"),
  ipAddress: text("ip_address"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const adminRoles = pgTable(
  "admin_roles",
  {
    id: uuidPk(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("admin"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    unique: uniqueIndex("admin_roles_user_role_idx").on(t.userId, t.role),
  })
);

export const systemAlerts = pgTable("system_alerts", {
  id: uuidPk(),
  type: text("type").notNull(),
  severity: text("severity").notNull().default("info"),
  message: text("message").notNull(),
  metadata: jsonb("metadata"),
  resolved: boolean("resolved").notNull().default(false),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  resolvedBy: uuid("resolved_by").references(() => users.id, {
    onDelete: "set null",
  }),
  resolutionNote: text("resolution_note"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const moderationAiEscalations = pgTable("moderation_ai_escalations", {
  id: uuidPk(),
  // FK to moderation_reports established at DB level (forward ref in 001)
  reportId: uuid("report_id").notNull(),
  adminId: uuid("admin_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  verdict: text("verdict").notNull(),
  confidence: numeric("confidence", { precision: 4, scale: 3 }).notNull(),
  reasoning: text("reasoning"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ---------------------------------------------------------------------------
// SECTION 10: Subscriptions & Plans
// ---------------------------------------------------------------------------

// `subscriptions` — tracks a user's *app plan* subscription (free/pro/etc).
// One row per user (unique on user_id). Holds billing period, provider
// subscription ID, and renewal/cancellation timestamps. Referenced by
// `businessAccounts.subscription_id` for business-tier plan upgrades.
// Do NOT confuse with `userSubscriptions` (payment-provider link) or
// `roomSubscriptions` (paid access to a specific room).
export const subscriptions = pgTable(
  "subscriptions",
  {
  id: uuidPk(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  plan: text("plan").notNull(),
  billingPeriod: text("billing_period").notNull().default("monthly"),
  status: text("status").notNull().default("active"),
  startsAt: timestamp("starts_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  autoRenew: boolean("auto_renew").default(true),
  provider: text("provider"),
  providerSubscriptionId: text("provider_subscription_id"),
  // Migration 002 (db): added cancelled_at
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    userIdUniq: uniqueIndex("subscriptions_user_id_idx").on(t.userId),
  })
);

export const subscriptionPlans = pgTable(
  "subscription_plans",
  {
    id: uuidPk(),
    plan: text("plan").notNull(),
    name: text("name").notNull(),
    interval: text("interval").notNull().default("monthly"),
    priceKobo: bigint("price_kobo", { mode: "number" }).notNull(),
    currency: text("currency").notNull().default("NGN"),
    isActive: boolean("is_active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    planIntervalUniq: uniqueIndex("subscription_plans_plan_interval_uq").on(
      t.plan,
      t.interval
    ),
  })
);

// `userSubscriptions` — links a user to an external payment-provider
// subscription (e.g. Paystack recurring charge). One row per user (unique on
// user_id). Tracks provider subscription ID, renewal date, and cancellation.
// This is NOT a duplicate of `subscriptions`: `subscriptions` models the
// plan-level entitlement; `userSubscriptions` models the payment-provider
// contract that funds it. Both may coexist for the same user.
// 001 canonical user_subscriptions (simple, with unique user_id)
export const userSubscriptions = pgTable("user_subscriptions", {
  id: uuidPk(),
  userId: uuid("user_id")
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: "cascade" }),
  provider: text("provider").notNull().default("paystack"),
  providerSubscriptionId: text("provider_subscription_id"),
  status: text("status").notNull().default("active"),
  nextRenewalAt: timestamp("next_renewal_at", { withTimezone: true }),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const businessAccounts = pgTable("business_accounts", {
  id: uuidPk(),
  userId: uuid("user_id")
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: "cascade" }),
  businessName: text("business_name").notNull(),
  businessType: text("business_type"),
  tier: text("tier").notNull().default("starter"),
  pendingTier: text("pending_tier"),
  pendingPaymentRef: text("pending_payment_ref"),
  tierUpdatedAt: timestamp("tier_updated_at", { withTimezone: true }),
  verified: boolean("verified").default(false),
  status: text("status").notNull().default("active"),
  subscriptionId: uuid("subscription_id").references(() => subscriptions.id, {
    onDelete: "set null",
  }),
  // Migration 013 (db): verification workflow columns
  verificationStatus: text("verification_status").notNull().default("unverified"),
  verificationRequestedAt: timestamp("verification_requested_at", {
    withTimezone: true,
  }),
  verificationReviewedAt: timestamp("verification_reviewed_at", {
    withTimezone: true,
  }),
  verificationRejectReason: text("verification_reject_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

// ---------------------------------------------------------------------------
// SECTION 11: Moderation & Reports
// ---------------------------------------------------------------------------

// Two distinct report tables serve different purposes:
//   reports            — User-submitted content/user reports. Used by trust score calculations.
//   moderation_reports — AI-pipeline moderation queue with ai_classification columns.
// They are NOT duplicates; do NOT merge them.
export const reports = pgTable("reports", {
  id: uuidPk(),
  reporterId: uuid("reporter_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  reportedUserId: uuid("reported_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  reportedMessageId: uuid("reported_message_id").references(
    () => roomMessages.id,
    { onDelete: "set null" }
  ),
  reportedRoomId: uuid("reported_room_id").references(() => rooms.id, {
    onDelete: "set null",
  }),
  reportedGuildId: uuid("reported_guild_id").references(() => guilds.id, {
    onDelete: "set null",
  }),
  reportType: text("report_type").notNull(),
  description: text("description"),
  aiCategory: text("ai_category"),
  aiConfidence: decimal("ai_confidence", { precision: 5, scale: 4 }),
  status: text("status").notNull().default("pending"),
  moderatorId: uuid("moderator_id").references(() => users.id, {
    onDelete: "set null",
  }),
  resolutionNote: text("resolution_note"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
});

export const moderationReports = pgTable("moderation_reports", {
  id: uuidPk(),
  reporterId: uuid("reporter_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  reportedUserId: uuid("reported_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  reportedMessageId: uuid("reported_message_id"),
  reportedRoomId: uuid("reported_room_id").references(() => rooms.id, {
    onDelete: "set null",
  }),
  reportedGuildId: uuid("reported_guild_id").references(() => guilds.id, {
    onDelete: "set null",
  }),
  reportType: text("report_type").notNull().default("other"),
  description: text("description"),
  status: text("status").notNull().default("pending"),
  pipelineStatus: text("pipeline_status").notNull().default("manual_queue"),
  aiCategory: text("ai_category"),
  aiConfidence: decimal("ai_confidence", { precision: 5, scale: 4 }),
  aiRecommendation: text("ai_recommendation"),
  aiProvider: text("ai_provider"),
  aiClassifiedAt: timestamp("ai_classified_at", { withTimezone: true }),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  resolvedBy: uuid("resolved_by").references(() => users.id, {
    onDelete: "set null",
  }),
  resolutionNote: text("resolution_note"),
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
  actionType: text("action_type"),
  reason: text("reason"),
  reportId: uuid("report_id").references(() => reports.id, {
    onDelete: "set null",
  }),
  durationHours: integer("duration_hours"),
  actorType: text("actor_type").notNull().default("manual"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  metadata: jsonb("metadata"),
  reversedAt: timestamp("reversed_at", { withTimezone: true }),
  reversedBy: uuid("reversed_by").references(() => users.id, {
    onDelete: "set null",
  }),
  reversalNote: text("reversal_note"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

// ---------------------------------------------------------------------------
// SECTION 12: Cultural Events & Community
// ---------------------------------------------------------------------------

export const platformEvents = pgTable(
  "platform_events",
  {
    id: uuidPk(),
    name: text("name").notNull(),
    description: text("description"),
    eventType: text("event_type").notNull().default("cultural"),
    xpMultiplier: decimal("xp_multiplier", { precision: 3, scale: 1 }).default(
      "1.0"
    ),
    coinBonusPct: integer("coin_bonus_pct").default(0),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    isActive: boolean("is_active").default(true),
    targetCities: text("target_cities").array(),
    isRecurringAnnual: boolean("is_recurring_annual").notNull().default(false),
    recurrenceAnchorMonthStart: integer("recurrence_anchor_month_start"),
    recurrenceAnchorDayStart: integer("recurrence_anchor_day_start"),
    recurrenceAnchorMonthEnd: integer("recurrence_anchor_month_end"),
    recurrenceAnchorDayEnd: integer("recurrence_anchor_day_end"),
    metadata: jsonb("metadata"),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    // BUG-DB-03: Recurring events share the same name; uniqueness is per (name, starts_at).
    nameStartsAtUnique: uniqueIndex("uidx_platform_events_name_starts_at").on(
      t.name,
      t.startsAt
    ),
  })
);

export const flashXpEvents = pgTable("flash_xp_events", {
  id: uuidPk(),
  name: text("name").notNull(),
  description: text("description"),
  multiplier: decimal("multiplier", { precision: 3, scale: 1 })
    .notNull()
    .default("2.0"),
  announcedAt: timestamp("announced_at", { withTimezone: true }),
  firesAt: timestamp("fires_at", { withTimezone: true }),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  isActive: boolean("is_active").default(true),
  fired: boolean("fired").default(false),
  announcementNotificationSent: boolean("announcement_notification_sent")
    .notNull()
    .default(false),
  notificationSentAt: timestamp("notification_sent_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const monthlyGiftDrops = pgTable("monthly_gift_drops", {
  id: uuidPk(),
  giftItemId: uuid("gift_item_id").references(() => giftItems.id, {
    onDelete: "set null",
  }),
  title: text("title").notNull(),
  availableFrom: timestamp("available_from", { withTimezone: true }).notNull(),
  availableUntil: timestamp("available_until", { withTimezone: true }).notNull(),
  announcedAt: timestamp("announced_at", { withTimezone: true }),
  isActive: boolean("is_active").default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const sponsoredLeaderboardBanners = pgTable(
  "sponsored_leaderboard_banners",
  {
    id: uuidPk(),
    sponsorName: text("sponsor_name").notNull(),
    sponsorLogoUrl: text("sponsor_logo_url"),
    ctaText: text("cta_text").notNull(),
    ctaUrl: text("cta_url").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    isActive: boolean("is_active").notNull().default(false),
    impressions: integer("impressions").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  }
);

export const communityNotes = pgTable("community_notes", {
  id: uuidPk(),
  targetType: text("target_type").notNull(),
  targetId: uuid("target_id").notNull(),
  authorId: uuid("author_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  helpfulVotes: integer("helpful_votes").notNull().default(0),
  unhelpfulVotes: integer("unhelpful_votes").notNull().default(0),
  status: text("status").notNull().default("needs_review"),
  adminComment: text("admin_comment"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  reviewedBy: uuid("reviewed_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const communityNoteVotes = pgTable(
  "community_note_votes",
  {
    id: uuidPk(),
    noteId: uuid("note_id")
      .notNull()
      .references(() => communityNotes.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    helpful: boolean("helpful").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    unique: uniqueIndex("community_note_votes_note_user_idx").on(
      t.noteId,
      t.userId
    ),
  })
);

export const platformCouncilMembers = pgTable(
  "platform_council_members",
  {
    id: uuidPk(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    cycleMonth: text("cycle_month").notNull(),
    legacyScore: bigint("legacy_score", { mode: "number" }).notNull(),
    joinedAt: timestamp("joined_at", { withTimezone: true }).defaultNow(),
    leftAt: timestamp("left_at", { withTimezone: true }),
  },
  (t) => ({
    // IMP-IDMP-01: One seat per user per cycle; allow re-joining in future cycles.
    userCycleUnique: uniqueIndex("uidx_council_members_user_cycle").on(
      t.userId,
      t.cycleMonth
    ),
    // Partial index to enforce at most one active seat per user at a time.
    activeUserUnique: uniqueIndex("uidx_council_members_user_active")
      .on(t.userId)
      .where(sql`left_at IS NULL`),
  })
);

export const platformCouncilIdeas = pgTable("platform_council_ideas", {
  id: uuidPk(),
  authorId: uuid("author_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description").notNull(),
  votes: integer("votes").notNull().default(0),
  status: text("status").notNull().default("open"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const councilInvitations = pgTable("council_invitations", {
  id: uuidPk(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  invitedAt: timestamp("invited_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
  legacyScore: bigint("legacy_score", { mode: "number" }).notNull().default(0),
});

// ---------------------------------------------------------------------------
// SECTION 13: System tables
// ---------------------------------------------------------------------------

export const auditLog = pgTable("audit_log", {
  id: uuidPk(),
  actorId: uuid("actor_id"),
  action: text("action").notNull(),
  targetType: text("target_type"),
  targetId: text("target_id"),
  metadata: jsonb("metadata"),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Migration 010 (db): feature flags with plan gates and early-access windows
export const featureFlags = pgTable("feature_flags", {
  key: text("key").primaryKey(),
  availableFrom: timestamp("available_from", { withTimezone: true }),
  earlyAccessPlans: text("early_access_plans").array(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Migration 015 (db): failed webhook events for retry
export const failedWebhooks = pgTable("failed_webhooks", {
  id: uuidPk(),
  provider: text("provider").notNull(),
  eventType: text("event_type"),
  payload: jsonb("payload"),
  error: text("error"),
  retryCount: integer("retry_count").default(0).notNull(),
  nextRetryAt: timestamp("next_retry_at", { withTimezone: true }),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Audit trail for AI / automated moderation actions (admin tools)
export const automatedActionsLog = pgTable("automated_actions_log", {
  id: uuidPk(),
  actionType: text("action_type").notNull(),
  targetType: text("target_type"),
  targetId: text("target_id"),
  targetUserId: uuid("target_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  description: text("description"),
  metadata: jsonb("metadata"),
  reverseNote: text("reverse_note"),
  reversedAt: timestamp("reversed_at", { withTimezone: true }),
  reversedBy: uuid("reversed_by").references(() => users.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

// Admin coin-refund ledger (used by /api/admin/refunds)
export const refunds = pgTable("refunds", {
  id: uuidPk(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  amountCoins: bigint("amount_coins", { mode: "number" }).notNull(),
  reason: text("reason"),
  referenceId: text("reference_id"),
  status: text("status").notNull().default("processed"),
  processedBy: uuid("processed_by").references(() => users.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
});

// ---------------------------------------------------------------------------
// Type exports — $inferSelect = row shape, $inferInsert = insert payload shape
// ---------------------------------------------------------------------------

// Config
export type XManifest = typeof xManifest.$inferSelect;
export type NewXManifest = typeof xManifest.$inferInsert;
export type AppSetting = typeof appSettings.$inferSelect;
export type NewAppSetting = typeof appSettings.$inferInsert;
export type CronStateRow = typeof cronState.$inferSelect;
export type NewCronStateRow = typeof cronState.$inferInsert;

// Users & Auth
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
export type UserPin = typeof userPins.$inferSelect;
export type NewUserPin = typeof userPins.$inferInsert;
export type PasswordResetToken = typeof passwordResetTokens.$inferSelect;
export type NewPasswordResetToken = typeof passwordResetTokens.$inferInsert;
export type UserPushToken = typeof userPushTokens.$inferSelect;
export type NewUserPushToken = typeof userPushTokens.$inferInsert;
export type UserBlock = typeof userBlocks.$inferSelect;
export type NewUserBlock = typeof userBlocks.$inferInsert;
export type UserEmailPreference = typeof userEmailPreferences.$inferSelect;
export type NewUserEmailPreference = typeof userEmailPreferences.$inferInsert;
export type DataExportRequest = typeof dataExportRequests.$inferSelect;
export type NewDataExportRequest = typeof dataExportRequests.$inferInsert;
export type TelegramLoginState = typeof telegramLoginStates.$inferSelect;
export type NewTelegramLoginState = typeof telegramLoginStates.$inferInsert;

// Social Graph & Messaging
export type Friendship = typeof friendships.$inferSelect;
export type NewFriendship = typeof friendships.$inferInsert;
export type Follow = typeof follows.$inferSelect;
export type NewFollow = typeof follows.$inferInsert;
export type DmConversation = typeof dmConversations.$inferSelect;
export type NewDmConversation = typeof dmConversations.$inferInsert;
export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
export type DmConversationUnlock = typeof dmConversationUnlocks.$inferSelect;
export type NewDmConversationUnlock = typeof dmConversationUnlocks.$inferInsert;
export type ConversationScore = typeof conversationScores.$inferSelect;
export type NewConversationScore = typeof conversationScores.$inferInsert;
export type DmConversationScoreMilestone = typeof dmConversationScoreMilestones.$inferSelect;
export type NewDmConversationScoreMilestone = typeof dmConversationScoreMilestones.$inferInsert;
export type DmScoreStickerUnlock = typeof dmScoreStickerUnlocks.$inferSelect;
export type NewDmScoreStickerUnlock = typeof dmScoreStickerUnlocks.$inferInsert;
export type GroupChat = typeof groupChats.$inferSelect;
export type NewGroupChat = typeof groupChats.$inferInsert;
export type GroupChatMember = typeof groupChatMembers.$inferSelect;
export type NewGroupChatMember = typeof groupChatMembers.$inferInsert;
export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;
export type UserMessage = typeof userMessages.$inferSelect;
export type NewUserMessage = typeof userMessages.$inferInsert;
export type UserInactivityEvent = typeof userInactivityEvents.$inferSelect;
export type NewUserInactivityEvent = typeof userInactivityEvents.$inferInsert;
export type Moment = typeof moments.$inferSelect;
export type NewMoment = typeof moments.$inferInsert;
export type MomentView = typeof momentViews.$inferSelect;
export type NewMomentView = typeof momentViews.$inferInsert;
export type MomentReaction = typeof momentReactions.$inferSelect;
export type NewMomentReaction = typeof momentReactions.$inferInsert;

// Guilds
export type Guild = typeof guilds.$inferSelect;
export type NewGuild = typeof guilds.$inferInsert;
export type GuildMember = typeof guildMembers.$inferSelect;
export type NewGuildMember = typeof guildMembers.$inferInsert;
export type GuildWar = typeof guildWars.$inferSelect;
export type NewGuildWar = typeof guildWars.$inferInsert;
export type WarContribution = typeof warContributions.$inferSelect;
export type NewWarContribution = typeof warContributions.$inferInsert;
export type GuildQuest = typeof guildQuests.$inferSelect;
export type NewGuildQuest = typeof guildQuests.$inferInsert;
export type GuildQuestContribution = typeof guildQuestContributions.$inferSelect;
export type NewGuildQuestContribution = typeof guildQuestContributions.$inferInsert;
export type GuildWarRematchToken = typeof guildWarRematchTokens.$inferSelect;
export type NewGuildWarRematchToken = typeof guildWarRematchTokens.$inferInsert;
export type GuildApplication = typeof guildApplications.$inferSelect;
export type NewGuildApplication = typeof guildApplications.$inferInsert;
export type GuildInvite = typeof guildInvites.$inferSelect;
export type NewGuildInvite = typeof guildInvites.$inferInsert;
export type GuildTreasuryLedgerEntry = typeof guildTreasuryLedger.$inferSelect;
export type NewGuildTreasuryLedgerEntry = typeof guildTreasuryLedger.$inferInsert;
export type GuildTierHistory = typeof guildTierHistory.$inferSelect;
export type NewGuildTierHistory = typeof guildTierHistory.$inferInsert;
export type GuildAlliance = typeof guildAlliances.$inferSelect;
export type NewGuildAlliance = typeof guildAlliances.$inferInsert;
export type GuildAllianceMember = typeof guildAllianceMembers.$inferSelect;
export type NewGuildAllianceMember = typeof guildAllianceMembers.$inferInsert;
export type AllianceWar = typeof allianceWars.$inferSelect;
export type NewAllianceWar = typeof allianceWars.$inferInsert;
export type GuildContributionAlert = typeof guildContributionAlerts.$inferSelect;
export type NewGuildContributionAlert = typeof guildContributionAlerts.$inferInsert;
export type GuildMessage = typeof guildMessages.$inferSelect;
export type NewGuildMessage = typeof guildMessages.$inferInsert;

// Rooms
export type Room = typeof rooms.$inferSelect;
export type NewRoom = typeof rooms.$inferInsert;
export type RoomMember = typeof roomMembers.$inferSelect;
export type NewRoomMember = typeof roomMembers.$inferInsert;
export type RoomMessage = typeof roomMessages.$inferSelect;
export type NewRoomMessage = typeof roomMessages.$inferInsert;
export type MessageReaction = typeof messageReactions.$inferSelect;
export type NewMessageReaction = typeof messageReactions.$inferInsert;
export type RoomMessageReaction = typeof roomMessageReactions.$inferSelect;
export type NewRoomMessageReaction = typeof roomMessageReactions.$inferInsert;
export type RoomMemberHighlight = typeof roomMemberHighlights.$inferSelect;
export type NewRoomMemberHighlight = typeof roomMemberHighlights.$inferInsert;
export type RoomModerationLogEntry = typeof roomModerationLog.$inferSelect;
export type NewRoomModerationLogEntry = typeof roomModerationLog.$inferInsert;
export type RoomSubscription = typeof roomSubscriptions.$inferSelect;
export type NewRoomSubscription = typeof roomSubscriptions.$inferInsert;
export type RoomPromotion = typeof roomPromotions.$inferSelect;
export type NewRoomPromotion = typeof roomPromotions.$inferInsert;
export type RoomMonthlyActiveUser = typeof roomMonthlyActiveUsers.$inferSelect;
export type NewRoomMonthlyActiveUser = typeof roomMonthlyActiveUsers.$inferInsert;
export type RoomPin = typeof roomPins.$inferSelect;
export type NewRoomPin = typeof roomPins.$inferInsert;
export type GuildRoom = typeof guildRooms.$inferSelect;
export type NewGuildRoom = typeof guildRooms.$inferInsert;
export type DropRoomReplay = typeof dropRoomReplays.$inferSelect;
export type NewDropRoomReplay = typeof dropRoomReplays.$inferInsert;
export type BrandedRoom = typeof brandedRooms.$inferSelect;
export type NewBrandedRoom = typeof brandedRooms.$inferInsert;

// Quests, Seasons & Progression
export type QuestTemplate = typeof questTemplates.$inferSelect;
export type NewQuestTemplate = typeof questTemplates.$inferInsert;
export type UserQuest = typeof userQuests.$inferSelect;
export type NewUserQuest = typeof userQuests.$inferInsert;
export type UserQuestProgress = typeof userQuestProgress.$inferSelect;
export type NewUserQuestProgress = typeof userQuestProgress.$inferInsert;
export type UserQuestDeck = typeof userQuestDecks.$inferSelect;
export type NewUserQuestDeck = typeof userQuestDecks.$inferInsert;
export type Season = typeof seasons.$inferSelect;
export type NewSeason = typeof seasons.$inferInsert;
export type UserSeasonPass = typeof userSeasonPasses.$inferSelect;
export type NewUserSeasonPass = typeof userSeasonPasses.$inferInsert;
export type SeasonPassMilestone = typeof seasonPassMilestones.$inferSelect;
export type NewSeasonPassMilestone = typeof seasonPassMilestones.$inferInsert;
export type UserSeasonMilestoneClaim = typeof userSeasonMilestoneClaims.$inferSelect;
export type NewUserSeasonMilestoneClaim = typeof userSeasonMilestoneClaims.$inferInsert;
export type SeasonRankArchive = typeof seasonRankArchives.$inferSelect;
export type NewSeasonRankArchive = typeof seasonRankArchives.$inferInsert;
export type LeaderboardSnapshot = typeof leaderboardSnapshots.$inferSelect;
export type NewLeaderboardSnapshot = typeof leaderboardSnapshots.$inferInsert;
export type LeaderboardRankSnapshot = typeof leaderboardRankSnapshots.$inferSelect;
export type NewLeaderboardRankSnapshot = typeof leaderboardRankSnapshots.$inferInsert;
export type NemesisAssignment = typeof nemesisAssignments.$inferSelect;
export type NewNemesisAssignment = typeof nemesisAssignments.$inferInsert;
export type NemesisChallenge = typeof nemesisChallenges.$inferSelect;
export type NewNemesisChallenge = typeof nemesisChallenges.$inferInsert;
export type UserBadge = typeof userBadges.$inferSelect;
export type NewUserBadge = typeof userBadges.$inferInsert;
export type UserTitle = typeof userTitles.$inferSelect;
export type NewUserTitle = typeof userTitles.$inferInsert;
export type TrackMilestoneUnlock = typeof trackMilestoneUnlocks.$inferSelect;
export type NewTrackMilestoneUnlock = typeof trackMilestoneUnlocks.$inferInsert;
export type RankUpEvent = typeof rankUpEvents.$inferSelect;
export type NewRankUpEvent = typeof rankUpEvents.$inferInsert;
export type XpEvent = typeof xpEvents.$inferSelect;
export type NewXpEvent = typeof xpEvents.$inferInsert;
export type HallOfFameRow = typeof hallOfFame.$inferSelect;
export type NewHallOfFameRow = typeof hallOfFame.$inferInsert;
export type NewMemberQuestRow = typeof newMemberQuests.$inferSelect;
export type NewNewMemberQuestRow = typeof newMemberQuests.$inferInsert;

// Economy
export type CoinLedger = typeof coinLedger.$inferSelect;
export type NewCoinLedger = typeof coinLedger.$inferInsert;
/** @deprecated Use CoinLedger */
export type CoinLedgerEntry = CoinLedger;
export type StarLedger = typeof starLedger.$inferSelect;
export type NewStarLedger = typeof starLedger.$inferInsert;
export type XpLedger = typeof xpLedger.$inferSelect;
export type NewXpLedger = typeof xpLedger.$inferInsert;
/** @deprecated Use XpLedger */
export type XpLedgerEntry = XpLedger;
export type Payment = typeof payments.$inferSelect;
export type NewPayment = typeof payments.$inferInsert;
export type GiftItem = typeof giftItems.$inferSelect;
export type NewGiftItem = typeof giftItems.$inferInsert;
export type GiftType = typeof giftTypes.$inferSelect;
export type NewGiftType = typeof giftTypes.$inferInsert;
export type Gift = typeof gifts.$inferSelect;
export type NewGift = typeof gifts.$inferInsert;
export type StoreItem = typeof storeItems.$inferSelect;
export type NewStoreItem = typeof storeItems.$inferInsert;
export type UserCosmetic = typeof userCosmetics.$inferSelect;
export type NewUserCosmetic = typeof userCosmetics.$inferInsert;
export type UserXpBooster = typeof userXpBoosters.$inferSelect;
export type NewUserXpBooster = typeof userXpBoosters.$inferInsert;
export type StickerPack = typeof stickerPacks.$inferSelect;
export type NewStickerPack = typeof stickerPacks.$inferInsert;
export type Sticker = typeof stickers.$inferSelect;
export type NewSticker = typeof stickers.$inferInsert;
export type UserStickerPack = typeof userStickerPacks.$inferSelect;
export type NewUserStickerPack = typeof userStickerPacks.$inferInsert;
export type ReactionSet = typeof reactionSets.$inferSelect;
export type NewReactionSet = typeof reactionSets.$inferInsert;
export type ReactionSetItem = typeof reactionSetItems.$inferSelect;
export type NewReactionSetItem = typeof reactionSetItems.$inferInsert;
export type UserReactionSet = typeof userReactionSets.$inferSelect;
export type NewUserReactionSet = typeof userReactionSets.$inferInsert;
export type AuditDiscrepancy = typeof auditDiscrepancies.$inferSelect;
export type NewAuditDiscrepancy = typeof auditDiscrepancies.$inferInsert;
export type FailedXpAward = typeof failedXpAwards.$inferSelect;
export type NewFailedXpAward = typeof failedXpAwards.$inferInsert;

// Creator Economy
export type CreatorEarning = typeof creatorEarnings.$inferSelect;
export type NewCreatorEarning = typeof creatorEarnings.$inferInsert;
export type CreatorPayout = typeof creatorPayouts.$inferSelect;
export type NewCreatorPayout = typeof creatorPayouts.$inferInsert;
export type CreatorBankAccount = typeof creatorBankAccounts.$inferSelect;
export type NewCreatorBankAccount = typeof creatorBankAccounts.$inferInsert;
export type CreatorWalletAddress = typeof creatorWalletAddresses.$inferSelect;
export type NewCreatorWalletAddress = typeof creatorWalletAddresses.$inferInsert;
export type PayoutDeadLetterQueueEntry = typeof payoutDeadLetterQueue.$inferSelect;
export type NewPayoutDeadLetterQueueEntry = typeof payoutDeadLetterQueue.$inferInsert;
export type CreatorKyc = typeof creatorKyc.$inferSelect;
export type NewCreatorKyc = typeof creatorKyc.$inferInsert;
export type Referral = typeof referrals.$inferSelect;
export type NewReferral = typeof referrals.$inferInsert;
export type ReferralCommission = typeof referralCommissions.$inferSelect;
export type NewReferralCommission = typeof referralCommissions.$inferInsert;
export type SponsoredQuest = typeof sponsoredQuests.$inferSelect;
export type NewSponsoredQuest = typeof sponsoredQuests.$inferInsert;
export type SponsoredQuestApplication = typeof sponsoredQuestApplications.$inferSelect;
export type NewSponsoredQuestApplication = typeof sponsoredQuestApplications.$inferInsert;
export type CreatorBroadcast = typeof creatorBroadcasts.$inferSelect;
export type NewCreatorBroadcast = typeof creatorBroadcasts.$inferInsert;
export type CreatorSpotlight = typeof creatorSpotlights.$inferSelect;
export type NewCreatorSpotlight = typeof creatorSpotlights.$inferInsert;
export type MerchStore = typeof merchStores.$inferSelect;
export type NewMerchStore = typeof merchStores.$inferInsert;
export type MerchProduct = typeof merchProducts.$inferSelect;
export type NewMerchProduct = typeof merchProducts.$inferInsert;
export type MerchOrder = typeof merchOrders.$inferSelect;
export type NewMerchOrder = typeof merchOrders.$inferInsert;
export type ClassroomEnrolment = typeof classroomEnrolments.$inferSelect;
export type NewClassroomEnrolment = typeof classroomEnrolments.$inferInsert;
export type ClassroomQuiz = typeof classroomQuizzes.$inferSelect;
export type NewClassroomQuiz = typeof classroomQuizzes.$inferInsert;
export type ClassroomQuizQuestion = typeof classroomQuizQuestions.$inferSelect;
export type NewClassroomQuizQuestion = typeof classroomQuizQuestions.$inferInsert;
export type ClassroomQuizAttempt = typeof classroomQuizAttempts.$inferSelect;
export type NewClassroomQuizAttempt = typeof classroomQuizAttempts.$inferInsert;
export type LearningCertificate = typeof learningCertificates.$inferSelect;
export type NewLearningCertificate = typeof learningCertificates.$inferInsert;
export type Game = typeof games.$inferSelect;
export type NewGame = typeof games.$inferInsert;
export type GamePlay = typeof gamePlays.$inferSelect;
export type NewGamePlay = typeof gamePlays.$inferInsert;
export type GameBestScore = typeof gameBestScores.$inferSelect;
export type NewGameBestScore = typeof gameBestScores.$inferInsert;
export type GameChallenge = typeof gameChallenges.$inferSelect;
export type NewGameChallenge = typeof gameChallenges.$inferInsert;
export type GameChallengeRound = typeof gameChallengeRounds.$inferSelect;
export type NewGameChallengeRound = typeof gameChallengeRounds.$inferInsert;
export type GamePlayMilestone = typeof gamePlayMilestones.$inferSelect;
export type NewGamePlayMilestone = typeof gamePlayMilestones.$inferInsert;
export type GameMilestoneClaim = typeof gameMilestoneClaims.$inferSelect;
export type NewGameMilestoneClaim = typeof gameMilestoneClaims.$inferInsert;
export type SlugRedirect = typeof slugRedirects.$inferSelect;
export type NewSlugRedirect = typeof slugRedirects.$inferInsert;
export type ElderRequest = typeof elderRequests.$inferSelect;
export type NewElderRequest = typeof elderRequests.$inferInsert;
export type ElderMentorship = typeof elderMentorships.$inferSelect;
export type NewElderMentorship = typeof elderMentorships.$inferInsert;

// Announcements, Admin & Communication
export type AnnouncementModal = typeof announcementModals.$inferSelect;
export type NewAnnouncementModal = typeof announcementModals.$inferInsert;
export type AnnouncementBanner = typeof announcementBanners.$inferSelect;
export type NewAnnouncementBanner = typeof announcementBanners.$inferInsert;
export type UserModalView = typeof userModalViews.$inferSelect;
export type NewUserModalView = typeof userModalViews.$inferInsert;
export type UserBannerView = typeof userBannerViews.$inferSelect;
export type NewUserBannerView = typeof userBannerViews.$inferInsert;
export type UserAnnouncementRotation = typeof userAnnouncementRotation.$inferSelect;
export type NewUserAnnouncementRotation = typeof userAnnouncementRotation.$inferInsert;
export type AdminMessage = typeof adminMessages.$inferSelect;
export type NewAdminMessage = typeof adminMessages.$inferInsert;
export type AdminMessageReceipt = typeof adminMessageReceipts.$inferSelect;
export type NewAdminMessageReceipt = typeof adminMessageReceipts.$inferInsert;
export type TelegramDeliveryQueueEntry = typeof telegramDeliveryQueue.$inferSelect;
export type NewTelegramDeliveryQueueEntry = typeof telegramDeliveryQueue.$inferInsert;
export type FooterScript = typeof footerScripts.$inferSelect;
export type NewFooterScript = typeof footerScripts.$inferInsert;
export type AdminAction = typeof adminActions.$inferSelect;
export type NewAdminAction = typeof adminActions.$inferInsert;
export type AdminAuditLogEntry = typeof adminAuditLog.$inferSelect;
export type NewAdminAuditLogEntry = typeof adminAuditLog.$inferInsert;
export type AdminRole = typeof adminRoles.$inferSelect;
export type NewAdminRole = typeof adminRoles.$inferInsert;
export type SystemAlert = typeof systemAlerts.$inferSelect;
export type NewSystemAlert = typeof systemAlerts.$inferInsert;
export type ModerationAiEscalation = typeof moderationAiEscalations.$inferSelect;
export type NewModerationAiEscalation = typeof moderationAiEscalations.$inferInsert;

// Subscriptions & Plans
export type Subscription = typeof subscriptions.$inferSelect;
export type NewSubscription = typeof subscriptions.$inferInsert;
export type SubscriptionPlan = typeof subscriptionPlans.$inferSelect;
export type NewSubscriptionPlan = typeof subscriptionPlans.$inferInsert;
export type UserSubscription = typeof userSubscriptions.$inferSelect;
export type NewUserSubscription = typeof userSubscriptions.$inferInsert;
export type BusinessAccount = typeof businessAccounts.$inferSelect;
export type NewBusinessAccount = typeof businessAccounts.$inferInsert;

// Moderation & Reports
export type Report = typeof reports.$inferSelect;
export type NewReport = typeof reports.$inferInsert;
export type ModerationReport = typeof moderationReports.$inferSelect;
export type NewModerationReport = typeof moderationReports.$inferInsert;
export type ModerationAction = typeof moderationActions.$inferSelect;
export type NewModerationAction = typeof moderationActions.$inferInsert;

// Cultural Events & Community
export type PlatformEvent = typeof platformEvents.$inferSelect;
export type NewPlatformEvent = typeof platformEvents.$inferInsert;
export type FlashXpEvent = typeof flashXpEvents.$inferSelect;
export type NewFlashXpEvent = typeof flashXpEvents.$inferInsert;
export type MonthlyGiftDrop = typeof monthlyGiftDrops.$inferSelect;
export type NewMonthlyGiftDrop = typeof monthlyGiftDrops.$inferInsert;
export type SponsoredLeaderboardBanner = typeof sponsoredLeaderboardBanners.$inferSelect;
export type NewSponsoredLeaderboardBanner = typeof sponsoredLeaderboardBanners.$inferInsert;
export type CommunityNote = typeof communityNotes.$inferSelect;
export type NewCommunityNote = typeof communityNotes.$inferInsert;
export type CommunityNoteVote = typeof communityNoteVotes.$inferSelect;
export type NewCommunityNoteVote = typeof communityNoteVotes.$inferInsert;
export type PlatformCouncilMember = typeof platformCouncilMembers.$inferSelect;
export type NewPlatformCouncilMember = typeof platformCouncilMembers.$inferInsert;
export type PlatformCouncilIdea = typeof platformCouncilIdeas.$inferSelect;
export type NewPlatformCouncilIdea = typeof platformCouncilIdeas.$inferInsert;
export type CouncilInvitation = typeof councilInvitations.$inferSelect;
export type NewCouncilInvitation = typeof councilInvitations.$inferInsert;

// System
export type AuditLogRow = typeof auditLog.$inferSelect;
export type NewAuditLogRow = typeof auditLog.$inferInsert;
export type FeatureFlag = typeof featureFlags.$inferSelect;
export type NewFeatureFlag = typeof featureFlags.$inferInsert;
export type FailedWebhook = typeof failedWebhooks.$inferSelect;
export type NewFailedWebhook = typeof failedWebhooks.$inferInsert;
export type Refund = typeof refunds.$inferSelect;
export type NewRefund = typeof refunds.$inferInsert;
export type AutomatedActionLog = typeof automatedActionsLog.$inferSelect;
export type NewAutomatedActionLog = typeof automatedActionsLog.$inferInsert;

// ---------------------------------------------------------------------------
// Schema namespace — pass to drizzle(pool, { schema }) for relational queries
// ---------------------------------------------------------------------------

export const schema = {
  // Config
  xManifest,
  appSettings,
  cronState,

  // Users & Auth
  users,
  sessions,
  userPins,
  passwordResetTokens,
  userPushTokens,
  pushTickets,
  userBlocks,
  userEmailPreferences,
  dataExportRequests,
  telegramLoginStates,

  // Social Graph & Messaging
  friendships,
  follows,
  dmConversations,
  messages,
  dmConversationUnlocks,
  conversationScores,
  dmConversationScoreMilestones,
  dmScoreStickerUnlocks,
  groupChats,
  groupChatMembers,
  notifications,
  userMessages,
  userInactivityEvents,
  moments,
  momentViews,
  momentReactions,

  // Guilds
  guilds,
  guildMembers,
  guildWars,
  warContributions,
  guildWarMembers,
  guildQuests,
  guildQuestContributions,
  guildWarRematchTokens,
  guildApplications,
  guildInvites,
  guildTreasuryLedger,
  guildTierHistory,
  guildAlliances,
  guildAllianceMembers,
  allianceWars,
  guildContributionAlerts,
  guildMessages,

  // Rooms
  rooms,
  roomMembers,
  roomMessages,
  messageReactions,
  roomMessageReactions,
  roomMemberHighlights,
  roomModerationLog,
  roomSubscriptions,
  roomPromotions,
  roomMonthlyActiveUsers,
  roomPins,
  guildRooms,
  dropRoomReplays,
  brandedRooms,

  // Quests, Seasons & Progression
  questTemplates,
  userQuests,
  userQuestProgress,
  userQuestDecks,
  seasons,
  userSeasonPasses,
  seasonPassMilestones,
  userSeasonMilestoneClaims,
  seasonRankArchives,
  leaderboardSnapshots,
  leaderboardRankSnapshots,
  nemesisAssignments,
  nemesisChallenges,
  userBadges,
  userTitles,
  trackMilestoneUnlocks,
  rankUpEvents,
  xpEvents,
  hallOfFame,
  newMemberQuests,

  // Economy
  coinLedger,
  starLedger,
  xpLedger,
  payments,
  giftItems,
  giftTypes,
  gifts,
  storeItems,
  userCosmetics,
  userXpBoosters,
  stickerPacks,
  stickers,
  userStickerPacks,
  reactionSets,
  reactionSetItems,
  userReactionSets,
  auditDiscrepancies,
  failedXpAwards,

  // Creator Economy
  creatorEarnings,
  creatorPayouts,
  creatorBankAccounts,
  creatorWalletAddresses,
  payoutDeadLetterQueue,
  creatorKyc,
  referrals,
  referralCommissions,
  sponsoredQuests,
  sponsoredQuestApplications,
  creatorBroadcasts,
  creatorSpotlights,
  merchStores,
  merchProducts,
  merchOrders,
  classroomEnrolments,
  classroomQuizzes,
  classroomQuizQuestions,
  classroomQuizAttempts,
  learningCertificates,
  elderRequests,
  elderMentorships,

  // Announcements, Admin & Communication
  announcementModals,
  announcementBanners,
  userModalViews,
  userBannerViews,
  userAnnouncementRotation,
  adminMessages,
  adminMessageReceipts,
  telegramDeliveryQueue,
  footerScripts,
  adminActions,
  adminAuditLog,
  adminRoles,
  systemAlerts,
  moderationAiEscalations,

  // Subscriptions & Plans
  subscriptions,
  subscriptionPlans,
  userSubscriptions,
  businessAccounts,

  // Moderation & Reports
  reports,
  moderationReports,
  moderationActions,

  // Cultural Events & Community
  platformEvents,
  flashXpEvents,
  monthlyGiftDrops,
  sponsoredLeaderboardBanners,
  communityNotes,
  communityNoteVotes,
  platformCouncilMembers,
  platformCouncilIdeas,
  councilInvitations,

  // System
  auditLog,
  featureFlags,
  failedWebhooks,
  refunds,
  automatedActionsLog,
} as const;
