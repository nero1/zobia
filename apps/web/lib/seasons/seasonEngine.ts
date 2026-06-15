/**
 * lib/seasons/seasonEngine.ts
 *
 * Season management engine.
 *
 * Handles season lifecycle: detecting the active season, computing the current
 * phase, resetting competitive rankings at season end, archiving per-user
 * season history, and distributing top-performer rewards.
 */

import type { DatabaseAdapter } from "@/lib/db/interface";
import { creditCoins } from "@/lib/economy/coins";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Season {
  id: string;
  name: string;
  theme: string;
  starts_at: string;
  ends_at: string;
  is_active: boolean;
  pass_price_coins: number;
  reward_pool_coins: number;
  created_at: string;
}

/** Phase within a season timeline. */
export type SeasonPhase = "opening" | "mid" | "push" | "final_day";

// ---------------------------------------------------------------------------
// getCurrentSeason
// ---------------------------------------------------------------------------

/**
 * Returns the currently active season row, or null if no season is live.
 *
 * @param db - Active database adapter.
 * @returns The active Season or null.
 */
export async function getCurrentSeason(db: DatabaseAdapter): Promise<Season | null> {
  const { rows } = await db.query<Season>(
    `SELECT id, name, theme, starts_at, ends_at, is_active,
            pass_price_coins, reward_pool_coins, created_at
     FROM seasons
     WHERE is_active = TRUE AND starts_at <= NOW() AND ends_at > NOW()
     ORDER BY starts_at DESC
     LIMIT 1`,
    []
  );
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// isSeasonActive
// ---------------------------------------------------------------------------

/**
 * Returns true if the given season is currently active based on timestamps.
 *
 * @param season - Season object from the database.
 * @returns Boolean indicating whether the season is live.
 */
export function isSeasonActive(season: Season): boolean {
  const now = Date.now();
  return (
    season.is_active &&
    new Date(season.starts_at).getTime() <= now &&
    new Date(season.ends_at).getTime() > now
  );
}

// ---------------------------------------------------------------------------
// getSeasonPhase
// ---------------------------------------------------------------------------

/**
 * Calculates the current phase of a season based on elapsed time.
 *
 *  - opening   : First 25% of the season duration
 *  - mid       : 25% – 75% of the season
 *  - push      : 75% – 95% of the season
 *  - final_day : Last 5% (or last 24 hours, whichever is smaller)
 *
 * @param season - The season to evaluate.
 * @returns The current phase string.
 */
export function getSeasonPhase(season: Season): SeasonPhase {
  const start = new Date(season.starts_at).getTime();
  const end = new Date(season.ends_at).getTime();
  const now = Date.now();
  const total = end - start;
  const elapsed = Math.max(0, now - start);
  const ratio = elapsed / total;

  if (ratio >= 0.95 || end - now <= 24 * 60 * 60 * 1000) return "final_day";
  if (ratio >= 0.75) return "push";
  if (ratio >= 0.25) return "mid";
  return "opening";
}

// ---------------------------------------------------------------------------
// resetSeasonRankings
// ---------------------------------------------------------------------------

/**
 * Resets competitive (season-specific) rankings at season end.
 *
 * Only resets the season_rank column and seasonal leaderboard snapshot.
 * Main XP, coins, items, guild membership, and track XP are all preserved.
 *
 * @param seasonId - UUID of the season that just ended.
 * @param db       - Active database adapter.
 */
export async function resetSeasonRankings(
  seasonId: string,
  db: DatabaseAdapter
): Promise<void> {
  await db.transaction(async (client) => {
    // Archive leaderboard positions before clearing
    await client.query(
      `INSERT INTO season_rank_archives (season_id, user_id, final_rank, final_season_xp, archived_at)
       SELECT $1, user_id, season_rank, season_xp, NOW()
       FROM user_season_passes
       WHERE season_id = $1
       ON CONFLICT (season_id, user_id) DO NOTHING`,
      [seasonId]
    );

    // Reset per-season XP and rank
    await client.query(
      `UPDATE user_season_passes
       SET season_xp = 0, season_rank = NULL
       WHERE season_id = $1`,
      [seasonId]
    );

    // Mark season as inactive
    await client.query(
      `UPDATE seasons SET is_active = FALSE, updated_at = NOW() WHERE id = $1`,
      [seasonId]
    );
  });
}

// ---------------------------------------------------------------------------
// archiveSeasonForUser
// ---------------------------------------------------------------------------

/**
 * Archives the season result for a single user. Called per-user at season end.
 * Safe to call multiple times (upserts on conflict).
 *
 * @param userId     - UUID of the user.
 * @param seasonId   - UUID of the season.
 * @param finalRank  - The user's final leaderboard rank number.
 * @param db         - Active database adapter.
 */
export async function archiveSeasonForUser(
  userId: string,
  seasonId: string,
  finalRank: number,
  db: DatabaseAdapter
): Promise<void> {
  await db.query(
    `INSERT INTO season_rank_archives (season_id, user_id, final_rank, final_season_xp, archived_at)
     SELECT $1, $2, $3, COALESCE(usp.season_xp, 0), NOW()
     FROM user_season_passes usp
     WHERE usp.season_id = $1 AND usp.user_id = $2
     ON CONFLICT (season_id, user_id) DO UPDATE
       SET final_rank = EXCLUDED.final_rank,
           archived_at = EXCLUDED.archived_at`,
    [seasonId, userId, finalRank]
  );
}

// ---------------------------------------------------------------------------
// distributeSeasonRewards
// ---------------------------------------------------------------------------

/**
 * Distributes season end rewards to top performers.
 *
 * Reward tiers (based on the season's reward_pool_coins):
 *  - Rank 1:      25% of pool
 *  - Rank 2:      15% of pool
 *  - Rank 3:      10% of pool
 *  - Rank 4–10:   5% of pool each (50% total, evenly split across 7 users)
 *  - All top-10 receive an exclusive season badge recorded in user_badges
 *
 * @param seasonId - UUID of the ended season.
 * @param db       - Active database adapter.
 */
export async function distributeSeasonRewards(
  seasonId: string,
  db: DatabaseAdapter
): Promise<void> {
  const seasonResult = await db.query<{ reward_pool_coins: number }>(
    `SELECT reward_pool_coins FROM seasons WHERE id = $1`,
    [seasonId]
  );
  const season = seasonResult.rows[0];
  if (!season) throw new Error(`[seasonEngine] Season not found: ${seasonId}`);

  const pool = season.reward_pool_coins;

  // Top 10 by final_rank
  const rankResult = await db.query<{ user_id: string; final_rank: number }>(
    `SELECT user_id, final_rank
     FROM season_rank_archives
     WHERE season_id = $1 AND final_rank IS NOT NULL
     ORDER BY final_rank ASC
     LIMIT 10`,
    [seasonId]
  );

  const topUsers = rankResult.rows;
  const rewardShares = [0.25, 0.15, 0.1];

  // BUG-46: When fewer than 4 users placed, the 50% allocated to ranks 4-10 was
  // computed as 0 and silently lost. Instead, redistribute unallocated shares
  // proportionally to the existing top-3 (or fewer) users.
  //
  // Compute per-user coin amounts up-front so we can redistribute any remainder.
  const userCoins: number[] = new Array(topUsers.length).fill(0);

  if (topUsers.length > 3) {
    // Normal case: ranks 1-3 get their fixed shares; ranks 4-10 split 50% evenly
    const rank4to10Share = Math.floor((pool * 0.5) / (topUsers.length - 3));
    for (let i = 0; i < topUsers.length; i++) {
      userCoins[i] = i < 3 ? Math.floor(pool * rewardShares[i]) : rank4to10Share;
    }
  } else {
    // Fewer than 4 users: no rank-4-to-10 recipients exist.
    // Redistribute the unallocated 50% proportionally among the placed users.
    // Proportional weights for the placed users (using the same rewardShares ratios):
    const placedCount = topUsers.length; // 0, 1, 2, or 3
    if (placedCount === 0) {
      // No users placed — nothing to distribute
    } else {
      const activeTiersTotal = rewardShares.slice(0, placedCount).reduce((a, b) => a + b, 0);
      for (let i = 0; i < placedCount; i++) {
        // Scale each user's share up so the full pool is distributed
        userCoins[i] = Math.floor(pool * (rewardShares[i] / activeTiersTotal));
      }
      // Assign any remaining coins due to floor rounding to rank-1
      const distributed = userCoins.slice(0, placedCount).reduce((a, b) => a + b, 0);
      const remainder = pool - distributed;
      if (remainder > 0 && placedCount > 0) {
        userCoins[0] += remainder;
      }
    }
  }

  await db.transaction(async (client) => {
    for (let i = 0; i < topUsers.length; i++) {
      const { user_id } = topUsers[i];
      const coins = userCoins[i];

      // ZB-04: Use creditCoins with a per-user reference so the unique partial
      // index on coin_ledger is not violated when multiple users receive rewards.
      if (coins > 0) {
        await creditCoins(
          user_id,
          coins,
          "season_reward",
          `season:${seasonId}:${user_id}`,
          "Season end reward",
          { seasonId, rank: i + 1 },
          client
        );
      }

      // Award season badge with a season-specific key so each season's badge is unique (BUG-12)
      await client.query(
        `INSERT INTO user_badges (user_id, badge_type, badge_key, reference_id, awarded_at)
         VALUES ($1, 'season_top10', 'season_top10:' || $2::text, $2, NOW())
         ON CONFLICT (user_id, badge_key) WHERE badge_key IS NOT NULL DO NOTHING`,
        [user_id, seasonId]
      );
    }

    // Retire all limited-edition gifts that belonged to this season.
    // Once a season ends, these items are no longer purchasable or giftable.
    await client.query(
      `UPDATE gift_items
       SET is_retired = TRUE
       WHERE season_id = $1
         AND is_limited_edition = TRUE
         AND is_retired = FALSE`,
      [seasonId]
    );
  });
}

// ---------------------------------------------------------------------------
// createSeasonCeremonyRoom
// ---------------------------------------------------------------------------

/**
 * Creates the Season Closing Ceremony Room when a season ends.
 *
 * The room is a public "free_open" type room tied to the ending season.
 * It stays active for 48 hours so members can celebrate and reflect.
 * A system/admin user is used as the creator.
 *
 * @param seasonId   - UUID of the ended season.
 * @param seasonName - Display name of the ended season.
 * @param db         - Active database adapter.
 */
export async function createSeasonCeremonyRoom(
  seasonId: string,
  seasonName: string,
  db: DatabaseAdapter
): Promise<string | null> {
  try {
    // Fetch the first admin user to be the room creator
    const { rows: adminRows } = await db.query<{ id: string }>(
      `SELECT id FROM users WHERE is_admin = TRUE AND deleted_at IS NULL ORDER BY created_at ASC LIMIT 1`
    );
    const adminId = adminRows[0]?.id;
    if (!adminId) return null;

    // Check if a ceremony room already exists for this season
    const { rows: existing } = await db.query<{ id: string }>(
      `SELECT id FROM rooms WHERE metadata->>'season_ceremony_id' = $1 LIMIT 1`,
      [seasonId]
    );
    if (existing[0]) return existing[0].id;

    const closesAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();

    const { rows: roomRows } = await db.query<{ id: string }>(
      `INSERT INTO rooms
         (creator_id, name, description, type, is_active, ends_at, metadata)
       VALUES ($1, $2, $3, 'free_open', TRUE, $4, $5)
       RETURNING id`,
      [
        adminId,
        `🏆 ${seasonName} Closing Ceremony`,
        `The official closing ceremony for ${seasonName}. Celebrate, reflect, and look ahead to the next season!`,
        closesAt,
        JSON.stringify({ season_ceremony_id: seasonId, is_platform_room: true }),
      ]
    );

    return roomRows[0]?.id ?? null;
  } catch (err) {
    console.error('[seasonEngine] createSeasonCeremonyRoom failed:', err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// seedSeasonPassMilestones
// ---------------------------------------------------------------------------

/**
 * Seed default pass milestones for a newly created Season.
 * Called after a season is created.
 */
export async function seedSeasonPassMilestones(
  seasonId: string,
  db: DatabaseAdapter
): Promise<void> {
  const freeMilestones = [
    { xp: 500,   type: 'coins',        value: { amount: 50 },    name: '50 Coins',              order: 1 },
    { xp: 1500,  type: 'sticker_pack', value: { packId: 'seasonal_free' }, name: 'Season Sticker Pack', order: 2 },
    { xp: 3000,  type: 'coins',        value: { amount: 100 },   name: '100 Coins',             order: 3 },
    { xp: 6000,  type: 'badge',        value: { badgeType: 'season_participant' }, name: 'Season Badge', order: 4 },
    { xp: 10000, type: 'coins',        value: { amount: 200 },   name: '200 Coins',             order: 5 },
  ];
  const paidMilestones = [
    { xp: 500,   type: 'coins',        value: { amount: 100 },   name: '100 Coins (Paid)',      order: 1 },
    { xp: 1500,  type: 'badge',        value: { badgeType: 'season_pass_holder' }, name: 'Pass Holder Badge', order: 2 },
    { xp: 3000,  type: 'title',        value: { title: 'Season Champion' }, name: 'Title: Season Champion', order: 3 },
    { xp: 6000,  type: 'xp_bonus',     value: { bonusXP: 500 }, name: '500 Bonus XP',           order: 4 },
    { xp: 10000, type: 'badge',        value: { badgeType: 'season_elite', animated: true }, name: 'Elite Season Badge', order: 5 },
    { xp: 15000, type: 'title',        value: { title: 'Legend of the Season' }, name: 'Title: Legend of the Season', order: 6 },
  ];

  const allMilestones = [
    ...freeMilestones.map(m => ({ ...m, tier: 'free' })),
    ...paidMilestones.map(m => ({ ...m, tier: 'paid' })),
  ];

  // FIX-H04: ON CONFLICT now targets (season_id, tier, sort_order) so free and
  // paid milestones with the same sort_order do not conflict with each other.
  for (const m of allMilestones) {
    await db.query(
      `INSERT INTO season_pass_milestones
         (season_id, milestone_xp, tier, reward_type, reward_value, display_name, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (season_id, tier, sort_order) DO NOTHING`,
      [seasonId, m.xp, m.tier, m.type, JSON.stringify(m.value), m.name, m.order]
    );
  }
}

// ---------------------------------------------------------------------------
// getPassMilestones
// ---------------------------------------------------------------------------

/**
 * Get all pass milestones for a season, with claim status for a user.
 */
export async function getPassMilestones(
  seasonId: string,
  userId: string,
  db: DatabaseAdapter
): Promise<Array<{
  id: string;
  milestoneXp: number;
  tier: string;
  rewardType: string;
  rewardValue: unknown;
  displayName: string;
  sortOrder: number;
  isClaimed: boolean;
}>> {
  const { rows } = await db.query<{
    id: string; milestone_xp: number; tier: string; reward_type: string;
    reward_value: unknown; display_name: string; sort_order: number; claimed_at: string | null;
  }>(
    `SELECT spm.id, spm.milestone_xp, spm.tier, spm.reward_type, spm.reward_value,
            spm.display_name, spm.sort_order,
            uspc.claimed_at
     FROM season_pass_milestones spm
     LEFT JOIN user_season_pass_claims uspc
       ON uspc.milestone_id = spm.id AND uspc.user_id = $2
     WHERE spm.season_id = $1
     ORDER BY spm.sort_order ASC, spm.milestone_xp ASC`,
    [seasonId, userId]
  );
  return rows.map(r => ({
    id: r.id,
    milestoneXp: r.milestone_xp,
    tier: r.tier,
    rewardType: r.reward_type,
    rewardValue: r.reward_value,
    displayName: r.display_name,
    sortOrder: r.sort_order,
    isClaimed: r.claimed_at !== null,
  }));
}

// ---------------------------------------------------------------------------
// claimPassMilestone
// ---------------------------------------------------------------------------

/**
 * Claim a season pass milestone reward for a user.
 * Checks the user has enough season XP and the milestone isn't already claimed.
 *
 * ZB-06/ZB-22: All checks and the reward grant are wrapped in a single
 * transaction with FOR UPDATE locks so concurrent requests cannot both
 * pass the "not yet claimed" check and each apply the reward.
 * The RETURNING clause tells us whether the INSERT actually ran, preventing
 * the reward from being applied when ON CONFLICT DO NOTHING silently skips it.
 */
export async function claimPassMilestone(
  userId: string,
  seasonId: string,
  milestoneId: string,
  db: DatabaseAdapter
): Promise<{ success: boolean; rewardType: string; rewardValue: unknown }> {
  let claimed: { rewardType: string; rewardValue: unknown } | null = null;

  await db.transaction(async (client) => {
    // Lock the pass row so concurrent claims for the same user/season are serialised
    const { rows: passRows } = await client.query<{
      season_xp: number; has_paid_pass: boolean;
    }>(
      `SELECT sp.season_xp, sp.is_paid AS has_paid_pass
       FROM user_season_passes sp
       WHERE sp.user_id = $1 AND sp.season_id = $2
       FOR UPDATE`,
      [userId, seasonId]
    );
    const pass = passRows[0];
    if (!pass) throw new Error('User has no season pass');

    const { rows: milRows } = await client.query<{
      milestone_xp: number; tier: string; reward_type: string; reward_value: unknown;
    }>(
      `SELECT milestone_xp, tier, reward_type, reward_value
       FROM season_pass_milestones WHERE id = $1 AND season_id = $2`,
      [milestoneId, seasonId]
    );
    const milestone = milRows[0];
    if (!milestone) throw new Error('Milestone not found');

    if (milestone.tier === 'paid' && !pass.has_paid_pass) {
      throw new Error('Paid pass required for this milestone');
    }
    if (pass.season_xp < milestone.milestone_xp) {
      throw new Error('Insufficient season XP');
    }

    // Attempt claim; RETURNING lets us detect whether the row was actually inserted
    const { rows: claimRows } = await client.query<{ user_id: string }>(
      `INSERT INTO user_season_pass_claims (user_id, season_id, milestone_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, milestone_id) DO NOTHING
       RETURNING user_id`,
      [userId, seasonId, milestoneId]
    );

    // Already claimed — skip reward, return success: false
    if (!claimRows[0]) return;

    // Apply reward only when the insert actually happened
    if (milestone.reward_type === 'coins') {
      const val = milestone.reward_value as { amount: number };
      await creditCoins(
        userId,
        val.amount,
        "season_milestone",
        `milestone:${milestoneId}`,
        "Season pass milestone reward",
        { milestoneId, seasonId },
        client
      );
    } else if (milestone.reward_type === 'badge' || milestone.reward_type === 'title') {
      const val = milestone.reward_value as { badgeType?: string; title?: string };
      const badgeType = val.badgeType ?? val.title ?? 'season_reward';
      // Include season discriminator in badge_key to prevent cross-season deduplication collisions
      const badgeKey = `${badgeType}:s${seasonId}`;
      await client.query(
        `INSERT INTO user_badges (user_id, badge_type, badge_key, reference_id, awarded_at)
         VALUES ($1, $2, $3, $4, NOW()) ON CONFLICT (user_id, badge_key) DO NOTHING`,
        [userId, badgeType, badgeKey, milestoneId]
      );
    } else if (milestone.reward_type === 'xp_bonus') {
      const val = milestone.reward_value as { bonusXP: number };
      const referenceId = `season:${seasonId}:milestone:${milestoneId}:user:${userId}`;
      // BUG-03: CTE gate — UPDATE only fires when INSERT actually inserts
      await client.query(
        `WITH ins AS (
           INSERT INTO xp_ledger (user_id, amount, track, source, reference_id, base_amount, created_at)
           VALUES ($1, $2, 'main', 'season_milestone_bonus', $3, $2, NOW())
           ON CONFLICT (user_id, source, reference_id) WHERE reference_id IS NOT NULL DO NOTHING
           RETURNING id
         )
         UPDATE users SET xp_total = xp_total + $2, updated_at = NOW()
         WHERE id = $1 AND EXISTS (SELECT 1 FROM ins)`,
        [userId, val.bonusXP, referenceId]
      );
    } else if (milestone.reward_type === 'sticker_pack') {
      const val = milestone.reward_value as { packId: string };
      await client.query(
        `INSERT INTO user_sticker_packs (user_id, pack_id, unlocked_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (user_id, pack_id) DO NOTHING`,
        [userId, val.packId]
      );
    } else {
      console.error(`[claimPassMilestone] Unhandled reward_type '${milestone.reward_type}' for milestone ${milestoneId}`);
    }

    claimed = { rewardType: milestone.reward_type, rewardValue: milestone.reward_value };
  });

  if (!claimed) {
    // Fetch reward metadata to return a well-typed response for already-claimed milestones
    const { rows } = await db.query<{ reward_type: string; reward_value: unknown }>(
      `SELECT reward_type, reward_value FROM season_pass_milestones WHERE id = $1`,
      [milestoneId]
    );
    return {
      success: false,
      rewardType: rows[0]?.reward_type ?? 'unknown',
      rewardValue: rows[0]?.reward_value ?? {},
    };
  }

  return { success: true, ...(claimed as { rewardType: string; rewardValue: unknown }) };
}
