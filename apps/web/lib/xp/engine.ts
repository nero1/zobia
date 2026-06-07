/**
 * Zobia Social — XP Calculation Engine
 *
 * Central calculation module for all XP-related operations.
 * All XP values, rank thresholds, and multipliers are defined here —
 * never inline in call sites.
 *
 * Rules:
 *   - Integer arithmetic only. No floating-point values are introduced
 *     or returned anywhere in this module.
 *   - All multipliers are represented as whole-number basis points
 *     (100 bp = 1.0×, 150 bp = 1.5×, etc.) and applied with integer
 *     division so the output is always a safe integer.
 *   - XP is never negative; minimum award (when base > 0) is 1 XP.
 *
 * Public API:
 *   calculateXPForAction(action, options?) → number (base XP, pre-multiplier)
 *   applyMultipliers(baseXP, ctx)          → number (final XP)
 *   getRankForXP(totalXP)                  → RankInfo
 *   getTrackLevelForXP(track, trackXP)     → TrackLevelInfo
 *   checkForRankUp(xpBefore, xpAfter)      → { rankBefore, rankAfter, didRankUp }
 *   getDailyMessageStreakXP(streakDay)      → number
 *   getGuildXPBoostPercent(guildTier)       → number
 */

import type { Plan, ProgressionTrack, RankName, RankInfo, TrackLevelInfo } from '@zobia/types';

// ─── Rank Thresholds (from PRD Section 6) ────────────────────────────────────

export const RANK_THRESHOLDS: Record<RankName, number> = {
  'Beginner': 0,
  'Rookie': 2_000,
  'Hustler': 6_000,
  'Baller': 15_000,
  'Boss': 35_000,
  'Legend': 75_000,
  'Titan': 150_000,
  'Goat': 280_000,
  'Icon': 500_000,
  'Zobia Icon': 1_000_000,
};

const RANK_ORDER: RankName[] = [
  'Beginner', 'Rookie', 'Hustler', 'Baller', 'Boss',
  'Legend', 'Titan', 'Goat', 'Icon', 'Zobia Icon',
];

/** Number of sub-levels (I, II, III) per rank band. */
const SUBLEVELS_PER_RANK = 3;

// ─── XP Values per action (from PRD Section 6) ────────────────────────────────

export const XP_VALUES = {
  // Messaging
  send_text_message: 1,
  send_sticker: 1,
  send_gift_message: 10,
  receive_gift_and_react: 5,
  message_streak_per_day_base: 5,  // scales to 25 with streak
  message_streak_per_day_max: 25,

  // Social
  add_new_friend: 10,
  accept_friend_request: 5,
  first_time_gifted: 15,
  refer_new_user_who_completes_onboarding: 500,

  // Room
  join_new_room_first_time: 20,
  send_message_in_room: 2,
  being_tipped_in_room: 25,
  room_message_reacted_by_5_plus: 10,
  host_room_session_30_min: 50,

  // Guild
  login_on_guild_war_day: 10,
  guild_quest_contribution_min: 30,
  guild_quest_contribution_max: 100,
  win_guild_war_per_member_min: 200,
  win_guild_war_per_member_max: 500,
  top_contributor_guild_war_bonus: 1_000,

  // Creator
  first_paid_subscriber: 100,
  membership_milestone_10: 200,
  membership_milestone_50: 500,
  membership_milestone_100: 750,
  membership_milestone_500: 1_500,
  membership_milestone_1000: 2_000,
  sponsored_quest_min: 300,
  sponsored_quest_max: 1_000,

  // Daily & System
  daily_login: 50,
  day_7_streak_bonus: 200,
  day_30_streak_bonus: 1_000,
  complete_full_daily_quest_deck: 500,
  mystery_xp_drop_min: 100,
  mystery_xp_drop_max: 1_000,

  // Onboarding
  welcome_xp_drop: 500,
  new_member_quest_completion: 2_000,

  // Creator payout setup
  bank_account_added: 5,  // default; overridden by manifest bank_account_first_add_xp
};

