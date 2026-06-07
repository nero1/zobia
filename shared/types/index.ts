/**
 * Zobia Social — Shared TypeScript Types
 *
 * Consumed by both the Next.js web app (apps/web) and the
 * Expo mobile app (apps/expo).  These types mirror the database
 * schema exactly so that API responses are fully typed end-to-end
 * without extra transformation layers.
 *
 * Monetary values are always in the smallest currency unit
 * (kobo for NGN).  Balance fields that are BIGINT in the database
 * are surfaced as number here — JavaScript's number is safe up to
 * 2^53 − 1, which covers all realistic coin and kobo values.
 */

// ─── Plan types ─────────────────────────────────────────────────────────────

export type Plan = 'free' | 'plus' | 'pro' | 'max';

export type CreatorTier = 'rookie' | 'rising' | 'verified' | 'elite' | 'icon';

export type GuildTier =
  | 'bronze_1' | 'bronze_2' | 'bronze_3'
  | 'silver_1' | 'silver_2' | 'silver_3'
  | 'gold_1' | 'gold_2' | 'gold_3'
  | 'platinum_1' | 'platinum_2' | 'platinum_3'
  | 'legend';

export type RankName =
  | 'Beginner'
  | 'Rookie'
  | 'Hustler'
  | 'Baller'
  | 'Boss'
  | 'Legend'
  | 'Titan'
  | 'Goat'
  | 'Icon'
  | 'Zobia Icon';

export type ProgressionTrack =
  | 'main'
  | 'social'
  | 'creator'
  | 'competitor'
  | 'generosity'
  | 'knowledge'
  | 'explorer';

/** Alias kept for compatibility with the XP engine. */
export type XPTrack = ProgressionTrack;

/** Rank sub-level within a rank band (I, II, III). */
export type RankSublevel = 1 | 2 | 3;

/** Structured result returned by getRankForXP(). */
export interface RankInfo {
  rankName: RankName;
  /** 1-based rank number (Beginner = 1, Zobia Icon = 10). */
  rankNumber: number;
  sublevel: RankSublevel;
  /** Minimum XP required to enter this rank. */
  xpRequired: number;
  /** Minimum XP required for the next rank. Null at the final rank. */
  nextRankXp: number | null;
  /** XP accumulated within the current rank band. */
  progressXp: number;
  /** Total XP span of the current rank band. */
  rankXpWidth: number;
}

/** Structured result returned by getTrackLevelForXP(). */
export interface TrackLevelInfo {
  track: ProgressionTrack;
  level: number;
  trackXp: number;
  /** XP still needed to reach the next level. */
  xpToNextLevel: number;
}

// ─── User ────────────────────────────────────────────────────────────────────

export interface User {
  id: string;
  username: string;
  displayName: string;
  email?: string;
  avatarEmoji: string;
  bio?: string;
  city?: string;
  country: string;
  locale: string;

  // Auth
  googleId?: string;
  telegramId?: string;
  isEmailVerified: boolean;
  twoFaEnabled: boolean;

  // Status
  plan: Plan;
  isAdmin: boolean;
  isModerator: boolean;
  isCreator: boolean;
  creatorTier: CreatorTier;
  isVerified: boolean;

  // Trust & Safety
  trustScore: number;
  isSuspended: boolean;
  suspendedUntil?: string;
  isBanned: boolean;
  banType?: 'temporary' | 'permanent';
  bannedUntil?: string;

  // XP & Rank
  xpTotal: number;
  legacyScore: number;
  rankName: RankName;
  rankLevel: number;
  rankSublevel: number; // 1=I, 2=II, 3=III
  prestigeCount: number;

  // Track XP
  xpSocial: number;
  xpCreator: number;
  xpCompetitor: number;
  xpGenerosity: number;
  xpKnowledge: number;
  xpExplorer: number;

  // Track Levels
  levelSocial: number;
  levelCreator: number;
  levelCompetitor: number;
  levelGenerosity: number;
  levelKnowledge: number;
  levelExplorer: number;

  // Economy
  coinBalance: number;
  starBalance: number;

  // Streaks
  loginStreak: number;
  longestStreak: number;
  lastLoginAt?: string;
  lastActiveAt: string;

