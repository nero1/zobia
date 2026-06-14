/**
 * Unit tests for the XP calculation engine.
 *
 * All tests verify pure-function behaviour — no database required.
 * The @/lib/db module is mocked at the module boundary.
 */

jest.mock('@/lib/db', () => ({
  db: {
    query: jest.fn(),
    transaction: jest.fn(),
    healthCheck: jest.fn(),
    close: jest.fn(),
  },
}));

import {
  getRankForXP,
  getTrackLevelForXP,
  applyMultipliers,
  calculateXPForAction,
  calculateFinalXP,
  checkForRankUp,
  getDailyMessageStreakXP,
  getGuildXPBoostPercent,
  RANK_THRESHOLDS,
  PLAN_XP_MULTIPLIERS_BP,
  XP_VALUES,
} from '@/lib/xp/engine';

// ─── getRankForXP ─────────────────────────────────────────────────────────────

describe('getRankForXP', () => {
  it('returns Beginner for 0 XP', () => {
    const result = getRankForXP(0);
    expect(result.rankName).toBe('Beginner');
  });

  it('returns Beginner for 500 XP (still within Beginner range)', () => {
    // Rookie starts at 2_000, so 500 is still Beginner
    const result = getRankForXP(500);
    expect(result.rankName).toBe('Beginner');
  });

  it('returns Beginner for 1999 XP (one below Rookie threshold)', () => {
    const result = getRankForXP(1999);
    expect(result.rankName).toBe('Beginner');
  });

  it('returns Rookie when crossing the 2000 XP threshold', () => {
    const result = getRankForXP(2000);
    expect(result.rankName).toBe('Rookie');
  });

  it('returns Icon for 500_000 XP', () => {
    const result = getRankForXP(500_000);
    expect(result.rankName).toBe('Icon');
  });

  it('returns Zobia Icon for 1_000_000 XP', () => {
    const result = getRankForXP(1_000_000);
    expect(result.rankName).toBe('Zobia Icon');
  });

  it('clamps negative XP to 0 and returns Beginner', () => {
    const result = getRankForXP(-100);
    expect(result.rankName).toBe('Beginner');
  });

  it('includes correct rankNumber (1-indexed)', () => {
    expect(getRankForXP(0).rankNumber).toBe(1);
    expect(getRankForXP(2000).rankNumber).toBe(2); // Rookie
    expect(getRankForXP(500_000).rankNumber).toBe(9); // Icon
  });

  it('sets progressXp relative to current rank min', () => {
    const result = getRankForXP(2500);
    // Rookie starts at 2000, so progress = 500
    expect(result.progressXp).toBe(500);
  });

  it('sets nextRankXp for non-final ranks', () => {
    const result = getRankForXP(0);
    expect(result.nextRankXp).toBe(RANK_THRESHOLDS['Rookie']);
  });

  it('sets nextRankXp to null for the final rank', () => {
    const result = getRankForXP(1_000_000);
    expect(result.nextRankXp).toBeNull();
  });

  it('returns sublevel 1 at rank entry, sublevel 3 at upper third', () => {
    // Beginner band: 0–1999 (width 2000), sub-width = 666
    const sl1 = getRankForXP(0);
    expect(sl1.sublevel).toBe(1);

    // sub-width * 2 = 1333 → sublevel 3
    const sl3 = getRankForXP(1333);
    expect(sl3.sublevel).toBe(3);
  });
});

// ─── getTrackLevelForXP ───────────────────────────────────────────────────────

describe('getTrackLevelForXP', () => {
  it('returns level 1 for 0 XP', () => {
    const result = getTrackLevelForXP('social', 0);
    expect(result.level).toBe(1);
    expect(result.track).toBe('social');
  });

  it('returns level 1 for XP below the level-2 threshold', () => {
    // Level 2 requires 1000 XP
    const result = getTrackLevelForXP('creator', 999);
    expect(result.level).toBe(1);
  });

  it('returns level 2 at exactly 1000 XP', () => {
    const result = getTrackLevelForXP('creator', 1000);
    expect(result.level).toBe(2);
  });

  it('returns higher levels for higher XP', () => {
    // Level 3 threshold = round(1000 * 1.5^1) = 1500
    const result = getTrackLevelForXP('explorer', 1500);
    expect(result.level).toBeGreaterThanOrEqual(3);
  });

  it('clamps negative XP to 0', () => {
    const result = getTrackLevelForXP('social', -500);
    expect(result.level).toBe(1);
    expect(result.trackXp).toBe(0);
  });

  it('caps at level 50', () => {
    const result = getTrackLevelForXP('competitor', 999_999_999);
    expect(result.level).toBe(50);
    expect(result.xpToNextLevel).toBe(0);
  });

  it('returns correct xpToNextLevel for level 1', () => {
    const result = getTrackLevelForXP('social', 0);
    // Next threshold is 1000 (level 2)
    expect(result.xpToNextLevel).toBe(1000);
  });
});