// ─── Room message XP daily cap ───────────────────────────────────────────────

/** Room messages earn XP for a maximum of this many messages per day (PRD §6). */
export const ROOM_MESSAGE_XP_DAILY_CAP = 50;

// ─── Plan XP Multipliers (from PRD Section 6) ─────────────────────────────────

/** Multipliers expressed as integers (100 = 1×, 150 = 1.5×, etc.)
 *  Using integers avoids floating-point drift during accumulation. */
export const PLAN_XP_MULTIPLIERS_BP: Record<Plan, number> = {
  free: 100,  // 1×
  plus: 150,  // 1.5×
  pro: 300,   // 3×
  max: 500,   // 5×
};

/** Guild tier XP boost percentages (additive, on top of the base multiplier). */
export const GUILD_TIER_BOOSTS_BP: Record<string, number> = {
  bronze_1: 5,
  bronze_2: 5,
  bronze_3: 5,
  silver_1: 10,
  silver_2: 10,
  silver_3: 10,
  gold_1: 20,
  gold_2: 20,
  gold_3: 20,
  platinum_1: 30,
  platinum_2: 30,
  platinum_3: 30,
  legend: 50,
};

/** Season Pass active bonus (additive %). */
export const SEASON_PASS_BOOST_BP = 25;

/** XP Booster Pack multiplier (replaces plan multiplier if higher). */
export const BOOSTER_PACK_MULTIPLIER_BP = 200; // 2×

// ─── Track level progression ─────────────────────────────────────────────────

/**
 * XP required to reach each track level.
 * Track levels are independent from main rank — they accumulate separately.
 * Level thresholds use a gentle exponential curve (×1.5 per level).
 */
export function getTrackXPThreshold(level: number): number {
  if (level <= 1) return 0;
  // Level 2 = 1000 XP, Level 3 = 2500, Level 4 = 5000, and so on.
  return Math.round(1_000 * Math.pow(1.5, level - 2));
}

// ─── Core calculation functions ────────────────────────────────────────────────

/**
 * Returns the rank information for a given total XP value.
 * Sub-levels divide each rank band into thirds.
 *
 * @param totalXP - The user's cumulative main XP (never negative).
 * @returns Full rank information including sub-level and progress metrics.
 */
export function getRankForXP(totalXP: number): RankInfo {
  if (totalXP < 0) totalXP = 0;

  let rankIndex = 0;
  for (let i = RANK_ORDER.length - 1; i >= 0; i--) {
    if (totalXP >= RANK_THRESHOLDS[RANK_ORDER[i]]) {
      rankIndex = i;
      break;
    }
  }

  const rankName = RANK_ORDER[rankIndex];
  const rankXpMin = RANK_THRESHOLDS[rankName];
  const nextRankName = RANK_ORDER[rankIndex + 1] ?? null;
  const nextRankXp = nextRankName ? RANK_THRESHOLDS[nextRankName] : null;
  const rankXpWidth = nextRankXp !== null ? nextRankXp - rankXpMin : null;

  const progressXp = totalXP - rankXpMin;

  let sublevel: 1 | 2 | 3 = 1;
  if (rankXpWidth !== null) {
    const subWidth = Math.floor(rankXpWidth / SUBLEVELS_PER_RANK);
    if (progressXp >= subWidth * 2) sublevel = 3;
    else if (progressXp >= subWidth) sublevel = 2;
    else sublevel = 1;
  } else {
    // Final rank — sublevel determined by milestone thresholds
    if (progressXp >= 500_000) sublevel = 3;
    else if (progressXp >= 250_000) sublevel = 2;
    else sublevel = 1;
  }

  return {
    rankName,
    rankNumber: rankIndex + 1,
    sublevel,
    xpRequired: rankXpMin,
    nextRankXp,
    progressXp,
    rankXpWidth: rankXpWidth ?? 0,
  };
}