  // Metadata
  dateOfBirth?: string;
  onboardingCompleted: boolean;
  newMemberQuestCompleted: boolean;
  referralCode?: string;
  referredByUserId?: string;

  // "Playing since" for profile display
  createdAt: string;
  updatedAt: string;
}

/** Public profile — subset of User shown to other users */
export interface PublicProfile {
  id: string;
  username: string;
  displayName: string;
  avatarEmoji: string;
  bio?: string;
  city?: string;
  country: string;
  plan: Plan;
  isCreator: boolean;
  creatorTier: CreatorTier;
  isVerified: boolean;
  rankName: RankName;
  rankLevel: number;
  rankSublevel: number;
  prestigeCount: number;
  xpTotal: number;
  legacyScore: number;
  levelSocial: number;
  levelCreator: number;
  levelCompetitor: number;
  levelGenerosity: number;
  levelKnowledge: number;
  levelExplorer: number;
  loginStreak: number;
  createdAt: string;
}

// ─── Message ─────────────────────────────────────────────────────────────────

export type MessageType = 'text' | 'sticker' | 'gif' | 'gift' | 'moment' | 'system' | 'broadcast';

export interface Message {
  id: string;
  senderId: string;
  sender?: PublicProfile;
  recipientId?: string;
  roomId?: string;
  groupChatId?: string;
  messageType: MessageType;
  content?: string;
  mediaUrl?: string;
  metadata?: Record<string, unknown>;
  isDeleted: boolean;
  coinCost: number;
  replyCountFromRecipient: number;
  reactions?: MessageReaction[];
  createdAt: string;
  updatedAt: string;
}

export interface MessageReaction {
  id: string;
  messageId: string;
  userId: string;
  user?: Pick<PublicProfile, 'id' | 'username' | 'avatarEmoji'>;
  emoji: string;
  isCustom: boolean;
  createdAt: string;
}

// ─── Room ─────────────────────────────────────────────────────────────────────

export type RoomType = 'free_open' | 'vip' | 'drop' | 'tipping' | 'classroom' | 'guild';