// ─── applyMultipliers ────────────────────────────────────────────────────────

describe('applyMultipliers', () => {
  it('applies 1× multiplier on free plan (returns same XP)', () => {
    // free = 100 bp = 1× → floor(100 * 100 / 100) = 100
    expect(applyMultipliers(100, { plan: 'free' })).toBe(100);
  });

  it('applies 1.5× multiplier on plus plan', () => {
    // plus = 150 bp → floor(100 * 150 / 100) = 150
    expect(applyMultipliers(100, { plan: 'plus' })).toBe(150);
  });

  it('applies 3× multiplier on pro plan', () => {
    expect(applyMultipliers(100, { plan: 'pro' })).toBe(300);
  });

  it('applies 5× multiplier on max plan', () => {
    expect(applyMultipliers(100, { plan: 'max' })).toBe(500);
  });

  it('returns doubled XP with 2× XP booster on free plan', () => {
    // Booster is 200 bp which is > free (100 bp), so booster wins
    expect(applyMultipliers(100, { plan: 'free', hasActiveXPBooster: true })).toBe(200);
  });

  it('XP booster does not replace max plan (max is higher)', () => {
    // max = 500 bp > booster 200 bp, so max plan wins
    expect(applyMultipliers(100, { plan: 'max', hasActiveXPBooster: true })).toBe(500);
  });

  it('adds guild tier boost on top of plan multiplier', () => {
    // free (100 bp) = 100 XP, then bronze_1 adds 5% → 100 + 5 = 105
    expect(applyMultipliers(100, { plan: 'free', guildTier: 'bronze_1' })).toBe(105);
  });

  it('adds legend guild boost (50%)', () => {
    // free: 100 XP, legend +50% → 100 + 50 = 150
    expect(applyMultipliers(100, { plan: 'free', guildTier: 'legend' })).toBe(150);
  });

  it('adds season pass bonus additively', () => {
    // free: 100 XP, season pass +25% → 100 + 25 = 125
    expect(applyMultipliers(100, { plan: 'free', hasActiveSeasonPass: true })).toBe(125);
  });

  it('stacks guild boost and season pass', () => {
    // free: 100 XP, bronze_1 +5% = 105, season pass +25% of 105 = 105 + 26 = 131
    expect(applyMultipliers(100, { plan: 'free', guildTier: 'bronze_1', hasActiveSeasonPass: true })).toBe(131);
  });

  it('returns 0 for zero base XP', () => {
    expect(applyMultipliers(0, { plan: 'pro' })).toBe(0);
  });

  it('returns at least 1 XP when base > 0', () => {
    // Very small base should still yield 1
    expect(applyMultipliers(1, { plan: 'free' })).toBeGreaterThanOrEqual(1);
  });

  it('always returns an integer', () => {
    const result = applyMultipliers(7, { plan: 'plus' });
    expect(Number.isInteger(result)).toBe(true);
  });
});

// ─── calculateXPForAction ────────────────────────────────────────────────────

describe('calculateXPForAction', () => {
  it('returns correct XP for send_text_message (1 XP)', () => {
    expect(calculateXPForAction('send_text_message')).toBe(XP_VALUES.send_text_message);
  });

  it('returns correct XP for daily_login (50 XP)', () => {
    expect(calculateXPForAction('daily_login')).toBe(XP_VALUES.daily_login);
  });

  it('returns correct XP for send_gift_message (10 XP)', () => {
    expect(calculateXPForAction('send_gift_message')).toBe(XP_VALUES.send_gift_message);
  });

  it('returns minimum for guild_quest_contribution when no amount provided', () => {
    expect(calculateXPForAction('guild_quest_contribution')).toBe(XP_VALUES.guild_quest_contribution_min);
  });

  it('honours custom amount for guild_quest_contribution', () => {
    expect(calculateXPForAction('guild_quest_contribution', { amount: 75 })).toBe(75);
  });

  it('returns correct XP for mystery_xp_drop minimum', () => {
    expect(calculateXPForAction('mystery_xp_drop')).toBe(XP_VALUES.mystery_xp_drop_min);
  });

  it('returns 500 XP for onboarding_complete', () => {
    expect(calculateXPForAction('onboarding_complete')).toBe(XP_VALUES.welcome_xp_drop);
  });

  it('returns 2000 XP for new_member_quest', () => {
    expect(calculateXPForAction('new_member_quest')).toBe(XP_VALUES.new_member_quest_completion);
  });
});

// ─── calculateFinalXP ────────────────────────────────────────────────────────