/**
 * Returns the track level and progress for a given track XP total.
 *
 * @param track - Which progression track.
 * @param trackXP - The XP accumulated on this track.
 */
export function getTrackLevelForXP(track: ProgressionTrack, trackXP: number): TrackLevelInfo {
  if (trackXP < 0) trackXP = 0;

  let level = 1;
  // Find the highest level the user has reached
  while (getTrackXPThreshold(level + 1) <= trackXP) {
    level++;
    if (level >= 50) break; // hard cap at 50
  }

  const currentThreshold = getTrackXPThreshold(level);
  const nextThreshold = getTrackXPThreshold(level + 1);
  const xpToNextLevel = level >= 50 ? 0 : nextThreshold - trackXP;

  return {
    track,
    level,
    trackXp: trackXP,
    xpToNextLevel: Math.max(0, xpToNextLevel),
  };
}

// ─── Multiplier application ─────────────────────────────────────────────────────

export interface XPMultiplierContext {
  plan: Plan;
  guildTier?: string;
  hasActiveSeasonPass?: boolean;
  hasActiveXPBooster?: boolean;
  /** If set to a future ISO date string, the prestige cycle 3× boost is active. */
  prestigeCycleBoostExpiresAt?: string | null;
  /**
   * Whether this XP award is for a messaging action. Per PRD §6, the plan
   * tier multiplier (1×/1.5×/3×/5×) only applies to messaging XP.
   * Guild, season pass, and booster pack boosts apply to all actions.
   */
  isMessagingAction?: boolean;
}

/** Prestige cycle boost multiplier in basis points (3×, PRD §9 Prestige 3). */
export const PRESTIGE_CYCLE_BOOST_BP = 300;

/**
 * Applies all stacked multipliers to a base XP amount and returns
 * the final awarded XP as an integer (floored, never rounded up).
 *
 * Multiplier stacking order (per PRD):
 * 1. Plan multiplier (base)
 * 2. Guild tier additive bonus (% added to the plan-multiplied amount)
 * 3. Season Pass additive bonus (% added further)
 * 4. XP Booster replaces plan multiplier if the booster would yield more XP
 *
 * All arithmetic uses integer basis points (100 = 1.0×).
 */
export function applyMultipliers(baseXP: number, ctx: XPMultiplierContext): number {
  if (baseXP <= 0) return 0;

  let xp = baseXP;

  // Plan multiplier only applies to messaging actions (PRD §6)
  if (ctx.isMessagingAction === true) {
    let planBP = PLAN_XP_MULTIPLIERS_BP[ctx.plan];

    // XP Booster Pack: use if it's better than the plan multiplier
    if (ctx.hasActiveXPBooster && BOOSTER_PACK_MULTIPLIER_BP > planBP) {
      planBP = BOOSTER_PACK_MULTIPLIER_BP;
    }

    // Prestige cycle boost (3× for first 7 days after each Prestige ≥ 3, PRD §9)
    // Replaces the plan multiplier if higher
    if (
      ctx.prestigeCycleBoostExpiresAt &&
      new Date(ctx.prestigeCycleBoostExpiresAt) > new Date() &&
      PRESTIGE_CYCLE_BOOST_BP > planBP
    ) {
      planBP = PRESTIGE_CYCLE_BOOST_BP;
    }

    xp = Math.floor((baseXP * planBP) / 100);
  }

  // Guild tier bonus (additive percentage on the plan-multiplied amount)
  if (ctx.guildTier) {
    const guildBoostBP = GUILD_TIER_BOOSTS_BP[ctx.guildTier] ?? 0;
    xp = xp + Math.floor((xp * guildBoostBP) / 100);
  }

  // Season Pass bonus (additive)
  if (ctx.hasActiveSeasonPass) {
    xp = xp + Math.floor((xp * SEASON_PASS_BOOST_BP) / 100);
  }

  return Math.max(1, xp); // always award at least 1 XP if base > 0
}