export interface Room {
  id: string;
  creatorId: string;
  creator?: PublicProfile;
  name: string;
  description?: string;
  roomType: RoomType;
  category?: string;
  city?: string;
  coverImageUrl?: string;
  isPublic: boolean;
  maxMembers?: number;
  memberCount: number;
  subscriptionPriceKobo?: number;
  entryFeeKobo?: number;
  curriculum?: RoomCurriculum;
  startsAt?: string;
  endsAt?: string;
  guildId?: string;
  totalMessages: number;
  healthScore: number;
  isActive: boolean;
  isFeatured: boolean;
  isSponsored: boolean;
  sponsoredBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RoomCurriculum {
  modules: RoomModule[];
  totalDuration?: number;
}

export interface RoomModule {
  id: string;
  title: string;
  description?: string;
  content?: string;
  order: number;
  startsAt?: string;
}

// ─── Guild ─────────────────────────────────────────────────────────────────────

export type GuildRole = 'captain' | 'veteran' | 'recruiter' | 'member';
export type GuildRecruitmentType = 'open' | 'approval' | 'invite_only';

export interface Guild {
  id: string;
  name: string;
  crestEmoji: string;
  description?: string;
  city?: string;
  country: string;
  captainId: string;
  captain?: PublicProfile;
  tier: GuildTier;
  guildXp: number;
  memberCount: number;
  treasuryBalance: number;
  treasuryCap: number;
  recruitmentType: GuildRecruitmentType;
  warsWon: number;
  warsLost: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface GuildMember {
  id: string;
  guildId: string;
  userId: string;
  user?: PublicProfile;
  role: GuildRole;
  contributionScore: number;
  warPointsTotal: number;
  joinedAt: string;
}

export interface GuildWar {
  id: string;
  challengerGuildId: string;
  challengerGuild?: Pick<Guild, 'id' | 'name' | 'crestEmoji' | 'tier'>;
  defenderGuildId: string;
  defenderGuild?: Pick<Guild, 'id' | 'name' | 'crestEmoji' | 'tier'>;
  status: 'active' | 'final_hour' | 'completed' | 'cancelled';
  challengerPoints: number;
  defenderPoints: number;
  winnerGuildId?: string;
  startsAt: string;
  endsAt: string;
  finalHourStartsAt: string;
  createdAt: string;
}

// ─── Quest ────────────────────────────────────────────────────────────────────

export type QuestType = 'messages' | 'room_join' | 'gift' | 'login_streak' | 'guild_quest' | 'xp_meta';

export interface QuestTemplate {
  id: string;
  title: string;
  description: string;
  questType: QuestType;
  targetValue: number;
  xpReward: number;
  coinReward: number;
  track: ProgressionTrack;
  minPlan: Plan;
  isActive: boolean;
  createdAt: string;
}

export interface UserQuest {
  id: string;
  userId: string;
  questTemplateId: string;
  template?: QuestTemplate;
  date: string;
  progress: number;
  target: number;
  isCompleted: boolean;
  completedAt?: string;
  xpReward: number;
  coinReward: number;
  createdAt: string;
}

// ─── Season ────────────────────────────────────────────────────────────────────

export interface Season {
  id: string;
  name: string;
  theme?: string;
  description?: string;
  seasonNumber: number;
  startsAt: string;
  endsAt: string;
  passPriceCoins: number;
  isActive: boolean;
  createdAt: string;
}

export interface SeasonPass {
  id: string;
  userId: string;
  seasonId: string;
  season?: Season;
  tier: 'free' | 'paid';
  purchasedAt: string;
}

// ─── Gift ─────────────────────────────────────────────────────────────────────

export interface GiftItem {
  id: string;
  name: string;
  emoji: string;
  coinPrice: number;
  tier: 1 | 2 | 3;
  animationUrl?: string;
  isLimitedEdition: boolean;
  seasonId?: string;
  isRetired: boolean;
  isActive: boolean;
  createdAt: string;
}

export interface Gift {
  id: string;
  senderId: string;
  sender?: PublicProfile;
  recipientId: string;
  recipient?: PublicProfile;
  roomId?: string;
  giftItemId: string;
  giftItem?: GiftItem;
  coinValue: number;
  animationUrl?: string;
  messageId?: string;
  createdAt: string;
}

// ─── Coin Ledger ──────────────────────────────────────────────────────────────

export type CoinTransactionType =
  | 'purchase'
  | 'quest_reward'
  | 'gift_sent'
  | 'gift_received'
  | 'dm_cost'
  | 'subscription'
  | 'payout'
  | 'admin_grant'
  | 'refund'
  | 'ad_reward'
  | 'booster_pack'
  | 'monthly_plan_bonus'
  | 'creator_coin_conversion'
  | 'comeback_bonus_reserved'
  | 'comeback_bonus_claimed'
  | 'referral_bonus'
  | 'room_subscription'
  | 'gift_refund'
  | 'daily_login'
  | 'test_credit'
  | 'test_debit'
  | 'booster_purchase'
  | 'merch_purchase'
  | 'brand_broadcast_bonus'
  | 'guild_creation'
  | 'guild_donation'
  | 'prestige_reward'
  | 'season_reward'
  | 'sponsored_quest_payout'
  | 'war_reward'
  | 'welcome_bonus'
  | 'onboarding_welcome'
  | 'season_pass_purchase'
  | 'room_power'
  | 'referral_commission'
  | 'comeback_bonus_expired'
  | 'replay_access'
  | 'cosmetic_purchase'
  | 'friend_gift'
  | 'gift_received'
  | 'star_purchase'
  | 'payout_request'
  | 'coin_balance_adjustment'
  | 'subscription_bonus'
  | 'iap_purchase'
  | 'coin_purchase'
  | 'withdraw_coins'
  | 'merch_sale'
  | 'referral_qualifying_action'
  | 'room_promotion'
  | 'season_milestone'
  | 'season_pass_gift'
  | 'sticker_pack';

export interface CoinLedgerEntry {
  id: string;
  userId?: string;
  user_id?: string;
  amount: number; // positive = credit, negative = debit
  balanceBefore?: number;
  balance_before?: number;
  balanceAfter?: number;
  balance_after?: number;
  transactionType?: CoinTransactionType;
  transaction_type?: CoinTransactionType;
  referenceId?: string;
  reference_id?: string;
  description?: string;
  metadata?: Record<string, unknown>;
  createdAt?: string;
  created_at?: string;
}

// ─── XP Ledger ────────────────────────────────────────────────────────────────

export type XPSource =
  | 'message'
  | 'daily_login'
  | 'quest'
  | 'gift'
  | 'guild_war'
  | 'room'
  | 'friend'
  | 'referral'
  | 'mystery_drop'
  | 'onboarding'
  | 'streak_bonus'
  | 'room_host'
  | 'creator_milestone';

export interface XPLedgerEntry {
  id: string;
  userId: string;
  amount: number;
  track: ProgressionTrack;
  source: XPSource;
  referenceId?: string;
  multiplier: number;
  baseAmount: number;
  createdAt: string;
}

// ─── Payment ──────────────────────────────────────────────────────────────────

export type PaymentProvider = 'paystack' | 'dodopayments' | 'google_play';
export type PaymentStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'refunded';
export type PaymentType = 'coin_purchase' | 'subscription' | 'season_pass' | 'booster_pack' | 'room_entry';

export interface Payment {
  id: string;
  userId: string;
  paymentType: PaymentType;
  amountKobo: number;
  currency: string;
  provider: PaymentProvider;
  providerReference?: string;
  status: PaymentStatus;
  coinsCredited?: number;
  idempotencyKey?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  completedAt?: string;
}

// ─── Creator ──────────────────────────────────────────────────────────────────

export type CreatorEarningSource =
  | 'gift'
  | 'subscription'
  | 'drop_entry'
  | 'classroom_enrolment'
  | 'sponsored_quest'
  | 'merch'
  | 'creator_fund';

export interface CreatorEarning {
  id: string;
  creatorId: string;
  sourceType: CreatorEarningSource;
  grossAmountKobo: number;
  platformFeeKobo: number;
  netAmountKobo: number;
  referenceId?: string;
  paidOut: boolean;
  payoutId?: string;
  createdAt: string;
}

export type PayoutStatus =
  | 'pending'
  | 'awaiting_approval'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'rejected'
  | 'reversed'
  | 'cancelled';

export interface CreatorPayout {
  id: string;
  creatorId: string;
  grossKobo: number;
  netKobo: number;
  platformFeeKobo: number;
  payoutMethod: PayoutMethod;
  region: PayoutRegion;
  status: PayoutStatus;
  bankAccountSnapshot: BankAccountSnapshot | null;
  walletAddressSnapshot: string | null;
  retryCount: number;
  lastRetryAt: string | null;
  appealReason: string | null;
  appealStatus: AppealStatus | null;
  appealSubmittedAt: string | null;
  rejectionReason: string | null;
  providerReference: string | null;
  createdAt: string;
  completedAt: string | null;
}

// ─── Announcement ──────────────────────────────────────────────────────────────

export interface AnnouncementModal {
  id: string;
  title: string;
  content: string;
  contentType: 'html' | 'text';
  isActive: boolean;
  startsAt?: string;
  endsAt?: string;
  targetPlans: Plan[];
  targetRoles: string[];
  displayOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface AnnouncementBanner {
  id: string;
  content: string;
  contentType: 'html' | 'text';
  isActive: boolean;
  startsAt?: string;
  endsAt?: string;
  targetPlans: Plan[];
  targetRoles: string[];
  displayOrder: number;
  createdAt: string;
  updatedAt: string;
}

// ─── Report ────────────────────────────────────────────────────────────────────

export type ReportType =
  | 'harassment'
  | 'spam'
  | 'fraud'
  | 'sexual_content'
  | 'impersonation'
  | 'hate_speech'
  | 'other';

export type ReportStatus =
  | 'pending'
  | 'under_review'
  | 'resolved_action'
  | 'resolved_dismissed'
  | 'escalated';

export interface Report {
  id: string;
  reporterId: string;
  reportedUserId?: string;
  reportedMessageId?: string;
  reportedRoomId?: string;
  reportedGuildId?: string;
  reportType: ReportType;
  description?: string;
  aiCategory?: string;
  aiConfidence?: number;
  status: ReportStatus;
  moderatorId?: string;
  resolutionNote?: string;
  createdAt: string;
  resolvedAt?: string;
}

// ─── Nemesis ──────────────────────────────────────────────────────────────────

export interface NemesisAssignment {
  id: string;
  userId: string;
  nemesisUserId: string;
  nemesisUser?: PublicProfile;
  track: ProgressionTrack;
  assignedAt: string;
  expiresAt: string;
  isActive: boolean;
}

// ─── Referral ─────────────────────────────────────────────────────────────────

export interface Referral {
  id: string;
  referrerId: string;
  referredId: string;
  tier: 1 | 2;
  qualified: boolean;
  coinReward?: number;
  xpReward?: number;
  rewardedAt?: string;
  createdAt: string;
}

// ─── Subscription ──────────────────────────────────────────────────────────────

export interface Subscription {
  id: string;
  userId: string;
  plan: Exclude<Plan, 'free'>;
  billingPeriod: 'monthly' | 'annual';
  status: 'active' | 'cancelled' | 'expired' | 'paused';
  startsAt: string;
  endsAt: string;
  autoRenew: boolean;
  provider?: string;
  providerSubscriptionId?: string;
  createdAt: string;
  updatedAt: string;
}

// ─── x_manifest ───────────────────────────────────────────────────────────────

export interface Manifest {
  minimumAge: number;
  captchaProvider: 'recaptcha' | 'turnstile';
  authGoogleEnabled: boolean;
  authTelegramEnabled: boolean;
  featureNemesis: boolean;
  featureGuildWars: boolean;
  featureClassrooms: boolean;
  featureCommunityNotes: boolean;
  featureStarDirectPurchase: boolean;
  featureCreatorMerch: boolean;
  featurePlatformCouncil: boolean;
  featureAllianceSystem: boolean;
  featureBusinessAccounts: boolean;
  featureAdmobAds: boolean;
  featureRewardedAds: boolean;
  pwaWebEnabled: boolean;
  pwaAndroidEnabled: boolean;
  pwaIosEnabled: boolean;
  paymentProviderNigeria: 'paystack' | 'dodopayments';
  paymentProviderInternational: 'dodopayments';
  payoutProviderNigeria: 'paystack' | 'dodopayments';
  payoutProviderInternational: 'dodopayments';
  coinToCashRate: number;
  payoutThresholdKobo: number;
  payoutManualApprovalThresholdKobo: number;
  payoutLowBalanceAlertKobo: number;
  vipRoomMinSubscriptionKobo: number;
  vipRoomMaxSubscriptionKobo: number;
  seasonPassPriceCoins: number;
  creatorPlatformFeePercent: number;
  dmCoinCostFree: number;
  dmCoinCostPlus: number;
  emailAllEnabled: boolean;
  emailNonCriticalEnabled: boolean;
  announcementModalDisplayMode: 'serial' | 'random';
  announcementBannerDisplayMode: 'serial' | 'random';
  deepLinkBaseUrl: string;
  admobAppId: string;
  admobBannerUnitId: string;
  admobInterstitialUnitId: string;
  admobRewardedUnitId: string;
  gifProvider: 'giphy' | 'tenor';
  cronExternalEnabled: boolean;
  aiModerationEnabled: boolean;
}

// ─── Star Ledger ──────────────────────────────────────────────────────────────

export interface StarLedgerEntry {
  id: string;
  userId?: string;
  user_id?: string;
  /** Positive = credit, negative = debit. */
  amount: number;
  balanceBefore?: number;
  balance_before?: number;
  balanceAfter?: number;
  balance_after?: number;
  transactionType?: string;
  transaction_type?: string;
  referenceId?: string;
  reference_id?: string;
  description?: string;
  createdAt?: string;
  created_at?: string;
}

// ─── Friendship / Follow ──────────────────────────────────────────────────────

export type FriendshipStatus = 'pending' | 'accepted' | 'blocked';

export interface Friendship {
  id: string;
  requesterId: string;
  requester?: PublicProfile;
  addresseeId: string;
  addressee?: PublicProfile;
  status: FriendshipStatus;
  createdAt: string;
  updatedAt: string;
}

export interface Follow {
  id: string;
  followerId: string;
  follower?: PublicProfile;
  followingId: string;
  following?: PublicProfile;
  createdAt: string;
}

// ─── Group Chat ───────────────────────────────────────────────────────────────

export type GroupChatTag = 'Study Group' | 'Crew' | 'Business';

export interface GroupChat {
  id: string;
  name: string;
  creatorId: string;
  creator?: PublicProfile;
  avatarEmoji: string;
  tag?: GroupChatTag;
  memberCount: number;
  maxMembers: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface GroupChatMember {
  id: string;
  groupChatId: string;
  userId: string;
  user?: PublicProfile;
  role: 'admin' | 'member';
  joinedAt: string;
}

// ─── API Response ──────────────────────────────────────────────────────────────

/**
 * Standard API response envelope.
 * All Zobia API endpoints return this shape.
 * @template T The payload type on success.
 */
export interface ApiResponse<T> {
  success: boolean;
  data: T | null;
  error: ApiError | null;
  /** Server-side request ID for support / logging correlation. */
  requestId?: string;
}

export interface ApiError {
  code: string;
  message: string;
  /** Field-level validation errors, keyed by field name. */
  fields?: Record<string, string[]>;
}

/**
 * Cursor-based paginated list response.
 * @template T The item type in the list.
 */
export interface PaginatedResponse<T> {
  items: T[];
  /** Total item count (may be approximate for large result sets). */
  total: number;
  /** Opaque cursor to pass as `after` on the next request. Null if exhausted. */
  nextCursor: string | null;
  hasMore: boolean;
}

/** Convenience alias: a paginated result wrapped in the standard envelope. */
export type PaginatedApiResponse<T> = ApiResponse<PaginatedResponse<T>>;

// ─── Admin ────────────────────────────────────────────────────────────────────

export interface AdminOverview {
  users: {
    dau: number;
    wau: number;
    mau: number;
    newToday: number;
    newThisWeek: number;
    totalRegistered: number;
  };
  revenue: {
    today: number;
    thisWeek: number;
    thisMonth: number;
    subscriptions: number;
    coinSales: number;
    creatorFees: number;
  };
  platform: {
    activeRooms: number;
    activeGuilds: number;
    activeGuildWars: number;
    moderationQueueDepth: number;
    coinsInCirculation: number;
    pendingPayouts: number;
  };
}

export interface AdminMessage {
  id: string;
  senderAdminId: string;
  subject?: string;
  body: string;
  broadcastType: 'direct' | 'all' | 'by_plan' | 'by_role';
  targetPlans?: Plan[];
  targetRoles?: string[];
  targetUserIds?: string[];
  recipientCount: number;
  deliveredCount: number;
  createdAt: string;
}

// ─── Presence ─────────────────────────────────────────────────────────────────

export type PresenceStatus = 'online' | 'recently_active' | 'offline';

export interface UserPresence {
  userId: string;
  status: PresenceStatus;
  lastActiveAt: string;
}

// ─── Stickers ────────────────────────────────────────────────────────────────

export interface StickerPack {
  id: string; name: string; description: string | null; coverEmoji: string;
  packType: 'free' | 'earnable' | 'premium'; coinPrice: number;
  unlockCondition: string | null; isActive: boolean; createdAt: string; unlocked?: boolean;
}
export interface Sticker { id: string; packId: string; name: string; emoji: string; imageUrl: string | null; position: number; }

// ─── Moments ─────────────────────────────────────────────────────────────────

export interface Moment {
  id: string; userId: string; username: string; avatarEmoji: string; avatarUrl: string | null;
  content: string; contentType: 'text' | 'image' | 'video'; mediaUrl: string | null;
  caption: string | null; viewCount: number; expiresAt: string; createdAt: string; hasViewed?: boolean;
}

// ─── Guild Alliance ───────────────────────────────────────────────────────────

export interface GuildAlliance {
  id: string; name: string; description: string | null; foundedBy: string;
  isActive: boolean; warsWon: number; createdAt: string;
  memberGuilds?: Array<{ guildId: string; guildName: string; joinedAt: string }>;
}

// ─── Business Account ─────────────────────────────────────────────────────────

export type BusinessTier = 'starter' | 'growth' | 'enterprise';
export interface BusinessAccount {
  id: string; userId: string; businessName: string; businessType: string | null;
  tier: BusinessTier; verified: boolean; status: 'active' | 'suspended' | 'cancelled'; createdAt: string;
}

// ─── Community Notes ──────────────────────────────────────────────────────────

export type CommunityNoteStatus = 'needs_review' | 'shown' | 'hidden';
export type CommunityNoteTargetType = 'message' | 'room' | 'user' | 'guild';
export interface CommunityNote {
  id: string; targetType: CommunityNoteTargetType; targetId: string; authorId: string;
  content: string; helpfulVotes: number; unhelpfulVotes: number; status: CommunityNoteStatus; createdAt: string;
}

// ─── Platform Council ─────────────────────────────────────────────────────────

export interface CouncilMember {
  id: string; userId: string; username: string; avatarEmoji: string; cycleMonth: string; legacyScore: number; joinedAt: string;
}
export interface CouncilIdea {
  id: string; authorId: string; title: string; description: string;
  votes: number; status: 'open' | 'selected' | 'implemented' | 'rejected'; createdAt: string;
}

// ─── Merch Store ─────────────────────────────────────────────────────────────

export interface MerchStore { id: string; creatorId: string; name: string; description: string | null; isActive: boolean; createdAt: string; }
export interface MerchProduct {
  id: string; storeId: string; name: string; description: string | null;
  productType: 'digital' | 'physical' | 'course_material'; priceKobo: number;
  imageUrl: string | null; isActive: boolean; stock: number | null; createdAt: string;
}

// ─── Classroom Quizzes ────────────────────────────────────────────────────────

export interface ClassroomQuiz {
  id: string; roomId: string; creatorId: string; title: string; description: string | null;
  xpReward: number; passScore: number; isActive: boolean; createdAt: string;
}
export interface ClassroomQuizQuestion {
  id: string; quizId: string; question: string;
  optionA: string; optionB: string; optionC: string; optionD: string;
  correctOption: 'a' | 'b' | 'c' | 'd'; position: number;
}

// ─── Drop Room Replays ────────────────────────────────────────────────────────

export interface DropRoomReplay {
  id: string; roomId: string; creatorId: string; title: string;
  highlights: Array<{ messageId: string; content: string; sender: string; timestamp: string }>;
  replayFeeKobo: number; isPublished: boolean; publishedAt: string | null; createdAt: string;
}

// ─── Creator Payout Accounts ─────────────────────────────────────────────────

export type PayoutMethod = 'bank_transfer' | 'coins' | 'crypto';
export type PayoutRegion = 'nigeria' | 'global';
export type AppealStatus = 'pending' | 'resolved' | 'dismissed';

export interface CreatorBankAccount {
  id: string;
  bankName: string;
  bankCode: string;
  accountName: string;
  accountNumberLast4: string;
  hasAccount: boolean;
  createdAt: string;
}

export interface CreatorWalletAddress {
  network: string;
  currency: string;
  addressMasked: string;
  hasWallet: boolean;
}

export interface PayoutConfig {
  bankTransferEnabled: boolean;
  coinsEnabled: boolean;
  cryptoEnabled: boolean;
  isManualMode: boolean;
  region: PayoutRegion;
}

export interface BankAccountSnapshot {
  bank_name: string;
  account_name: string;
  last4: string;
  recipient_code: string;
}

// ─── Platform Events ─────────────────────────────────────────────────────────

export type PlatformEventType = 'cultural' | 'season_launch' | 'flash_xp' | 'guild_war_event' | 'mystery_drop' | 'platform';
export interface PlatformEvent {
  id: string; name: string; description: string | null; eventType: PlatformEventType;
  xpMultiplier: number; coinBonusPct: number; startsAt: string; endsAt: string;
  isActive: boolean; targetCities: string[] | null; metadata: Record<string, unknown> | null; createdAt: string;
}

// ─── Sponsored Quests ────────────────────────────────────────────────────────

export interface SponsoredQuest {
  id: string; brandName: string; title: string; description: string;
  targetAction: string; targetValue: number; rewardCoins: number;
  creatorPayoutKobo: number; minCreatorTier: string;
  startsAt: string | null; endsAt: string | null; isActive: boolean; maxCreators: number; createdAt: string;
}