describe('calculateFinalXP', () => {
  it('for send_gift_message on free plan returns baseXp=10, finalXp=10', () => {
    const { baseXp, finalXp } = calculateFinalXP('send_gift_message', { plan: 'free' });
    expect(baseXp).toBe(10);
    expect(finalXp).toBe(10);
  });

  it('plus plan yields higher finalXp than free plan for same action', () => {
    const free = calculateFinalXP('send_gift_message', { plan: 'free' });
    const plus = calculateFinalXP('send_gift_message', { plan: 'plus' });
    expect(plus.finalXp).toBeGreaterThan(free.finalXp);
  });

  it('pro plan yields 3× the free plan finalXp', () => {
    const free = calculateFinalXP('daily_login', { plan: 'free' });
    const pro = calculateFinalXP('daily_login', { plan: 'pro' });
    expect(pro.finalXp).toBe(free.finalXp * 3);
  });

  it('both baseXp and finalXp are non-negative integers', () => {
    const { baseXp, finalXp } = calculateFinalXP('add_new_friend', { plan: 'plus' });
    expect(Number.isInteger(baseXp)).toBe(true);
    expect(Number.isInteger(finalXp)).toBe(true);
    expect(baseXp).toBeGreaterThanOrEqual(0);
    expect(finalXp).toBeGreaterThanOrEqual(0);
  });
});

// ─── checkForRankUp ──────────────────────────────────────────────────────────

describe('checkForRankUp', () => {
  it('returns didRankUp=false when XP stays within same rank', () => {
    const result = checkForRankUp(100, 200);
    expect(result.didRankUp).toBe(false);
    expect(result.rankBefore.rankName).toBe('Beginner');
    expect(result.rankAfter.rankName).toBe('Beginner');
  });

  it('returns didRankUp=true when crossing a rank threshold', () => {
    // 1999 → 2001 crosses into Rookie
    const result = checkForRankUp(1999, 2001);
    expect(result.didRankUp).toBe(true);
    expect(result.rankBefore.rankName).toBe('Beginner');
    expect(result.rankAfter.rankName).toBe('Rookie');
  });

  it('returns didRankUp=true when changing sublevel within the same rank', () => {
    // Beginner sub-width = floor(2000/3) = 666
    // 0 → 667 crosses sublevel boundary
    const result = checkForRankUp(0, 667);
    expect(result.didRankUp).toBe(true);
  });

  it('includes rankBefore and rankAfter objects', () => {
    const result = checkForRankUp(0, 0);
    expect(result.rankBefore).toBeDefined();
    expect(result.rankAfter).toBeDefined();
    expect(result.rankBefore.rankName).toBe('Beginner');
  });
});

// ─── getDailyMessageStreakXP ──────────────────────────────────────────────────

describe('getDailyMessageStreakXP', () => {
  it('returns 5 XP for day 1', () => {
    expect(getDailyMessageStreakXP(1)).toBe(5);
  });

  it('returns 5 XP for days 1–6', () => {
    for (let d = 1; d <= 6; d++) {
      expect(getDailyMessageStreakXP(d)).toBe(5);
    }
  });

  it('returns 10 XP for days 7–13', () => {
    for (let d = 7; d <= 13; d++) {
      expect(getDailyMessageStreakXP(d)).toBe(10);
    }
  });

  it('returns 15 XP for days 14–20', () => {
    expect(getDailyMessageStreakXP(14)).toBe(15);
    expect(getDailyMessageStreakXP(20)).toBe(15);
  });

  it('returns 20 XP for days 21–27', () => {
    expect(getDailyMessageStreakXP(21)).toBe(20);
  });

  it('returns 25 XP (cap) for day 28+', () => {
    expect(getDailyMessageStreakXP(28)).toBe(25);
    expect(getDailyMessageStreakXP(100)).toBe(25);
  });
});

// ─── getGuildXPBoostPercent ───────────────────────────────────────────────────

describe('getGuildXPBoostPercent', () => {
  it('returns 0 for null guild tier', () => {
    expect(getGuildXPBoostPercent(null)).toBe(0);
  });

  it('returns 0 for undefined guild tier', () => {
    expect(getGuildXPBoostPercent(undefined)).toBe(0);
  });

  it('returns correct boost for bronze tiers (5%)', () => {
    expect(getGuildXPBoostPercent('bronze_1')).toBe(5);
    expect(getGuildXPBoostPercent('bronze_3')).toBe(5);
  });

  it('returns correct boost for gold tier (20%)', () => {
    expect(getGuildXPBoostPercent('gold_2')).toBe(20);
  });

  it('returns 50 for legend tier', () => {
    expect(getGuildXPBoostPercent('legend')).toBe(50);
  });

  it('returns 0 for unrecognised tier string', () => {
    expect(getGuildXPBoostPercent('mythic_1')).toBe(0);
  });
});

// ─── Multiplier integer invariant ────────────────────────────────────────────

describe('All multiplier basis points are integers', () => {
  it('PLAN_XP_MULTIPLIERS_BP values are all integers', () => {
    for (const [plan, bp] of Object.entries(PLAN_XP_MULTIPLIERS_BP)) {
      expect(Number.isInteger(bp)).toBe(true);
    }
  });
});