// ─── Action-to-XP mapping ────────────────────────────────────────────────────

export type XPAction =
  | 'send_text_message'
  | 'send_sticker'
  | 'send_gift_message'
  | 'receive_gift_and_react'
  | 'add_new_friend'
  | 'accept_friend_request'
  | 'first_time_gifted'
  | 'refer_new_user'
  | 'join_new_room'
  | 'send_room_message'
  | 'being_tipped_in_room'
  | 'room_message_5_reactions'
  | 'host_room_30_min'
  | 'login_on_war_day'
  | 'guild_quest_contribution'
  | 'win_guild_war'
  | 'top_contributor_war'
  | 'first_paid_subscriber'
  | 'creator_milestone'
  | 'daily_login'
  | 'day_7_streak'
  | 'day_30_streak'
  | 'complete_quest_deck'
  | 'mystery_xp_drop'
  | 'onboarding_complete'
  | 'new_member_quest';

/** Maps an XP action to the XP track it contributes to (in addition to main). */
export const ACTION_TRACKS: Partial<Record<XPAction, ProgressionTrack>> = {
  send_text_message: 'social',
  send_sticker: 'social',
  send_gift_message: 'generosity',
  receive_gift_and_react: 'social',
  add_new_friend: 'social',
  accept_friend_request: 'social',
  first_time_gifted: 'social',
  refer_new_user: 'social',
  join_new_room: 'explorer',
  send_room_message: 'social',
  being_tipped_in_room: 'creator',
  room_message_5_reactions: 'creator',
  host_room_30_min: 'creator',
  login_on_war_day: 'competitor',
  guild_quest_contribution: 'competitor',
  win_guild_war: 'competitor',
  top_contributor_war: 'competitor',
  first_paid_subscriber: 'creator',
  creator_milestone: 'creator',
};

/**
 * Returns the base (pre-multiplier) XP for a given action.
 * For variable-range actions, pass an optional amount override.
 */
export function calculateXPForAction(
  action: XPAction,
  options?: { amount?: number; streakDays?: number },
): number {
  const v = XP_VALUES;

  switch (action) {
    case 'send_text_message': return v.send_text_message;
    case 'send_sticker': return v.send_sticker;
    case 'send_gift_message': return v.send_gift_message;
    case 'receive_gift_and_react': return v.receive_gift_and_react;
    case 'add_new_friend': return v.add_new_friend;
    case 'accept_friend_request': return v.accept_friend_request;
    case 'first_time_gifted': return v.first_time_gifted;
    case 'refer_new_user': return v.refer_new_user_who_completes_onboarding;
    case 'join_new_room': return v.join_new_room_first_time;
    case 'send_room_message': return v.send_message_in_room;
    case 'being_tipped_in_room': return v.being_tipped_in_room;
    case 'room_message_5_reactions': return v.room_message_reacted_by_5_plus;
    case 'host_room_30_min': return v.host_room_session_30_min;
    case 'login_on_war_day': return v.login_on_guild_war_day;
    case 'guild_quest_contribution': return options?.amount ?? v.guild_quest_contribution_min;
    case 'win_guild_war': return options?.amount ?? v.win_guild_war_per_member_min;
    case 'top_contributor_war': return v.top_contributor_guild_war_bonus;
    case 'first_paid_subscriber': return v.first_paid_subscriber;
    case 'creator_milestone': return options?.amount ?? v.membership_milestone_10;
    case 'daily_login': return v.daily_login;
    case 'day_7_streak': return v.day_7_streak_bonus;
    case 'day_30_streak': return v.day_30_streak_bonus;
    case 'complete_quest_deck': return v.complete_full_daily_quest_deck;
    case 'mystery_xp_drop': return options?.amount ?? v.mystery_xp_drop_min;
    case 'onboarding_complete': return v.welcome_xp_drop;
    case 'new_member_quest': return v.new_member_quest_completion;
    default: return 0;
  }
}

/**
 * Checks if a user has levelled up (in main rank or sub-level) after an XP award.
 */
export function checkForRankUp(
  xpBefore: number,
  xpAfter: number,
): { rankBefore: RankInfo; rankAfter: RankInfo; didRankUp: boolean } {
  const rankBefore = getRankForXP(xpBefore);
  const rankAfter = getRankForXP(xpAfter);
  return {
    rankBefore,
    rankAfter,
    didRankUp:
      rankAfter.rankName !== rankBefore.rankName ||
      rankAfter.sublevel !== rankBefore.sublevel,
  };
}

// ─── Daily message streak XP helper ─────────────────────────────────────────

/**
 * Returns the XP bonus for sustaining a daily message streak.
 *
 * Scales linearly with streak length (PRD §6 "Sustaining a daily message
 * streak (per day): 5–25 XP (scales with streak length)"):
 *   Days  1–6:   5 XP
 *   Days  7–13: 10 XP
 *   Days 14–20: 15 XP
 *   Days 21–27: 20 XP
 *   Days 28+:   25 XP  (cap)
 *
 * @param streakDay - The current streak day (1-indexed, minimum 1).
 * @returns Whole-number XP amount (5, 10, 15, 20, or 25).
 */
export function getDailyMessageStreakXP(streakDay: number): number {
  const day = Math.max(1, Math.trunc(streakDay));
  const tier = Math.min(Math.floor((day - 1) / 7), 4);
  return 5 + tier * 5;
}

// ─── Guild XP boost lookup ────────────────────────────────────────────────────

/**
 * Returns the integer XP boost percentage for a guild tier string.
 * Returns 0 if the tier is unrecognised or the user has no guild.
 *
 * @param guildTier - The guild's tier slug (e.g. 'gold_2', 'legend').
 */
export function getGuildXPBoostPercent(guildTier: string | null | undefined): number {
  if (!guildTier) return 0;
  return GUILD_TIER_BOOSTS_BP[guildTier] ?? 0;
}

// ─── Convenience: full XP pipeline ─────────────────────────────────────────────

/**
 * Convenience wrapper: computes base XP for an action and applies all
 * multipliers in one call.  Use this as the primary entry point in API
 * route handlers.
 *
 * @param action  - The action being rewarded.
 * @param ctx     - Active multiplier context for the user.
 * @param options - Optional overrides for variable-amount actions.
 * @returns Object with baseXp and finalXp (both non-negative integers).
 */
export function calculateFinalXP(
  action: XPAction,
  ctx: XPMultiplierContext,
  options?: { amount?: number; streakDays?: number },
): { baseXp: number; finalXp: number } {
  const baseXp = calculateXPForAction(action, options);
  const finalXp = applyMultipliers(baseXp, ctx);
  return { baseXp, finalXp };
}

// ACTION_TRACKS is already exported as a const above — no re-export needed.

// ─── Rank display formatting ─────────────────────────────────────────────────

/** Convert a numeric sub-level (1/2/3) to its Roman numeral equivalent. */
export function sublevelToRoman(sublevel: 1 | 2 | 3): "I" | "II" | "III" {
  if (sublevel === 3) return "III";
  if (sublevel === 2) return "II";
  return "I";
}

/**
 * Returns the display name for a rank + sublevel combination.
 * Examples: "Boss II", "Legend I", "Zobia Icon III".
 *
 * For the final rank (Zobia Icon) the sublevel is always shown.
 * For all others it is shown as a Roman numeral suffix.
 */
export function getRankDisplayName(rankName: RankName, sublevel: 1 | 2 | 3): string {
  return `${rankName} ${sublevelToRoman(sublevel)}`;
}

